import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  baseRealmRRI,
  rri,
  logger,
  param,
  type Definition,
  type DefinitionLookup,
  type Filter,
  type InstanceEntry,
  type Reader,
} from '@cardstack/runtime-common';
import { preWarmModulesTable } from '@cardstack/runtime-common/index-runner/prewarm-modules';
import {
  TessarQueryRegistry,
  type TessarDocument,
} from '@cardstack/runtime-common/tessar-query-registry';
import { setupDB } from './helpers/index.ts';
import {
  retrieveHeadHTML,
  retrieveIsolatedHTML,
} from '../lib/index-html-injection.ts';
import {
  assertTessarGeneration,
  tessarRequestedGeneration,
  TESSAR_INPUT_GENERATION_HEADER,
  tessarReadState,
} from '@cardstack/runtime-common/tessar-materialization';

const { module, test } = QUnit;
const realmURL = 'https://tessar.example/';
module('Tessar | bounded module prewarm', function () {
  test('a large invalidation set keeps complete module coverage with bounded dependency reads', async function (assert) {
    let invalidations = Array.from(
      { length: 751 },
      (_, i) => new URL(`${realmURL}${i}.json`),
    );
    invalidations.push(new URL(`${realmURL}helper.ts`));
    let reads: string[][] = [];
    let warmed = new Set<string>();
    let sourceReads: string[] = [];
    let log = logger('tessar-prewarm-test');
    let count = await preWarmModulesTable({
      realmURL: new URL(realmURL),
      invalidations,
      allRealmCardModules: [`${realmURL}sibling.gts`],
      virtualNetwork: new VirtualNetwork(),
      getDependencyRows: async (urls) => {
        reads.push(urls);
        return urls.flatMap((url) =>
          url.endsWith('/750.json')
            ? []
            : [
                {
                  url,
                  type: 'file' as const,
                  deps: null,
                  hasError: false,
                  isDeleted: false,
                  errorDoc: null,
                },
                {
                  url,
                  type: 'instance' as const,
                  deps: [
                    `${realmURL}record`,
                    `${realmURL}input.json`,
                    `${realmURL}styles.glimmer-scoped.css`,
                    'https://other.example/external',
                  ],
                  hasError: false,
                  isDeleted: false,
                  errorDoc: null,
                },
              ],
        );
      },
      reader: {
        readFile: async (url: URL) => {
          sourceReads.push(url.href);
          return {
            content: JSON.stringify({
              data: { meta: { adoptsFrom: { module: './novel' } } },
            }),
          };
        },
      } as Reader,
      definitionLookup: {
        populateDefinitionCacheEntry: async ({
          moduleURL,
        }: {
          moduleURL: string;
        }) => {
          warmed.add(moduleURL);
        },
      } as unknown as DefinitionLookup,
      getModuleCacheContext: async () => ({
        resolvedRealmURL: realmURL,
        cacheScope: 'public',
        authUserId: '',
      }),
      prerenderUserId: 'tessar',
      jobPriority: 0,
      jobInfo: { jobId: 1, reservationId: 1, priority: 0, queueWaitMs: null },
      log,
      perfLog: log,
    });
    assert.true(
      reads.every((urls) => urls.length <= 250),
      'dependency payloads are bounded instead of retained for the whole realm',
    );
    assert.deepEqual(
      reads.flat(),
      invalidations.map((url) => url.href),
      'every invalidated URL is inspected',
    );
    assert.deepEqual(
      sourceReads,
      [`${realmURL}750.json`],
      'only the missing dependency row reads source',
    );
    assert.deepEqual(
      [...warmed].sort(),
      ['helper.ts', 'novel', 'record', 'sibling.gts']
        .map((path) => realmURL + path)
        .sort(),
      'module coverage, best-row selection and cross-realm exclusion are preserved',
    );
    assert.strictEqual(count, 4);
  });
});
const on = { module: rri(`${realmURL}record`), name: 'TessarRecord' };
const definition: Definition = {
  type: 'card-def',
  codeRef: on,
  displayName: 'Tessar record',
  fields: {
    name: 'string',
    score: 'number',
    active: 'boolean',
    tags: 'strings',
  },
  fieldDefs: {
    string: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: { module: rri(`${baseRealmRRI}string`), name: 'default' },
    },
    strings: {
      type: 'containsMany',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: { module: rri(`${baseRealmRRI}string`), name: 'default' },
    },
    number: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      serializerName: 'number',
      fieldOrCard: { module: rri(`${baseRealmRRI}number`), name: 'default' },
    },
    boolean: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      serializerName: 'boolean',
      fieldOrCard: { module: rri(`${baseRealmRRI}boolean`), name: 'default' },
    },
  },
};

