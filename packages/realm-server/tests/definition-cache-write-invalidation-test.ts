import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import fsExtra from 'fs-extra';
const { ensureDirSync, readJSONSync, writeJSONSync } = fsExtra;
import { dirSync, setGracefulCleanup } from 'tmp';
import type { DirResult } from 'tmp';
import type { SuperTest, Test } from 'supertest';
import type {
  DefinitionLookup,
  QueuePublisher,
  Realm,
} from '@cardstack/runtime-common';
import {
  DURING_PRERENDER_HEADER,
  readRealmLoaderEpoch,
  rri,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createRealm,
  createVirtualNetwork,
  setupDB,
  setupPermissionedRealmCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// The DB definition cache is keyed by module URL and carries no freshness
// check, so a cached definition for a module outlives the bytes it was
// derived from until something deletes the row. `fileSerialization` resolves
// an instance's type through that cache and `serializeCardResource` skips
// every attribute whose field the resolved definition doesn't declare — so a
// definition that outlives a schema-widening module rewrite makes the next
// instance write drop the new field, silently and with a success response.
//
// `_batchWriteUnlocked` closes that by invalidating the definition cache for
// every executable file it writes, at the point the bytes change rather than
// at the point indexing lands.

const personV1 = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
  }
`;

// Same class, one more field. Serializing an instance that carries
// `lastName` against the v1 definition drops the attribute.
const personV2 = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
  }
`;

