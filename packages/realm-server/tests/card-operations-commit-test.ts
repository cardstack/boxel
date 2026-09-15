import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { open } from 'fs/promises';
import fsExtra from 'fs-extra';
const { existsSync, readFileSync, statSync, writeFileSync } = fsExtra;
import type { Test, SuperTest } from 'supertest';
import type { DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';

import {
  CONTENT_HASH_WHOLE_LIMIT_BYTES,
  computeContentHash,
  computeContentHashFromRanges,
  rri,
} from '@cardstack/runtime-common';
import {
  commitBatch,
  isOperationFailure,
  type BatchDocument,
  type BatchEntry,
} from '@cardstack/runtime-common/card-operations';
import type {
  DBAdapter,
  LocalPath,
  LooseSingleCardDocument,
  Realm,
  RealmAdapter,
} from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  setupPermissionedRealmCached,
  setupMatrixRoom,
  waitUntil,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');
const testRealmHref = testRealm.href;
// The module named absolutely rather than relative to the realm root: a create
// lands under its type's directory, one level deep, so a root-relative
// spelling would resolve against that directory instead of the realm.
const PERSON = { module: rri(`${testRealmHref}person`), name: 'Person' };
const EVENT_LOG = {
  module: rri(`${testRealmHref}event-log`),
  name: 'EventLog',
};
const HOTFIX_EVENT = {
  module: rri(`${testRealmHref}event-log`),
  name: 'HotfixEvent',
};

// ============================================================================
// The batch coordinator, driven against a real realm.
//
// What is under test is what only exists against a real realm: the bytes that
// land on disk, how many index jobs the commit enqueues, how many index events
// it broadcasts, and byte-for-byte agreement with the `PATCH` handler. The
// coordinator is called directly with the realm's own batch core rather than
// through a stub, since a stub is exactly what those properties are not
// observable through. Everything a batch decides before it commits — which
// files it would write, where a local id resolves, whether it commits at all —
// is checked against a stub instead, where "nothing is committed" is the
// property itself rather than a proxy for it.
// ============================================================================

function makeFileSystem(): Record<string, string | LooseSingleCardDocument> {
  return {
    'person.gts': `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import NumberField from "@cardstack/base/number";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field hourlyRate = contains(NumberField);
        @field friend = linksTo(() => Person, { searchable: true });
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /> \${{@model.hourlyRate}}</h1>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1>Embedded Person: <@fields.firstName/></h1>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1>Fitted Person: <@fields.firstName/></h1>
          </template>
        }
      }
    `,
    // A card whose `containsMany` holds composite items, one of whose fields
    // is a link — the shape `appendContainsMany` writes all three legs for.
    'event-log.gts': `
      import { contains, containsMany, field, linksTo, CardDef, FieldDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { Person } from "./person";

      export class LogEvent extends FieldDef {
        @field label = contains(StringField);
        @field author = linksTo(() => Person);
      }

      export class HotfixEvent extends LogEvent {
        @field severity = contains(StringField);
      }

      export class EventLog extends CardDef {
        @field title = contains(StringField);
        @field events = containsMany(LogEvent);
        @field notes = containsMany(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template><h1><@fields.title /></h1></template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template><h1><@fields.title /></h1></template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template><h1><@fields.title /></h1></template>
        }
      }
    `,
    // The files the file-content writes work on. Each test that changes one
    // has its own, so the file's tests do not have to be ordered against each
    // other, and the two kinds a write is refused on — a module's source and
    // binary content — are here to be refused.
    'release-notes.md': '# Release notes\n\n- shipped\n',
    'changelog.md': '# Changelog\n\n- first\n',
    'rollback-notes.md': '# Rollback notes\n',
    'rollback-changelog.md': '# Rollback changelog\n',
    'telemetry.log': 'boot\n',
    'serial.log': 'boot\n',
    'batch.log': 'boot\n',
    'rollback.log': 'boot\n',
    'mixed.log': 'boot\n',
    'untouched.log': 'boot\n',
    'noop-then-append.log': 'boot\n',
    'chart.png': '\u0089PNG\r\n\u001a\n',
    ...Object.fromEntries(
      ['append-legs', 'append-visible', 'append-mixed', 'append-rollback'].map(
        (name) => [
          `${name}.json`,
          {
            data: {
              type: 'card',
              attributes: { title: 'Deploys', events: [], notes: [] },
              meta: { adoptsFrom: EVENT_LOG },
            },
          },
        ],
      ),
    ),
    ...Object.fromEntries(
      [
        // A card per test that mutates one, so the file's tests do not have to
        // be ordered against each other.
        'append-sibling',
        'commit-write',
        'commit-delete',
        'version-target',
        'patch-over-http',
        'patch-over-batch',
        'unchanged',
        'legacy-version',
        'create-parity-target',
        'file-update-refused',
        'mixed-card',
        'mixed-rollback-card',
      ].map((name) => [
        `${name}.json`,
        {
          data: {
            type: 'card',
            attributes: { firstName: 'Original', hourlyRate: 10 },
            meta: { adoptsFrom: PERSON },
          },
        },
      ]),
    ),
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let realmAdapter: RealmAdapter;
  let testDbAdapter: DBAdapter;
  let request: RealmRequest;
  let serverRequest: SuperTest<Test>;
  let testRealmHttpServer: Server;
  let dir: DirResult;

  setupPermissionedRealmCached(hooks, {
    mode: 'before',
    realmURL: testRealm,
    permissions: {
      '*': ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
    },
    subscribeToRealmEvents: true,
    fileSystem: makeFileSystem(),
    onRealmSetup(args) {
      realm = args.testRealm;
      realmAdapter = args.testRealmAdapter;
      testDbAdapter = args.dbAdapter;
      request = withRealmPath(args.request, testRealm);
      serverRequest = args.request;
      testRealmHttpServer = args.testRealmHttpServer;
      dir = args.dir;
    },
  });

  let { getMessagesSince } = setupMatrixRoom(hooks, () => ({
    testRealm: realm,
    testRealmHttpServer,
    request,
    serverRequest,
    dir,
    dbAdapter: testDbAdapter as PgAdapter,
  }));

  function realmFile(localPath: string): string {
    return join(dir.name, 'realm_server_1', 'test', localPath);
  }

  async function indexJobIds(): Promise<number[]> {
    let rows = (await testDbAdapter.execute(
      `select id from jobs where job_type = 'incremental-index'
         and concurrency_group = $1 order by id`,
      { bind: [`indexing:${realm.url}`] },
    )) as { id: number | string }[];
    return rows.map((row) => Number(row.id));
  }

  async function realmEventsSince(since: number) {
    let messages = await getMessagesSince(since);
    return messages
      .filter((message) => message.type === APP_BOXEL_REALM_EVENT_TYPE)
      .map((message) => message.content as RealmEventContent);
  }

  async function incrementalIndexEventsSince(
    since: number,
  ): Promise<IncrementalIndexEventContent[]> {
    return (await realmEventsSince(since)).filter(
      (event): event is IncrementalIndexEventContent =>
        event.eventName === 'index' && event.indexType === 'incremental',
    );
  }

  // The realm events a batch is answerable for: the incremental index event it
  // broadcasts, and the file-change event naming a path it touched. Filtering
  // by path rather than counting everything keeps the assertion about this
  // batch — a realm serving a suite broadcasts for its own reasons too.
  function eventsNaming(events: RealmEventContent[], localPath: string) {
    let instanceURL = `${testRealmHref}${localPath.replace(/\.json$/, '')}`;
    return events.filter((event) => {
      if (event.eventName === 'update') {
        return [
          ...(event.added ?? []),
          ...(event.updated ?? []),
          ...(event.removed ?? []),
        ].includes(localPath);
      }
      if (event.eventName === 'index' && event.indexType === 'incremental') {
        return event.invalidations.includes(instanceURL);
      }
      return false;
    });
  }

  async function commit(entries: BatchEntry[], clientRequestId?: string) {
    return await commitBatch(realm.batchCore, entries, {
      clientRequestId: clientRequestId ?? null,
      actor: '@tester:localhost',
    });
  }

  // What a batch refused, as the caller sees it: the status, the code, and
  // which entry produced it. A batch that commits instead returns undefined,
  // which is what a test asserting a refusal fails on.
  async function refusal(
    entries: BatchEntry[],
  ): Promise<{ status: number; code: string; entry: unknown } | undefined> {
    try {
      await commit(entries);
    } catch (err: unknown) {
      if (!isOperationFailure(err)) {
        throw err;
      }
      return {
        status: err.error.status,
        code: err.error.code,
        entry: err.error.meta?.entry,
      };
    }
    return undefined;
  }

  // The `links.self` a stored relationship holds, resolved against the card
  // whose file carries it. Serialization is free to record a link relative to
  // the card that holds it, so the absolute identity is what a test compares.
  function storedLink(localPath: string, field: string): string | undefined {
    let doc = JSON.parse(readFileSync(realmFile(localPath), 'utf8'));
    let self = doc.data?.relationships?.[field]?.links?.self;
    return self == null
      ? undefined
      : new URL(self, `${testRealmHref}${localPath}`).href;
  }

  test('a batch creates several cards and links them by local id', async function (assert) {
    let results = await commit([
      {
        op: 'create',
        lid: 'author',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Mango', hourlyRate: 100 },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'create',
        lid: 'sidekick',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Van Gogh' },
            relationships: {
              friend: { data: { lid: 'author', type: 'card' } },
            },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);

    assert.strictEqual(results.length, 2, 'one result per entry, in order');
    assert.deepEqual(
      results.map((result) => result && 'lid' in result && result.lid),
      ['author', 'sidekick'],
      'each create echoes the local id the client named it with',
    );
    assert.deepEqual(
      results.map((result) => result?.id),
      [`${testRealmHref}Person/author`, `${testRealmHref}Person/sidekick`],
      'a local id maps to the URL the realm minted for it',
    );
    assert.ok(
      existsSync(realmFile('Person/author.json')),
      'the first card is on disk',
    );
    assert.ok(
      existsSync(realmFile('Person/sidekick.json')),
      'the second card is on disk',
    );
    assert.strictEqual(
      storedLink('Person/sidekick.json', 'friend'),
      `${testRealmHref}Person/author`,
      'the link resolves to the card the other entry in the batch minted',
    );
    for (let result of results) {
      assert.true(
        (result?.meta.version ?? '').length > 0,
        'each result carries the version the file now holds',
      );
    }
  });

  test('a failing entry leaves the whole batch unwritten, unindexed and unannounced', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let failure: unknown;
    try {
      await commit([
        {
          op: 'create',
          lid: 'never-written',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Ghost' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'update',
          href: `${testRealmHref}does-not-exist`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Nope' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ]);
    } catch (err: unknown) {
      failure = err;
    }

    assert.ok(isOperationFailure(failure), 'the batch is rejected');
    if (isOperationFailure(failure)) {
      assert.strictEqual(failure.error.status, 404, "the entry's own status");
      assert.strictEqual(failure.error.code, 'target-not-found');
      assert.strictEqual(
        failure.error.meta?.entry,
        1,
        'the refusal names the position of the entry that produced it',
      );
    }
    assert.notOk(
      existsSync(realmFile('Person/never-written.json')),
      'the entry ahead of the failure is not written',
    );
    assert.deepEqual(
      await indexJobIds(),
      jobsBefore,
      'no incremental index job is enqueued',
    );
    assert.deepEqual(
      eventsNaming(await realmEventsSince(since), 'Person/never-written.json'),
      [],
      'nothing about the abandoned batch is announced to the realm',
    );
  });

  test('a batch of one write and one delete commits under one index job and one index event', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let results = await commit(
      [
        {
          op: 'update',
          href: `${testRealmHref}commit-write`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Renamed' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        { op: 'delete', href: `${testRealmHref}commit-delete` },
      ],
      'batch-1',
    );

    assert.strictEqual(
      results[1],
      null,
      'a delete has no state left to describe',
    );
    assert.ok(results[0], 'the write reports its identity');
    assert.notOk(
      existsSync(realmFile('commit-delete.json')),
      'the deleted card is gone from disk',
    );
    assert.true(
      readFileSync(realmFile('commit-write.json'), 'utf8').includes('Renamed'),
      'the written card holds the patched value',
    );

    let newJobs = (await indexJobIds()).filter(
      (id) => !jobsBefore.includes(id),
    );
    assert.strictEqual(
      newJobs.length,
      1,
      `the write and the delete share one index job (got ${newJobs.length})`,
    );

    // The realm broadcasts into the Matrix room out of band from the commit,
    // so wait for the batch's own event to arrive before counting.
    await waitUntil(async () => {
      let seen = await incrementalIndexEventsSince(since);
      return seen.some((event) => event.clientRequestId === 'batch-1');
    });
    // Filtered to the paths this batch touched rather than counted over the
    // window: the realm is shared across this file's tests and broadcasts are
    // fire-and-forget, so a straggler from an earlier test can land inside it.
    let indexEvents = (await incrementalIndexEventsSince(since)).filter(
      (event) =>
        event.invalidations.includes(`${testRealmHref}commit-write`) ||
        event.invalidations.includes(`${testRealmHref}commit-delete`),
    );
    assert.strictEqual(
      indexEvents.length,
      1,
      `the batch broadcasts one index event (got ${indexEvents.length})`,
    );
    assert.strictEqual(
      indexEvents[0].clientRequestId,
      'batch-1',
      "the event carries the batch's own client request id",
    );
    assert.deepEqual(
      [...indexEvents[0].invalidations].sort(),
      [`${testRealmHref}commit-write`, `${testRealmHref}commit-delete`].sort(),
      'the one event covers both the write and the removal',
    );
  });

  // ==========================================================================
  // `appendContainsMany`, against a real realm
  //
  // The bytes an append describes are only bytes once a realm writes them, and
  // the property that matters — that they are the bytes loading, changing and
  // writing back the file would have produced — is only checkable on disk.
  // ==========================================================================

  // What loading the stored file, making the same change in memory and writing
  // it back would produce. An append never does this; the cases below use it to
  // say what the file should end up holding.
  //
  // Written back the way the file itself is written — its indentation, and
  // whatever trails its last brace. How the realm stored a card is the realm's
  // to decide (these fixtures land minified, with a trailing newline), and
  // reformatting it here would make the expectation a file nothing would ever
  // write. An append edits the document in place and leaves everything around
  // it alone, so the expectation has to do the same.
  function loadModifyWrite(
    localPath: string,
    change: (resource: any) => void,
  ): string {
    let stored = readFileSync(realmFile(localPath), 'utf8');
    let doc = JSON.parse(stored);
    change(doc.data);
    let indented = /\n([ \t]+)/.exec(stored);
    let trailing = /\}(\s*)$/.exec(stored);
    return (
      JSON.stringify(doc, null, indented ? indented[1] : '') +
      (trailing ? trailing[1] : '')
    );
  }

  test("an append writes an item's values, its links and its type into the stored file", async function (assert) {
    // Assignment rather than mutation throughout, because what the realm
    // serialized the card with on its way to disk is the realm's to decide: a
    // member it left out is added here where an append would add it — at the
    // end of its container — and one it wrote keeps the place it wrote it in.
    let expected = loadModifyWrite('append-legs.json', (resource) => {
      resource.attributes ??= {};
      resource.attributes.events = [
        ...(resource.attributes.events ?? []),
        { label: 'shipped' },
        { label: 'hotfix', severity: 'high' },
      ];
      resource.attributes.notes = [
        ...(resource.attributes.notes ?? []),
        'rolled forward',
      ];
      resource.relationships = {
        ...resource.relationships,
        // Relative to the file that holds it, the way the realm's own
        // serializer records a link inside the writing realm.
        'events.1.author': { links: { self: './Person/mango' } },
      };
      resource.meta.fields = {
        ...resource.meta.fields,
        events: [
          ...(resource.meta.fields?.events ?? []),
          {},
          { adoptsFrom: HOTFIX_EVENT },
        ],
      };
    });

    let [result] = await commit([
      {
        op: 'create',
        lid: 'mango',
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Mango' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'appendContainsMany',
        href: `${testRealmHref}append-legs`,
        fields: {
          events: [
            { label: 'shipped' },
            {
              label: 'hotfix',
              severity: 'high',
              author: { lid: 'mango' },
              meta: { adoptsFrom: HOTFIX_EVENT },
            },
          ],
          notes: ['rolled forward'],
        },
      },
    ]);

    assert.ok(result, 'the create reports its identity');
    assert.strictEqual(
      readFileSync(realmFile('append-legs.json'), 'utf8'),
      expected,
      'the file holds what loading it, appending and writing it back would ' +
        'have — values in the array, the link under its flattened key, the ' +
        "item's own type in the sidecar",
    );
  });

  test('a card an append changed serves the new item back', async function (assert) {
    await commit([
      {
        op: 'appendContainsMany',
        href: `${testRealmHref}append-visible`,
        field: 'events',
        items: [{ label: 'indexed' }],
      },
    ]);

    let response = await request
      .get('/append-visible')
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(response.status, 200, 'the card is served');
    // The labels rather than the items: what a serialized item carries
    // alongside them is the serializer's, and what this pins is that the
    // spliced file re-indexed as the card it is.
    assert.deepEqual(
      (response.body.data.attributes.events ?? []).map(
        (event: { label?: string }) => event.label,
      ),
      ['indexed'],
      'the appended item is in the document the realm assembles',
    );
  });

  test('an append and a patch to another card commit under one index job and one index event', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    await commit(
      [
        {
          op: 'appendContainsMany',
          href: `${testRealmHref}append-mixed`,
          field: 'notes',
          items: ['mixed'],
        },
        {
          op: 'update',
          href: `${testRealmHref}append-sibling`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Alongside' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
      ],
      'batch-append',
    );

    let newJobs = (await indexJobIds()).filter(
      (id) => !jobsBefore.includes(id),
    );
    assert.strictEqual(
      newJobs.length,
      1,
      `the append and the patch share one index job (got ${newJobs.length})`,
    );

    await waitUntil(async () => {
      let seen = await incrementalIndexEventsSince(since);
      return seen.some((event) => event.clientRequestId === 'batch-append');
    });
    let indexEvents = (await incrementalIndexEventsSince(since)).filter(
      (event) =>
        event.invalidations.includes(`${testRealmHref}append-mixed`) ||
        event.invalidations.includes(`${testRealmHref}append-sibling`),
    );
    assert.strictEqual(
      indexEvents.length,
      1,
      `the batch broadcasts one index event (got ${indexEvents.length})`,
    );
    assert.deepEqual(
      [...indexEvents[0].invalidations].sort(),
      [`${testRealmHref}append-mixed`, `${testRealmHref}append-sibling`].sort(),
      'the one event covers the card the append changed and the patched one',
    );
  });

  test('a failing sibling leaves the file an append would have changed byte-identical', async function (assert) {
    let before = readFileSync(realmFile('append-rollback.json'), 'utf8');
    let jobsBefore = await indexJobIds();

    let failure: unknown;
    try {
      await commit([
        {
          op: 'appendContainsMany',
          href: `${testRealmHref}append-rollback`,
          field: 'notes',
          items: ['never lands'],
        },
        { op: 'delete', href: `${testRealmHref}not-a-card` },
      ]);
    } catch (err: unknown) {
      failure = err;
    }

    assert.strictEqual(
      isOperationFailure(failure) ? failure.error.status : undefined,
      404,
      'the batch is refused for the entry that cannot be carried out',
    );
    assert.strictEqual(
      readFileSync(realmFile('append-rollback.json'), 'utf8'),
      before,
      'and the file the append would have changed is exactly as it was',
    );
    assert.deepEqual(
      await indexJobIds(),
      jobsBefore,
      'with nothing queued for indexing',
    );
  });

  test('a base version is reported as matched or moved against the version the file held', async function (assert) {
    let [first] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}version-target`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'First' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.ok(first, 'the first write reports a version');
    let version = first!.meta.version;
    assert.strictEqual(
      first!.meta.baseMatched,
      undefined,
      'an unconditional write reports no base match',
    );

    let [matched] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}version-target`,
        baseVersion: version,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Second' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.true(
      matched!.meta.baseMatched,
      'the base the caller named is the one the file held',
    );

    let [moved] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}version-target`,
        baseVersion: version,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Third' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.false(
      moved!.meta.baseMatched,
      'the file has moved past the base the caller named',
    );
    assert.true(
      readFileSync(realmFile('version-target.json'), 'utf8').includes('Third'),
      'a moved base is reported, not refused — the write still lands',
    );
  });

  test('an update writes the same bytes a PATCH of the same document writes', async function (assert) {
    let patch: BatchDocument = {
      data: {
        type: 'card',
        attributes: { firstName: 'Paparazzi', hourlyRate: 42 },
        meta: { adoptsFrom: PERSON },
      },
    };

    let response = await request
      .patch('/patch-over-http')
      .send(patch)
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(response.status, 200, 'the PATCH is served');

    await commit([
      {
        op: 'update',
        href: `${testRealmHref}patch-over-batch`,
        document: patch,
      },
    ]);

    assert.strictEqual(
      readFileSync(realmFile('patch-over-batch.json'), 'utf8'),
      readFileSync(realmFile('patch-over-http.json'), 'utf8'),
      'the two files are byte-identical',
    );
  });

  test('a create writes the same bytes a POST of the same document writes', async function (assert) {
    // The half of the parity that has a reason to differ: `createCard` stamps
    // `meta.realmURL` from the request's own URL, where staging stamps it from
    // the realm root, and serialization reads that value to decide how the
    // links it writes are spelled. A POST to the realm root is where the two
    // agree, so it is where the bytes are comparable; a POST into a
    // subdirectory is a spelling the facade has yet to settle.
    let document: BatchDocument = {
      data: {
        type: 'card',
        attributes: { firstName: 'Paparazzi', hourlyRate: 42 },
        relationships: {
          friend: { links: { self: `${testRealmHref}create-parity-target` } },
        },
        meta: { adoptsFrom: PERSON },
      },
    };

    let response = await request
      .post('/')
      .send({ data: { ...document.data, lid: 'create-over-http' } })
      .set('Accept', 'application/vnd.card+json');
    assert.strictEqual(response.status, 201, 'the POST is served');

    await commit([{ op: 'create', lid: 'create-over-batch', document }]);

    assert.strictEqual(
      readFileSync(realmFile('Person/create-over-batch.json'), 'utf8'),
      readFileSync(realmFile('Person/create-over-http.json'), 'utf8'),
      'the two files are byte-identical',
    );
  });

  test('a version is read from the file, and an unchanged write records it', async function (assert) {
    // A file written before the realm recorded content hashes carries none on
    // its row. Blanking the row reaches that state, and is what makes both
    // halves of this test falsifiable: a version is computed from the bytes,
    // so it is issued and honored with the row empty, and the no-op write
    // fills the row in on its way past.
    await testDbAdapter.execute(
      `update realm_file_meta set content_hash = null
         where realm_url = $1 and file_path = $2`,
      { bind: [realm.url, 'legacy-version.json'] },
    );

    let [unchanged] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}legacy-version`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Original' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    let version = unchanged!.meta.version;
    assert.true(version.length > 0, 'the no-op write still reports a version');

    // The row the blanking emptied now carries the version the write
    // reported. Nothing about `baseVersion` depends on this — that is read
    // from the bytes — but the file's own metadata resource reads the row,
    // and a file the realm has never rewritten would otherwise carry none.
    let [row] = await testDbAdapter.execute(
      `select content_hash from realm_file_meta
         where realm_url = $1 and file_path = $2`,
      { bind: [realm.url, 'legacy-version.json'] },
    );
    assert.strictEqual(
      row?.content_hash,
      version,
      'the unchanged write records the version it reported',
    );

    let [next] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}legacy-version`,
        baseVersion: version,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Moved on' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);
    assert.true(
      next!.meta.baseMatched,
      'the version the no-op reported names the bytes the merge is computed ' +
        'over, so a later write can quote it as its base',
    );
  });

  test('a patch that changes nothing leaves the file exactly as it is', async function (assert) {
    let before = readFileSync(realmFile('unchanged.json'), 'utf8');
    let jobsBefore = await indexJobIds();

    let [result] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}unchanged`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Original' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);

    assert.strictEqual(
      readFileSync(realmFile('unchanged.json'), 'utf8'),
      before,
      'the stored bytes are untouched',
    );
    assert.true(
      (result?.meta.version ?? '').length > 0,
      'the result still reports the version the file holds',
    );
    assert.deepEqual(
      await indexJobIds(),
      jobsBefore,
      'nothing is queued for indexing',
    );
  });

  // ==========================================================================
  // The file-content writes, against a real realm
  //
  // What only exists here is the file on disk: the bytes an update leaves, the
  // line an append adds to the end of them, and the version each reports,
  // which the realm computes from what it wrote rather than from what it was
  // handed. The batch guarantees are the same ones the card entries are held
  // to — one index job, one index event, nothing written when any entry fails
  // — exercised with file entries as first-class members of the batch.
  // ==========================================================================

  // The batch core with the reads it offers under watch, so a test can say
  // what the batch asked for. An append's whole claim is that it does not ask
  // for its target, and this is the surface through which it would.
  function watchingReads(seen: string[]) {
    let core = realm.batchCore;
    return {
      ...core,
      readSourceFile: (localPath: LocalPath) => {
        seen.push(localPath);
        return core.readSourceFile(localPath);
      },
      openSourceBytes: (localPath: LocalPath) => {
        seen.push(localPath);
        return core.openSourceBytes(localPath);
      },
    };
  }

  test("an update replaces a file's content and moves its version", async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let [before] = await commit([
      {
        op: 'update',
        href: `${testRealmHref}release-notes.md`,
        content: '#\n',
      },
    ]);
    let [result] = await commit(
      [
        {
          op: 'update',
          href: `${testRealmHref}release-notes.md`,
          content: '# Release notes\n\n- shipped\n- rolled forward\n',
        },
      ],
      'file-update',
    );

    assert.strictEqual(
      readFileSync(realmFile('release-notes.md'), 'utf8'),
      '# Release notes\n\n- shipped\n- rolled forward\n',
      'the file holds the content the entry carried, at the path its url ' +
        'names rather than at that path plus `.json`',
    );
    assert.strictEqual(
      result?.id,
      `${testRealmHref}release-notes.md`,
      'the result names the file',
    );
    assert.strictEqual(
      result?.meta.version,
      computeContentHash('# Release notes\n\n- shipped\n- rolled forward\n'),
      'and reports the version of the bytes now on disk',
    );
    assert.notStrictEqual(
      result?.meta.version,
      before?.meta.version,
      'which is not the version it held before',
    );

    let newJobs = (await indexJobIds()).filter(
      (id) => !jobsBefore.includes(id),
    );
    assert.strictEqual(
      newJobs.length,
      2,
      `each of the two batches enqueues one index job (got ${newJobs.length})`,
    );
    await waitUntil(async () => {
      let seen = await incrementalIndexEventsSince(since);
      return seen.some((event) => event.clientRequestId === 'file-update');
    });
    assert.strictEqual(
      (await incrementalIndexEventsSince(since)).filter(
        (event) => event.clientRequestId === 'file-update',
      ).length,
      1,
      'and the second broadcasts one index event',
    );
  });

  test('an update on a card instance is not a replacement of its bytes', async function (assert) {
    let before = readFileSync(realmFile('file-update-refused.json'), 'utf8');
    let failure = await refusal([
      {
        op: 'update',
        href: `${testRealmHref}file-update-refused`,
        content: 'not a card any more',
      },
    ]);

    assert.strictEqual(failure?.status, 405);
    assert.strictEqual(failure?.code, 'operation-not-allowed');
    assert.strictEqual(
      readFileSync(realmFile('file-update-refused.json'), 'utf8'),
      before,
      "the card's stored source is untouched",
    );
  });

  test('a line is appended without the file being read, and the version moves', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();
    let seen: string[] = [];

    let [result] = await commitBatch(
      watchingReads(seen),
      [
        {
          op: 'appendLine',
          href: `${testRealmHref}telemetry.log`,
          params: { line: 'deploy 41' },
        },
      ],
      { clientRequestId: 'append-line', actor: '@tester:localhost' },
    );

    assert.strictEqual(
      readFileSync(realmFile('telemetry.log'), 'utf8'),
      'boot\ndeploy 41\n',
      'exactly the line and its terminator are added to what was there',
    );
    assert.deepEqual(
      seen,
      [],
      'and nothing on the batch read surface was asked for the file',
    );
    assert.strictEqual(
      result?.meta.version,
      computeContentHash('boot\ndeploy 41\n'),
      'the version reported is the one the appended file now holds, which ' +
        'the realm computed from what it wrote',
    );

    let newJobs = (await indexJobIds()).filter(
      (id) => !jobsBefore.includes(id),
    );
    assert.strictEqual(
      newJobs.length,
      1,
      `the append enqueues one index job (got ${newJobs.length})`,
    );
    await waitUntil(async () => {
      let seenEvents = await incrementalIndexEventsSince(since);
      return seenEvents.some(
        (event) => event.clientRequestId === 'append-line',
      );
    });
    assert.strictEqual(
      (await incrementalIndexEventsSince(since)).filter(
        (event) => event.clientRequestId === 'append-line',
      ).length,
      1,
      'and broadcasts one index event',
    );
  });

  test('a line is appended to a text file, and to nothing else', async function (assert) {
    let png = readFileSync(realmFile('chart.png'), 'utf8');
    let card = readFileSync(realmFile('file-update-refused.json'), 'utf8');

    for (let [href, what] of [
      [`${testRealmHref}chart.png`, 'binary content'],
      [`${testRealmHref}file-update-refused`, 'a card'],
      [`${testRealmHref}file-update-refused.json`, "a card's stored source"],
    ]) {
      let failure = await refusal([
        { op: 'appendLine', href, params: { line: 'deploy 41' } },
      ]);
      assert.strictEqual(failure?.status, 405, `${what} is refused`);
      assert.strictEqual(failure?.code, 'operation-not-allowed', `${what}`);
    }

    assert.strictEqual(
      readFileSync(realmFile('chart.png'), 'utf8'),
      png,
      'the binary file is untouched',
    );
    assert.strictEqual(
      readFileSync(realmFile('file-update-refused.json'), 'utf8'),
      card,
      'and so is the card',
    );
  });

  test('one call appends one line', async function (assert) {
    let before = readFileSync(realmFile('untouched.log'), 'utf8');
    let failure = await refusal([
      {
        op: 'appendLine',
        href: `${testRealmHref}untouched.log`,
        params: { line: 'deploy 41\ndeploy 42' },
      },
    ]);

    assert.strictEqual(failure?.status, 400);
    assert.strictEqual(failure?.code, 'invalid-params');
    assert.strictEqual(
      readFileSync(realmFile('untouched.log'), 'utf8'),
      before,
      'the file is untouched',
    );
  });

  test('two lines appended to one file in one batch both land, in order', async function (assert) {
    let jobsBefore = await indexJobIds();

    let results = await commit([
      {
        op: 'appendLine',
        href: `${testRealmHref}serial.log`,
        params: { line: 'first' },
      },
      {
        op: 'appendLine',
        href: `${testRealmHref}serial.log`,
        params: { line: 'second' },
      },
    ]);

    assert.strictEqual(
      readFileSync(realmFile('serial.log'), 'utf8'),
      'boot\nfirst\nsecond\n',
      'the file ends with both lines, in the order the entries were sent',
    );
    assert.strictEqual(
      results[0]?.meta.version,
      results[1]?.meta.version,
      'both entries report the version the commit left the file at, since ' +
        'one commit is what produced it',
    );
    assert.strictEqual(
      results[0]?.meta.version,
      computeContentHash('boot\nfirst\nsecond\n'),
      'which is the version of the bytes on disk',
    );
    let newJobs = (await indexJobIds()).filter(
      (id) => !jobsBefore.includes(id),
    );
    assert.strictEqual(
      newJobs.length,
      1,
      `the two entries share one index job (got ${newJobs.length})`,
    );
  });

  test('a file-only batch commits under one index job and one index event', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let results = await commit(
      [
        {
          op: 'update',
          href: `${testRealmHref}release-notes.md`,
          content: '# Release notes\n\n- batched\n',
        },
        {
          op: 'update',
          href: `${testRealmHref}changelog.md`,
          content: '# Changelog\n\n- batched\n',
        },
        {
          op: 'appendLine',
          href: `${testRealmHref}batch.log`,
          params: { line: 'batched' },
        },
      ],
      'file-batch',
    );

    assert.deepEqual(
      [
        readFileSync(realmFile('release-notes.md'), 'utf8'),
        readFileSync(realmFile('changelog.md'), 'utf8'),
        readFileSync(realmFile('batch.log'), 'utf8'),
      ],
      [
        '# Release notes\n\n- batched\n',
        '# Changelog\n\n- batched\n',
        'boot\nbatched\n',
      ],
      'every file holds what its entry described',
    );
    assert.deepEqual(
      results.map((result) => result?.meta.version),
      [
        computeContentHash('# Release notes\n\n- batched\n'),
        computeContentHash('# Changelog\n\n- batched\n'),
        computeContentHash('boot\nbatched\n'),
      ],
      'and every version in the results is the version of the bytes on disk',
    );

    let newJobs = (await indexJobIds()).filter(
      (id) => !jobsBefore.includes(id),
    );
    assert.strictEqual(
      newJobs.length,
      1,
      `the three entries share one index job (got ${newJobs.length})`,
    );
    await waitUntil(async () => {
      let seen = await incrementalIndexEventsSince(since);
      return seen.some((event) => event.clientRequestId === 'file-batch');
    });
    assert.strictEqual(
      (await incrementalIndexEventsSince(since)).filter(
        (event) => event.clientRequestId === 'file-batch',
      ).length,
      1,
      'and broadcast one index event',
    );
  });

  test('a failing entry leaves every file in the batch byte-identical', async function (assert) {
    let before = [
      readFileSync(realmFile('rollback-notes.md'), 'utf8'),
      readFileSync(realmFile('rollback-changelog.md'), 'utf8'),
      readFileSync(realmFile('rollback.log'), 'utf8'),
    ];
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let failure = await refusal([
      {
        op: 'update',
        href: `${testRealmHref}rollback-notes.md`,
        content: '# Never written\n',
      },
      {
        op: 'appendLine',
        href: `${testRealmHref}rollback.log`,
        params: { line: 'never written' },
      },
      {
        op: 'appendLine',
        href: `${testRealmHref}chart.png`,
        params: { line: 'refused' },
      },
    ]);

    assert.strictEqual(failure?.status, 405, 'the batch is refused');
    assert.strictEqual(failure?.entry, 2, 'at the entry that produced it');
    assert.deepEqual(
      [
        readFileSync(realmFile('rollback-notes.md'), 'utf8'),
        readFileSync(realmFile('rollback-changelog.md'), 'utf8'),
        readFileSync(realmFile('rollback.log'), 'utf8'),
      ],
      before,
      'and every file the batch would have changed is byte-identical',
    );
    assert.deepEqual(
      await indexJobIds(),
      jobsBefore,
      'no index job is enqueued',
    );
    assert.deepEqual(
      eventsNaming(await realmEventsSince(since), 'rollback.log'),
      [],
      'and nothing about the abandoned batch is announced',
    );
  });

  test('a batch of cards and files commits under one index job and one index event', async function (assert) {
    let jobsBefore = await indexJobIds();
    let since = Date.now();

    let results = await commit(
      [
        {
          op: 'create',
          lid: 'mixed-friend',
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Mixed' },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'update',
          href: `${testRealmHref}mixed-card`,
          document: {
            data: {
              type: 'card',
              attributes: { firstName: 'Linked' },
              relationships: {
                friend: { data: { lid: 'mixed-friend', type: 'card' } },
              },
              meta: { adoptsFrom: PERSON },
            },
          },
        },
        {
          op: 'update',
          href: `${testRealmHref}changelog.md`,
          content: '# Changelog\n\n- mixed\n',
        },
        {
          op: 'appendLine',
          href: `${testRealmHref}mixed.log`,
          params: { line: 'mixed' },
        },
      ],
      'mixed-batch',
    );

    assert.strictEqual(
      storedLink('mixed-card.json', 'friend'),
      `${testRealmHref}Person/mixed-friend`,
      'the card links to the card the batch minted',
    );
    assert.strictEqual(
      readFileSync(realmFile('changelog.md'), 'utf8'),
      '# Changelog\n\n- mixed\n',
      'the file holds what its entry described',
    );
    assert.strictEqual(
      readFileSync(realmFile('mixed.log'), 'utf8'),
      'boot\nmixed\n',
      'and the log carries the line its entry appended',
    );
    assert.strictEqual(results.length, 4, 'one result per entry');

    let newJobs = (await indexJobIds()).filter(
      (id) => !jobsBefore.includes(id),
    );
    assert.strictEqual(
      newJobs.length,
      1,
      `cards and files share one index job (got ${newJobs.length})`,
    );
    await waitUntil(async () => {
      let seen = await incrementalIndexEventsSince(since);
      return seen.some((event) => event.clientRequestId === 'mixed-batch');
    });
    assert.strictEqual(
      (await incrementalIndexEventsSince(since)).filter(
        (event) => event.clientRequestId === 'mixed-batch',
      ).length,
      1,
      'and one index event',
    );
  });

  test('a failing card entry leaves the files in the batch untouched', async function (assert) {
    let before = readFileSync(realmFile('untouched.log'), 'utf8');

    let failure = await refusal([
      {
        op: 'appendLine',
        href: `${testRealmHref}untouched.log`,
        params: { line: 'never written' },
      },
      {
        op: 'update',
        href: `${testRealmHref}no-such-card`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Nope' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
    ]);

    assert.strictEqual(failure?.status, 404, 'the card entry is what failed');
    assert.strictEqual(
      readFileSync(realmFile('untouched.log'), 'utf8'),
      before,
      'and the file entry ahead of it wrote nothing',
    );
  });

  test('a failing file entry leaves the cards in the batch untouched', async function (assert) {
    let before = readFileSync(realmFile('mixed-rollback-card.json'), 'utf8');

    let failure = await refusal([
      {
        op: 'update',
        href: `${testRealmHref}mixed-rollback-card`,
        document: {
          data: {
            type: 'card',
            attributes: { firstName: 'Never written' },
            meta: { adoptsFrom: PERSON },
          },
        },
      },
      {
        op: 'appendLine',
        href: `${testRealmHref}chart.png`,
        params: { line: 'refused' },
      },
    ]);

    assert.strictEqual(failure?.status, 405, 'the file entry is what failed');
    assert.strictEqual(
      readFileSync(realmFile('mixed-rollback-card.json'), 'utf8'),
      before,
      'and the card entry ahead of it wrote nothing',
    );
  });

  test('a file replaced with its own content and then appended to is announced', async function (assert) {
    let since = Date.now();
    let before = readFileSync(realmFile('noop-then-append.log'), 'utf8');

    await commit(
      [
        {
          op: 'update',
          href: `${testRealmHref}noop-then-append.log`,
          content: before,
        },
        {
          op: 'appendLine',
          href: `${testRealmHref}noop-then-append.log`,
          params: { line: 'appended' },
        },
      ],
      'noop-then-append',
    );

    assert.strictEqual(
      readFileSync(realmFile('noop-then-append.log'), 'utf8'),
      `${before}appended\n`,
      'the line lands on the content the replacement left',
    );
    // The replacement found the file already holding its bytes, so it wrote
    // nothing and announced nothing — which is correct for it, and is exactly
    // what would leave the append's own change unannounced if the two legs
    // shared one answer to "has this path been announced yet".
    await waitUntil(async () => {
      let seen = eventsNaming(
        await realmEventsSince(since),
        'noop-then-append.log',
      );
      return seen.some((event) => event.eventName === 'update');
    });
    let announced = eventsNaming(
      await realmEventsSince(since),
      'noop-then-append.log',
    ).filter((event) => event.eventName === 'update');
    assert.ok(
      announced.length > 0,
      'the file change reaches subscribers, though the write leg had nothing ' +
        'to announce',
    );
  });

  test('appending to a file costs the line rather than the file', async function (assert) {
    // Large enough to be well past `CONTENT_HASH_WHOLE_LIMIT_BYTES`, which is
    // where the bound lives: above it a version is the byte length plus a hash
    // of the head and the tail, so producing one costs a fixed read however
    // large the file is.
    const SIZE = 32 * 1024 * 1024;
    const LINE = 'the last one';
    let filler = `${'x'.repeat(63)}\n`;
    writeFileSync(realmFile('bulk.log'), filler.repeat(SIZE / filler.length));
    let stored = statSync(realmFile('bulk.log')).size;
    // Anything the realm's watcher made of a file appearing under it settles
    // before the count below, so what is counted is the append.
    await realm.incrementalIndexing();

    // What the commit asks the adapter for, in bytes. This is the measurement
    // the claim needs, and a heap reading is not: every read on this path
    // yields `Uint8Array`s, whose backing stores `heapUsed` does not count, so
    // a version computed by reading the whole file end to end would register
    // as no growth at all.
    let read = 0;
    let readRange = realmAdapter.readRange.bind(realmAdapter);
    realmAdapter.readRange = async function* (path, start, end) {
      for await (let chunk of readRange(path, start, end)) {
        read += chunk.length;
        yield chunk;
      }
    };
    let result: Awaited<ReturnType<typeof commit>>[number];
    try {
      [result] = await commitBatch(
        realm.batchCore,
        [
          {
            op: 'appendLine',
            href: `${testRealmHref}bulk.log`,
            params: { line: LINE },
          },
        ],
        // The index job is the realm's own work over a file this size, and
        // its reads are not this operation's. It is drained below.
        { actor: '@tester:localhost', waitForIndex: false },
      );
    } finally {
      realmAdapter.readRange = readRange;
    }
    await realm.incrementalIndexing();

    assert.strictEqual(
      statSync(realmFile('bulk.log')).size,
      stored + LINE.length + 1,
      'the file grew by the line and its terminator and nothing else',
    );
    assert.strictEqual(
      result?.meta.version,
      await computeContentHashFromRanges(
        stored + LINE.length + 1,
        async (start, length) => {
          let handle = await open(realmFile('bulk.log'));
          try {
            let bytes = new Uint8Array(length);
            await handle.read(bytes, 0, length, start);
            return bytes;
          } finally {
            await handle.close();
          }
        },
      ),
      'the version reported is the fingerprint of the file it left',
    );
    assert.ok(
      read <= CONTENT_HASH_WHOLE_LIMIT_BYTES,
      `producing it read ${Math.round(read / 1024 / 1024)}MB of the ` +
        `${Math.round(stored / 1024 / 1024)}MB stored, which is within the ` +
        `ceiling a fingerprint is assembled under however large the file is`,
    );
  });
});