module('Tessar | Postgres query registry', function (hooks) {
  let db: PgAdapter;
  let engine: IndexQueryEngine;
  let registry: TessarQueryRegistry;
  let writer: IndexWriter;
  let publication: ReturnType<IndexWriter['tessarPublication']>;
  let network: VirtualNetwork;
  setupDB(hooks, {
    templateDatabase: process.env.TESSAR_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
      // Persisted definition fixture: the SQL compiler receives the same
      // loaderless field schema that a real module-index entry supplies.
      let lookup = {
        async lookupDefinition() {
          return definition;
        },
      } as unknown as DefinitionLookup;
      network = new VirtualNetwork();
      network.addRealmMapping(baseRealmRRI, 'https://cardstack.com/base/');
      engine = new IndexQueryEngine(db, lookup, network);
      registry = new TessarQueryRegistry(db, engine);
      writer = new IndexWriter(db);
      publication = writer.tessarPublication(lookup, network);
    },
  });
  let record = (name: string): TessarDocument => ({
    url: `${realmURL}record-1.json`,
    types: [`${on.module}/${on.name}`],
    search_doc: { name, score: 7, active: true, tags: ['red', 'blue'] },
  });

  test('Tessar source swap, watch registration, dirty marking and guarded owner publication share the index transaction', async function (assert) {
    let ownerURL = `${realmURL}summary.json`;
    let inputURL = `${realmURL}input.json`;
    let entry = (
      name: string,
      count?: number,
      inputGeneration = 0,
    ): InstanceEntry => ({
      type: 'instance',
      lastModified: 1,
      resourceCreatedAt: 1,
      resource: {
        id: rri(
          name === 'summary'
            ? ownerURL.replace('.json', '')
            : inputURL.replace('.json', ''),
        ),
        type: 'card',
        attributes: { name, ...(count !== undefined ? { count } : {}) },
        meta: {
          adoptsFrom: on,
          ...(count !== undefined
            ? {
                tessar: {
                  version: 1 as const,
                  state: 'pending' as const,
                  computedFields: ['count'],
                  queryFields: ['inputs'],
                  watches: [
                    {
                      fieldPath: 'inputs',
                      query: { filter: { on, eq: { name: 'A' } } },
                    },
                  ],
                  inputGeneration,
                },
              }
            : {}),
        },
      },
      searchData: { name, ...(count !== undefined ? { count } : {}) },
      types: [`${on.module}/${on.name}`],
      displayNames: ['TessarRecord'],
      deps: new Set(),
    });
    let source = await writer.createBatch(new URL(realmURL), network);
    await source.updateEntry(new URL(ownerURL), entry('summary', 0));
    await source.updateEntry(new URL(inputURL), entry('A'));
    // The HTTP PATCH/POST path holds this source-write lock until indexing
    // completes. Publication must use a different advisory-lock namespace.
    await db.withWriteLock(realmURL, async () => {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          source.done({ tessar: publication }),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () =>
                reject(
                  new Error('Tessar publication deadlocked a source write'),
                ),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
    });
    assert.deepEqual(await registry.pending(realmURL), [
      { ownerURL, generation: 1 },
    ]);
    let materialize = await writer.createBatch(new URL(realmURL), network);
    await materialize.updateEntry(new URL(ownerURL), entry('summary', 1, 1));
    await materialize.done({ tessar: publication, tessarInputGeneration: 1 });
    let [published] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url = $1 AND type = $2',
      { bind: [ownerURL, 'instance'] },
    );
    let stamp = (published.pristine_doc as any).meta.tessar;
    assert.strictEqual(stamp.state, 'ready');
    assert.strictEqual(stamp.publishedGeneration, 2);
    assert.strictEqual(
      await tessarReadState(db, realmURL, ownerURL, stamp),
      'ready',
    );
    await db.execute(
      'INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation, isolated_html, head_html) VALUES ($1, $1, $2, $3, 2, $4, $5)',
      {
        bind: [ownerURL, realmURL, 'instance', '<p>1</p>', '<title>1</title>'],
      },
    );
    let initialHTML = () =>
      Promise.all([
        retrieveIsolatedHTML({ cardURL: new URL(ownerURL), dbAdapter: db }),
        retrieveHeadHTML({ cardURL: new URL(ownerURL), dbAdapter: db }),
      ]);
    assert.deepEqual(
      await initialHTML(),
      ['<p>1</p>', '<title>1</title>'],
      'current HTML may be injected',
    );
    await db.execute(
      'UPDATE prerendered_html SET generation = 1 WHERE url = $1',
      { bind: [ownerURL] },
    );
    assert.deepEqual(
      await initialHTML(),
      [null, null],
      'old HTML cannot stand in for a newer materialization',
    );
    await db.execute(
      'UPDATE prerendered_html SET generation = 2 WHERE url = $1',
      { bind: [ownerURL] },
    );
    let [queued] = await db.execute(
      "INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args) VALUES ('incremental-index', $1, 60, 10, '{}') RETURNING id",
      { bind: [`indexing:${realmURL}`] },
    );
    assert.strictEqual(
      await tessarReadState(db, realmURL, ownerURL, stamp),
      'pending',
      'an acknowledged queued write is pending before the first source swap',
    );
    assert.deepEqual(
      await initialHTML(),
      [null, null],
      'a new client cannot receive ready-looking HTML while its source write is queued',
    );
    assert.strictEqual(
      await tessarReadState(db, realmURL, ownerURL, stamp, {
        tessarInput: true,
      }),
      'ready',
      'a revision-pinned worker can consume its ready feeder',
    );
    await db.execute("UPDATE jobs SET status = 'resolved' WHERE id = $1", {
      bind: [queued.id],
    });
    await db.execute("UPDATE jobs SET status = 'rejected' WHERE id = $1", {
      bind: [queued.id],
    });
    await assert.rejects(
      tessarReadState(db, realmURL, ownerURL, stamp),
      /indexing failed/,
      'a failed source pass cannot expose the previous snapshot as current',
    );
    assert.deepEqual(
      await initialHTML(),
      [null, null],
      'a failed source pass cannot expose old HTML as current either',
    );
    await db.execute("UPDATE jobs SET status = 'resolved' WHERE id = $1", {
      bind: [queued.id],
    });
    let change = await writer.createBatch(new URL(realmURL), network);
    await change.updateEntry(new URL(inputURL), entry('B'));
    await change.done({ tessar: publication });
    assert.deepEqual(
      await registry.pending(realmURL),
      [{ ownerURL, generation: 3 }],
      'a membership exit invalidates without an existing concrete dependency',
    );
    assert.strictEqual(
      await tessarReadState(db, realmURL, ownerURL, stamp),
      'pending',
      'the old snapshot cannot be served as current',
    );
    let obsolete = await writer.createBatch(new URL(realmURL), network);
    await obsolete.updateEntry(new URL(ownerURL), entry('summary', 99, 1));
    await assert.rejects(
      obsolete.done({ tessar: publication, tessarInputGeneration: 1 }),
      /input revision/,
    );
    let [unchanged] = await db.execute(
      'SELECT generation, pristine_doc FROM boxel_index WHERE url = $1 AND type = $2',
      { bind: [ownerURL, 'instance'] },
    );
    assert.strictEqual(
      Number(unchanged.generation),
      2,
      'failed transaction never promoted the obsolete owner',
    );
    assert.strictEqual((unchanged.pristine_doc as any).attributes.count, 1);
    await assertTessarGeneration(db, realmURL, 3);
    let fresh = await writer.createBatch(new URL(realmURL), network);
    await fresh.updateEntry(new URL(ownerURL), entry('summary', 0, 3));
    await fresh.done({ tessar: publication, tessarInputGeneration: 3 });
    assert.deepEqual(
      await registry.pending(realmURL),
      [],
      'a correct recomputation clears durable dirty state',
    );
    assert.strictEqual(await registry.activeOwnerCount(realmURL), 1);
    // Module writes mint the realm-wide loader epoch before indexing starts.
    // An owner outside that module's dependency closure still needs a new
    // stamp, or read-time epoch validation would leave it pending forever.
    await db.execute(
      'UPDATE realm_generations SET loader_epoch = $1 WHERE realm_url = $2',
      { bind: ['tessar-new-module-epoch', realmURL] },
    );
    let moduleChange = await writer.createBatch(new URL(realmURL), network);
    await moduleChange.done({ tessar: publication });
    assert.deepEqual(
      await registry.pending(realmURL),
      [{ ownerURL, generation: 5 }],
      'an epoch change schedules owners outside the changed module closure',
    );
    let rematerialize = await writer.createBatch(new URL(realmURL), network);
    await rematerialize.updateEntry(new URL(ownerURL), entry('summary', 0, 5));
    await rematerialize.done({
      tessar: publication,
      tessarInputGeneration: 5,
    });
    let [restamped] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url = $1 AND type = $2',
      { bind: [ownerURL, 'instance'] },
    );
    assert.strictEqual(
      await tessarReadState(
        db,
        realmURL,
        ownerURL,
        (restamped.pristine_doc as any).meta.tessar,
      ),
      'ready',
      'the restamped owner is readable under the new definition epoch',
    );
  });

  test('a source prepared before the first watch cannot publish after that registration', async function (assert) {
    // Deterministic interleaving across separate pinned transactions: a source
    // worker observed no watches, then another publisher registered the first
    // owner. The stale no-watch fast path must still reject its old revision.
    await writer.createBatch(new URL(realmURL), network);
    let prepared = await publication.prepare(realmURL, 1);
    assert.deepEqual(prepared.rows, []);
    assert.false(prepared.hadOwners);
    let ownerURL = `${realmURL}first-summary.json`;
    let watches = await registry.prepare([
      { fieldPath: 'inputs', query: { filter: { on, eq: { name: 'A' } } } },
    ]);
    await db.withWriteLock(`tessar:index:${realmURL}`, async (tx) => {
      if (!tx)
        throw new Error(
          'This regression requires a pinned Postgres transaction',
        );
      await registry.publish(tx, {
        realmURL,
        ownerURL,
        generation: 1,
        inputGeneration: 0,
        definitionRevision: '0',
        watches,
        pending: true,
      });
      await tx([
        'UPDATE realm_generations SET current_generation = 1 WHERE realm_url =',
        param(realmURL),
      ]);
    });
    await assert.rejects(
      db.withWriteLock(`tessar:index:${realmURL}`, async (tx) => {
        if (!tx)
          throw new Error(
            'This regression requires a pinned Postgres transaction',
          );
        await publication.commit(tx, {
          realmURL,
          generation: 1,
          definitionRevision: '0',
          prepared,
        });
      }),
      /input revision changed/,
      'the source must retry against the newly registered watch',
    );
    assert.deepEqual(await registry.pending(realmURL), [
      { ownerURL, generation: 1 },
    ]);
    await assertTessarGeneration(db, realmURL, 1);
  });

  test('Tessar input reads reject changed generations and malformed revision headers', async function (assert) {
    await db.execute(
      'INSERT INTO realm_generations (realm_url, current_generation) VALUES ($1, 7)',
      { bind: [realmURL] },
    );
    await assertTessarGeneration(db, realmURL, 7);
    assert.strictEqual(
      tessarRequestedGeneration(
        new Request(realmURL, {
          headers: { [TESSAR_INPUT_GENERATION_HEADER]: '7' },
        }),
      ),
      7,
    );
    for (let value of ['', '-1', '1.5', 'NaN', '9007199254740992']) {
      assert.throws(
        () =>
          tessarRequestedGeneration(
            new Request(realmURL, {
              headers: { [TESSAR_INPUT_GENERATION_HEADER]: value },
            }),
          ),
        /nonnegative input generation/,
      );
    }
    await db.execute(
      'UPDATE realm_generations SET current_generation = 8 WHERE realm_url = $1',
      { bind: [realmURL] },
    );
    await assert.rejects(
      assertTessarGeneration(db, realmURL, 7),
      /input revision changed/,
    );
    await db.withWriteLock(`tessar:${realmURL}`, async (tx) => {
      await assertTessarGeneration(db, realmURL, 8, tx);
      assert.ok(true, 'publication can validate its pinned transaction');
    });
  });

  test('real SQL verifies typed values, null, plural paths and boolean composition', async function (assert) {
    let predicates: Array<[Filter, boolean]> = [
      [{ on, eq: { name: 'A' } }, true],
      [{ on, eq: { name: 'B' } }, false],
      [{ on, in: { name: ['A', 'B'] } }, true],
      [{ on, range: { score: { gte: 7, lt: 8 } } }, true],
      [{ on, range: { score: { gt: 7 } } }, false],
      [{ on, eq: { active: true } }, true],
      [{ on, eq: { tags: 'blue' } }, true],
      [{ on, eq: { score: null } }, false],
      [
        { on, any: [{ eq: { name: 'B' } }, { not: { eq: { score: 8 } } }] },
        true,
      ],
    ];
    for (let [filter, expected] of predicates) {
      assert.strictEqual(
        await engine.tessarMatchesDocument(filter, record('A')),
        expected,
        JSON.stringify(filter),
      );
    }
    assert.true(
      await engine.tessarMatchesDocument(
        { on, eq: { score: null } },
        { ...record('A'), search_doc: { name: 'A' } },
      ),
      'missing field follows SQL null semantics',
    );
  });

  test('watch publication rolls back atomically and dirty state survives a new connection', async function (assert) {
    let owner = {
      realmURL,
      ownerURL: `${realmURL}summary`,
      generation: 1,
      inputGeneration: 1,
      definitionRevision: 'tessar-v1',
      watches: await registry.prepare([
        { fieldPath: 'records', query: { filter: { on, eq: { name: 'A' } } } },
      ]),
    };
    await assert.rejects(
      db.withWriteLock(`tessar:${realmURL}`, async (tx) => {
        await registry.publish(tx!, owner);
        throw new Error('Tessar injected rollback');
      }),
      /injected rollback/,
    );
    assert.deepEqual(
      await registry.affected(realmURL, undefined, record('A')),
      [],
      'rollback leaves no partial watch or terms',
    );
    await db.withWriteLock(`tessar:${realmURL}`, async (tx) => {
      assert.true(await registry.publish(tx!, owner));
    });
    assert.deepEqual(
      await registry.affected(realmURL, record('A'), record('B')),
      [owner.ownerURL],
      'membership exit invalidates',
    );
    await db.withWriteLock(`tessar:${realmURL}`, async (tx) => {
      await registry.markDirty(tx!, realmURL, [owner.ownerURL], 3);
    });
    let { PgAdapter } = await import('@cardstack/postgres');
    let reopened = new PgAdapter();
    try {
      let afterRestart = new TessarQueryRegistry(reopened, engine);
      assert.deepEqual(
        await afterRestart.pending(realmURL),
        [{ ownerURL: owner.ownerURL, generation: 3 }],
        'dirty work is durable',
      );
      await reopened.withWriteLock(`tessar:${realmURL}`, async (tx) => {
        assert.false(
          await afterRestart.publish(tx!, {
            ...owner,
            generation: 2,
            inputGeneration: 2,
          }),
          'racing stale publication is rejected',
        );
        assert.true(
          await afterRestart.publish(tx!, {
            ...owner,
            generation: 3,
            inputGeneration: 3,
          }),
        );
      });
      assert.deepEqual(await afterRestart.pending(realmURL), []);
    } finally {
      await reopened.close();
    }
  });
});