module(basename(import.meta.filename), function () {
  module(
    'module write invalidates the definition cache and mints a loader epoch',
    function (hooks) {
      let realmURL = 'http://127.0.0.1:4448/write-invalidation/';
      let realm: Realm;
      let dbAdapter: PgAdapter;
      let publisher: QueuePublisher;
      let tmpDir: DirResult;
      // Every module URL handed to DefinitionLookup#invalidate, in call order.
      let invalidated: string[];
      // The realm's committed loader epoch as each of those calls was made.
      // The write path mints before it invalidates, so this samples what a
      // lookup racing that invalidation would have threaded.
      let epochAtInvalidate: string[];

      setGracefulCleanup();

      // The realm runs without a worker, so the index jobs these writes enqueue
      // are never claimed. That makes the indexing job's `onInvalidation` — the
      // other caller of DefinitionLookup#invalidate — structurally unable to
      // fire, so every recorded call came from the write path and no assertion
      // below depends on how fast a worker drains. It also means writes must
      // pass `waitForIndex: false`; a write that waits would block on a job
      // nothing is going to run.
      setupDB(hooks, {
        beforeEach: async (_dbAdapter, _publisher) => {
          dbAdapter = _dbAdapter;
          publisher = _publisher;
          invalidated = [];
          epochAtInvalidate = [];
          // unsafeCleanup: the realm writes files into this dir, and the
          // default cleanup only removes an empty one.
          tmpDir = dirSync({ unsafeCleanup: true });
          let realmDir = join(tmpDir.name, 'realm');
          ensureDirSync(realmDir);
          writeJSONSync(join(realmDir, 'realm.json'), {
            data: {
              type: 'card',
              attributes: { cardInfo: { name: 'Write Invalidation Realm' } },
              meta: {
                adoptsFrom: {
                  module: '@cardstack/base/realm-config',
                  name: 'RealmConfig',
                },
              },
            },
          });
          ({ realm } = await createRealm({
            dir: realmDir,
            // Only `invalidate` and `forRealm` are reachable from the write
            // path: nothing here writes with `serializeFile`, so no lookup
            // runs. A recorder is enough, and it keeps the assertions on the
            // realm's behavior rather than on the cache implementation.
            definitionLookup: {
              forRealm() {
                return this;
              },
              async invalidate(moduleURL: string) {
                invalidated.push(moduleURL);
                epochAtInvalidate.push(
                  await readRealmLoaderEpoch(dbAdapter, realmURL),
                );
                return [];
              },
            } as unknown as DefinitionLookup,
            realmURL,
            permissions: { '*': ['read', 'write'] },
            virtualNetwork: createVirtualNetwork(),
            publisher,
            dbAdapter,
          }));
        },
      });

      hooks.afterEach(function () {
        tmpDir?.removeCallback();
      });

      test('writing a module invalidates that module', async function (assert) {
        await realm.write('person.gts', personV1, { waitForIndex: false });

        assert.deepEqual(
          invalidated,
          [`${realmURL}person.gts`],
          'the write invalidated the definition cache for the module it wrote',
        );
      });

      test('a rewritten module is invalidated before the write resolves', async function (assert) {
        await realm.write('person.gts', personV1, { waitForIndex: false });
        invalidated = [];

        await realm.write('person.gts', personV2, { waitForIndex: false });

        // Asserted synchronously off the resolved write: an instance write
        // arriving the moment this one returns must already miss the cache,
        // which is the whole guarantee — a definition dropped "shortly after"
        // still leaves the window the drop exists to close.
        assert.deepEqual(
          invalidated,
          [`${realmURL}person.gts`],
          'the rewrite invalidated the module before the write resolved',
        );
      });

      test('writing a card instance invalidates nothing', async function (assert) {
        await realm.write(
          'person-1.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: { adoptsFrom: { module: './person', name: 'Person' } },
            },
          }),
          { waitForIndex: false },
        );

        assert.deepEqual(
          invalidated,
          [],
          'an instance write leaves the definition cache alone — its bytes are not a schema',
        );
      });

      test('a batch write invalidates every module it contains', async function (assert) {
        // Modules only. A batch that mixes in an instance flushes the modules
        // written so far to the index before serializing it, and that flush
        // waits on a worker this realm deliberately does not have.
        await realm.writeMany(
          new Map([
            ['person.gts', personV1],
            ['employee.gts', personV1],
          ]),
          { waitForIndex: false },
        );

        assert.deepEqual(
          invalidated.sort(),
          [`${realmURL}employee.gts`, `${realmURL}person.gts`],
          'every module in the batch was invalidated, not just the last one',
        );
      });

      test('rewriting a module with identical bytes invalidates nothing', async function (assert) {
        await realm.write('person.gts', personV1, { waitForIndex: false });
        invalidated = [];

        await realm.write('person.gts', personV1, { waitForIndex: false });

        assert.deepEqual(
          invalidated,
          [],
          'an unchanged rewrite short-circuits before the write, so the cached definition still matches the bytes',
        );
      });

      test('writing a non-executable file invalidates nothing', async function (assert) {
        await realm.write('notes.txt', 'hello', { waitForIndex: false });

        assert.deepEqual(
          invalidated,
          [],
          'a non-executable file has no definition to invalidate',
        );
      });

      // The epoch is what stops the repopulate the invalidation forces from
      // being derived off a prerender tab that still holds the pre-write
      // module. Asserted on the committed `realm_generations` row rather than
      // on a render, because that row is what `lookupDefinition` threads and
      // what a peer replica reads: an epoch that never lands is invisible to
      // both. `'0'` is the column's no-epoch-yet sentinel — each test here
      // starts from a realm no index pass and no module write has touched.
      test('writing a module mints a loader epoch', async function (assert) {
        assert.strictEqual(
          await readRealmLoaderEpoch(dbAdapter, realmURL),
          '0',
          'the realm starts with no epoch — nothing has invalidated a module yet',
        );

        await realm.write('person.gts', personV1, { waitForIndex: false });

        assert.notStrictEqual(
          await readRealmLoaderEpoch(dbAdapter, realmURL),
          '0',
          'the write left an epoch behind for the next module render to thread',
        );
      });

      test('a rewrite mints a different epoch than the write before it', async function (assert) {
        await realm.write('person.gts', personV1, { waitForIndex: false });
        let firstEpoch = await readRealmLoaderEpoch(dbAdapter, realmURL);

        await realm.write('person.gts', personV2, { waitForIndex: false });

        // Only identity matters: a tab clears when the epoch it is handed
        // differs from the one it last cleared for, so re-minting the same
        // token would read as "this tab is already current" and leave the
        // superseded module loaded.
        assert.notStrictEqual(
          await readRealmLoaderEpoch(dbAdapter, realmURL),
          firstEpoch,
          'the rewrite superseded the epoch its own first write minted',
        );
      });

      test('a batch mints one epoch however many modules it writes', async function (assert) {
        await realm.write('person.gts', personV1, { waitForIndex: false });
        let beforeBatch = await readRealmLoaderEpoch(dbAdapter, realmURL);
        invalidated = [];
        epochAtInvalidate = [];

        await realm.writeMany(
          new Map([
            ['person.gts', personV2],
            ['employee.gts', personV1],
          ]),
          { waitForIndex: false },
        );

        let afterBatch = await readRealmLoaderEpoch(dbAdapter, realmURL);
        assert.strictEqual(
          invalidated.length,
          2,
          'both modules in the batch reached the definition cache',
        );
        assert.notStrictEqual(
          afterBatch,
          beforeBatch,
          'the batch superseded the epoch standing before it',
        );
        // Sampled at each module's invalidation rather than counted after
        // the fact: one token across the whole batch is the point. The
        // token only has to differ from what a tab holds, so minting per
        // file would cost every warm tab a loader reset per module and buy
        // no freshness the first mint had not already bought.
        assert.deepEqual(
          [...new Set(epochAtInvalidate)],
          [afterBatch],
          'both modules landed under the same single new epoch',
        );
      });

      test('a write that changes no module leaves the epoch alone', async function (assert) {
        await realm.write('person.gts', personV1, { waitForIndex: false });
        let epoch = await readRealmLoaderEpoch(dbAdapter, realmURL);

        await realm.write('person.gts', personV1, { waitForIndex: false });
        await realm.write('notes.txt', 'hello', { waitForIndex: false });
        await realm.write(
          'person-1.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: { adoptsFrom: { module: './person', name: 'Person' } },
            },
          }),
          { waitForIndex: false },
        );

        // An unchanged rewrite, a non-executable, and an instance all leave
        // every loaded module in a warm tab still current, so re-minting would
        // buy a loader reset per tab and change nothing about what they hold.
        assert.strictEqual(
          await readRealmLoaderEpoch(dbAdapter, realmURL),
          epoch,
          'none of these changed a module, so no tab needs to drop one',
        );
      });
    },
  );

  module(
    'a schema-widening module rewrite is visible to the next instance write',
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/test/');
      let testRealm: Realm;
      let testRealmPath: string;
      let request: RealmRequest;

      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        fileSystem: {
          'person.gts': personV1,
          'person-1.json': {
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: { module: rri('./person'), name: 'Person' },
              },
            },
          },
        },
        onRealmSetup(args: {
          testRealm: Realm;
          testRealmPath: string;
          request: SuperTest<Test>;
        }) {
          testRealm = args.testRealm;
          testRealmPath = args.testRealmPath;
          request = withRealmPath(args.request, realmURL);
        },
      });

      // Serializing an instance through the endpoint is what populates the
      // definition cache in production, so this both warms the cache with the
      // pre-rewrite schema and pins that the instance round-trips before the
      // rewrite the test is actually about.
      async function primeDefinitionCache(assert: Assert) {
        let response = await request
          .patch('/person-1')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: { module: rri('./person'), name: 'Person' },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json');
        assert.strictEqual(
          response.status,
          200,
          `the pre-rewrite schema serialized an instance, warming its definition — ${JSON.stringify(response.body)}`,
        );
      }

      // Widen the schema on a deferred-indexing write, the shape the headless
      // command and prerender-originated paths take: the bytes land and the
      // index job is enqueued. This realm does run a worker, so that job's own
      // `onInvalidation` would eventually clear the cached definition too —
      // the write-time invalidation is what reliably wins the race, not the
      // only thing that can. The determinism lives in the no-worker module
      // above; these tests pin the user-visible outcome.
      async function widenPersonSchema() {
        await testRealm.write('person.gts', personV2, { waitForIndex: false });
      }

      function storedInstance(path: string): any {
        return readJSONSync(join(testRealmPath, path));
      }

      test('PATCH persists a field the rewrite added', async function (assert) {
        // `patchCardInstance` serializes before `_batchWriteUnlocked` drains
        // indexing, so nothing on this path waits for the rewrite's index job.
        await primeDefinitionCache(assert);
        await widenPersonSchema();

        let response = await request
          .patch('/person-1')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Mango', lastName: 'Tangle' },
              meta: {
                adoptsFrom: { module: rri('./person'), name: 'Person' },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json');

        assert.strictEqual(
          response.status,
          200,
          `HTTP 200 status — ${JSON.stringify(response.body)}`,
        );
        assert.strictEqual(
          response.body.data.attributes?.lastName,
          'Tangle',
          'the response echoes the field the rewrite added',
        );
        assert.strictEqual(
          storedInstance('person-1.json').data.attributes?.lastName,
          'Tangle',
          'the field the rewrite added survived to the stored file',
        );
      });

      test('a prerender-originated POST persists a field the rewrite added', async function (assert) {
        // The during-prerender marker is what a headless command's tab
        // carries. It skips `createCard`'s pre-write drain — waiting there
        // would deadlock on the render slot the caller holds — so this path
        // has no indexing step between the rewrite and the serialization.
        await primeDefinitionCache(assert);
        await widenPersonSchema();

        let response = await request
          .post('/')
          .send({
            data: {
              type: 'card',
              attributes: { firstName: 'Van Gogh', lastName: 'Tangle' },
              meta: {
                adoptsFrom: {
                  // Absolute: `createCard` serializes relative to the new
                  // instance's own directory, so a relative ref would resolve
                  // under `Person/` rather than the realm root.
                  module: rri(`${realmURL.href}person`),
                  name: 'Person',
                },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json')
          .set(DURING_PRERENDER_HEADER, 'true');

        assert.strictEqual(
          response.status,
          201,
          `HTTP 201 status — ${JSON.stringify(response.body)}`,
        );
        // A prerender-originated write indexes deferred, so its response is
        // echoed straight from the serialization that lands on disk — the
        // same document the stale schema would have stripped the field from.
        assert.strictEqual(
          response.body.data.attributes?.lastName,
          'Tangle',
          'the field the rewrite added survived serialization',
        );
      });

      test('an instance of a module that has never been cached still serializes', async function (assert) {
        // The bug is a stale cache HIT and the fix turns those into misses,
        // so this pins the other half of the contract: a module with no
        // cached row at all still resolves, through `prerenderModule` reading
        // it off disk, rather than failing the write.
        await testRealm.write(
          'pet.gts',
          `
            import { contains, field, CardDef } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class Pet extends CardDef {
              @field nickname = contains(StringField);
            }
          `,
          { waitForIndex: false },
        );

        let response = await request
          .post('/')
          .send({
            data: {
              type: 'card',
              attributes: { nickname: 'Mango' },
              meta: {
                adoptsFrom: {
                  module: rri(`${realmURL.href}pet`),
                  name: 'Pet',
                },
              },
            },
          })
          .set('Accept', 'application/vnd.card+json')
          .set(DURING_PRERENDER_HEADER, 'true');

        assert.strictEqual(
          response.status,
          201,
          `HTTP 201 status — ${JSON.stringify(response.body)}`,
        );
        assert.strictEqual(
          response.body.data.attributes?.nickname,
          'Mango',
          'a never-cached module serializes through the read-through path',
        );
      });
    },
  );
});
