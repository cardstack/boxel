import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import QUnit from 'qunit';
import {
  PgQueuePublisher,
  PgQueueRunner,
  type PgAdapter,
} from '@cardstack/postgres';
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
  type Prerenderer,
} from '@cardstack/runtime-common';
import { latticeMaterialize } from '@cardstack/runtime-common/tasks/lattice';
import { preWarmModulesTable } from '@cardstack/runtime-common/index-runner/prewarm-modules';
import {
  LatticeQueryRegistry,
  type LatticeDocument,
  type LatticeWatch,
} from '@cardstack/runtime-common/lattice-query-registry';
import { setupDB } from './helpers/index.ts';
import {
  retrieveHeadHTML,
  retrieveIsolatedHTML,
} from '../lib/index-html-injection.ts';
import {
  assertLatticeGeneration,
  latticeRequestedGeneration,
  LATTICE_INPUT_GENERATION_HEADER,
  latticeReadState,
  latticeHasOwner,
} from '@cardstack/runtime-common/lattice-materialization';

const { module, test } = QUnit;
const realmURL = 'https://lattice.example/';
module('lattice-query-registry-test.ts | prewarm', function () {
  test('a large invalidation set keeps complete module coverage with bounded dependency reads', async function (assert) {
    let invalidations = Array.from(
      { length: 751 },
      (_, i) => new URL(`${realmURL}${i}.json`),
    );
    invalidations.push(new URL(`${realmURL}helper.ts`));
    let reads: string[][] = [];
    let warmed = new Set<string>();
    let sourceReads: string[] = [];
    let log = logger('lattice-prewarm-test');
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
      prerenderUserId: 'lattice',
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
const on = { module: rri(`${realmURL}record`), name: 'LatticeRecord' };
const definition: Definition = {
  type: 'card-def',
  codeRef: on,
  displayName: 'Lattice record',
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

module('lattice-query-registry-test.ts | registry', function (hooks) {
  let db: PgAdapter;
  let engine: IndexQueryEngine;
  let registry: LatticeQueryRegistry;
  let writer: IndexWriter;
  let publication: ReturnType<IndexWriter['latticePublication']>;
  let network: VirtualNetwork;
  let lookup: DefinitionLookup;
  setupDB(hooks, {
    templateDatabase: process.env.LATTICE_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
      // Persisted definition fixture: the SQL compiler receives the same
      // loaderless field schema that a real module-index entry supplies.
      lookup = {
        forRealm() {
          return this;
        },
        async lookupDefinition() {
          return definition;
        },
      } as unknown as DefinitionLookup;
      network = new VirtualNetwork();
      network.addRealmMapping(baseRealmRRI, 'https://cardstack.com/base/');
      engine = new IndexQueryEngine(db, lookup, network);
      registry = new LatticeQueryRegistry(db, engine);
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realmURL]),
      });
      publication = writer.latticePublication(lookup, network);
    },
  });
  let record = (name: string): LatticeDocument => ({
    url: `${realmURL}record-1.json`,
    types: [`${on.module}/${on.name}`],
    search_doc: { name, score: 7, active: true, tags: ['red', 'blue'] },
  });

  test('Lattice compilation preserves request priority without leaking it to concurrent searches', async function (assert) {
    let priorities: (number | undefined)[] = [];
    let source = {
      async lookupDefinition(_ref: unknown, opts?: { priority?: number }) {
        priorities.push(opts?.priority);
        return definition;
      },
    } as unknown as DefinitionLookup;
    let engine = new IndexQueryEngine(db, source, network);
    let filter = { on, eq: { name: 'A' } };
    await Promise.all([
      engine.reverseCompilationScope().reverseCompileFilter(filter),
      engine.compilationScope(10).reverseCompileFilter(filter),
    ]);
    assert.deepEqual([...new Set(priorities)].sort(), [10, 8]);
    priorities.length = 0;
    await engine.reverseCompileFilter(filter);
    assert.true(priorities.length > 0);
    assert.true(priorities.every((priority) => priority === undefined));
  });

  test('Lattice source swap, watch registration, dirty marking and guarded owner publication share the index transaction', async function (assert) {
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
                publication: {
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
                  validatedThrough: inputGeneration,
                },
              }
            : {}),
        },
      },
      searchData: { name, ...(count !== undefined ? { count } : {}) },
      types: [`${on.module}/${on.name}`],
      displayNames: ['LatticeRecord'],
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
          source.done({ lattice: publication }),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () =>
                reject(
                  new Error('Lattice publication deadlocked a source write'),
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
    await materialize.done({ lattice: publication, latticeInputGeneration: 1 });
    let [published] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url = $1 AND type = $2',
      { bind: [ownerURL, 'instance'] },
    );
    let stamp = (published.pristine_doc as any).meta.publication;
    assert.strictEqual(stamp.state, 'ready');
    assert.strictEqual(stamp.outputRevision, 2);
    let [encoded] = await db.execute(
      'SELECT attributes_json, attributes_generation FROM lattice_owners WHERE owner_url = $1',
      { bind: [ownerURL] },
    );
    assert.deepEqual(JSON.parse(encoded.attributes_json as string), {
      name: 'summary',
      count: 1,
    });
    assert.strictEqual(
      Number(encoded.attributes_generation),
      2,
      'bytes and provenance publish atomically',
    );
    assert.true(await latticeHasOwner(db, realmURL, ownerURL));
    assert.false(await latticeHasOwner(db, realmURL, inputURL));
    assert.false(await latticeHasOwner(db, 'https://other.example/', ownerURL));
    assert.strictEqual(
      await latticeReadState(db, realmURL, ownerURL, stamp),
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
        retrieveIsolatedHTML({
          cardURL: new URL(ownerURL),
          realmURL,
          lattice: new LatticeRealmConfig([realmURL]),
          dbAdapter: db,
        }),
        retrieveHeadHTML({
          cardURL: new URL(ownerURL),
          realmURL,
          lattice: new LatticeRealmConfig([realmURL]),
          dbAdapter: db,
        }),
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
    assert.true(
      await latticeHasOwner(db, realmURL, ownerURL),
      'a snapshot can skip the ordinary read gate while its provenance still reports pending',
    );
    assert.strictEqual(
      await latticeReadState(db, realmURL, ownerURL, stamp),
      'pending',
      'an acknowledged queued write is pending before the first source swap',
    );
    assert.deepEqual(
      await initialHTML(),
      [null, null],
      'a new client cannot receive ready-looking HTML while its source write is queued',
    );
    assert.strictEqual(
      await latticeReadState(db, realmURL, ownerURL, stamp, {
        latticeInput: true,
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
      latticeReadState(db, realmURL, ownerURL, stamp),
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
    await change.done({ lattice: publication });
    assert.deepEqual(
      await registry.pending(realmURL),
      [{ ownerURL, generation: 3 }],
      'a membership exit invalidates without an existing concrete dependency',
    );
    assert.strictEqual(
      await latticeReadState(db, realmURL, ownerURL, stamp),
      'pending',
      'the old snapshot cannot be served as current',
    );
    let obsolete = await writer.createBatch(new URL(realmURL), network);
    await obsolete.updateEntry(new URL(ownerURL), entry('summary', 99, 1));
    await assert.rejects(
      obsolete.done({ lattice: publication, latticeInputGeneration: 1 }),
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
    let [retainedBytes] = await db.execute(
      'SELECT attributes_json, attributes_generation FROM lattice_owners WHERE owner_url = $1',
      { bind: [ownerURL] },
    );
    assert.deepEqual(
      retainedBytes,
      encoded,
      'rejected publication cannot change the stored bytes',
    );
    await assertLatticeGeneration(db, realmURL, 3);
    let fresh = await writer.createBatch(new URL(realmURL), network);
    await fresh.updateEntry(new URL(ownerURL), entry('summary', 0, 3));
    await fresh.done({ lattice: publication, latticeInputGeneration: 3 });
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
      { bind: ['lattice-new-module-epoch', realmURL] },
    );
    let moduleChange = await writer.createBatch(new URL(realmURL), network);
    await moduleChange.done({ lattice: publication });
    assert.deepEqual(
      await registry.pending(realmURL),
      [{ ownerURL, generation: 5 }],
      'an epoch change schedules owners outside the changed module closure',
    );
    let rematerialize = await writer.createBatch(new URL(realmURL), network);
    await rematerialize.updateEntry(new URL(ownerURL), entry('summary', 0, 5));
    await rematerialize.done({
      lattice: publication,
      latticeInputGeneration: 5,
    });
    let [restamped] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url = $1 AND type = $2',
      { bind: [ownerURL, 'instance'] },
    );
    assert.strictEqual(
      await latticeReadState(
        db,
        realmURL,
        ownerURL,
        (restamped.pristine_doc as any).meta.publication,
      ),
      'ready',
      'the restamped owner is readable under the new definition epoch',
    );
  });

  test('Lattice secondary dequeue yields to a later source job in the same realm', async function (assert) {
    let publisher = new PgQueuePublisher(db);
    let runner = new PgQueueRunner({
      adapter: db,
      workerId: 'lattice-priority-test',
      lattice: new LatticeRealmConfig([realmURL]),
    });
    let order: string[] = [];
    runner.register('lattice-materialize', async () => {
      order.push('secondary');
      return {};
    });
    runner.register('incremental-index', async () => {
      order.push('source');
      return {};
    });
    try {
      let secondary = await publisher.publish({
        jobType: 'lattice-materialize',
        priority: 8,
        concurrencyGroup: `indexing:${realmURL}`,
        timeout: 10,
        args: { realmURL },
      });
      let source = await publisher.publish({
        jobType: 'incremental-index',
        priority: 10,
        concurrencyGroup: `indexing:${realmURL}`,
        timeout: 10,
        args: { realmURL },
      });
      await runner.start();
      await Promise.all([secondary.done, source.done]);
      assert.deepEqual(
        order,
        ['source', 'secondary'],
        'source priority is enforced independently of FIFO and worker floor',
      );
    } finally {
      await runner.destroy();
      await publisher.destroy();
    }
  });

  test('Lattice secondary handoff preserves old/new inputs and never exposes a false-ready gap', async function (assert) {
    let ownerURL = `${realmURL}secondary-summary.json`;
    let inputURL = `${realmURL}secondary-input.json`;
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
          (count === undefined ? inputURL : ownerURL).replace('.json', ''),
        ),
        type: 'card',
        attributes: { name, ...(count === undefined ? {} : { count }) },
        meta: {
          adoptsFrom: on,
          ...(count === undefined
            ? {}
            : {
                publication: {
                  version: 1 as const,
                  state: 'pending' as const,
                  computedFields: ['count'],
                  queryFields: ['inputs'],
                  validatedThrough: inputGeneration,
                  watches: [
                    {
                      fieldPath: 'inputs',
                      query: { filter: { on, eq: { name: 'A' } } },
                    },
                  ],
                },
              }),
        },
      },
      searchData: { name, ...(count === undefined ? {} : { count }) },
      types: [`${on.module}/${on.name}`],
      displayNames: ['LatticeRecord'],
      deps: new Set(),
    });
    let source = await writer.createBatch(new URL(realmURL), network);
    await source.updateEntry(new URL(ownerURL), entry('summary', 0));
    await source.updateEntry(new URL(inputURL), entry('A'));
    await source.done({ lattice: publication });
    let ready = await writer.createBatch(new URL(realmURL), network);
    await ready.updateEntry(new URL(ownerURL), entry('summary', 1, 1));
    await ready.done({ lattice: publication, latticeInputGeneration: 1 });
    let [owner] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url = $1 AND type = $2',
      { bind: [ownerURL, 'instance'] },
    );
    let stamp = (owner.pristine_doc as any).meta.publication;
    assert.strictEqual(
      await latticeReadState(db, realmURL, ownerURL, stamp),
      'ready',
    );

    await db.execute(
      `INSERT INTO prerendered_html (realm_url, url, file_alias, type, generation, error_doc)
      VALUES ($1, $2, $2, 'instance', 2, $3)`,
      {
        bind: [
          realmURL,
          ownerURL,
          JSON.stringify({
            message: 'Lattice HTML is still pending',
            status: 500,
          }),
        ],
      },
    );
    assert.strictEqual(
      (await engine.getInstance(new URL(ownerURL)))?.type,
      'instance-error',
      'HTML errors remain visible to HTML consumers',
    );
    assert.strictEqual(
      (await engine.getInstance(new URL(ownerURL), { latticeData: true }))
        ?.type,
      'instance',
      'materialized JSON survives an HTML-only error',
    );
    assert.strictEqual(
      (await engine.getInstance(new URL(ownerURL), { latticeInput: true }))
        ?.type,
      'instance',
      'revision-pinned rebuild can still read its indexed inputs',
    );
    let inputSearch = await engine.search(
      new URL(realmURL),
      {},
      { latticeInput: true, cardUrls: [ownerURL] },
      { kind: 'dataOnly' },
    );
    assert.strictEqual(
      inputSearch.results.length,
      1,
      'an HTML failure cannot silently drop a matching materialization input',
    );
    assert.false(inputSearch.results[0].has_error);

    // No secondary worker is running. A departing match still acknowledges
    // source indexing, with its old A and new B durably captured for later.
    let update = await writer.createBatch(new URL(realmURL), network);
    await update.updateEntry(new URL(inputURL), entry('B'));
    await update.done({ lattice: publication, latticeRealmUsername: 'test' });
    assert.deepEqual(
      await registry.pending(realmURL),
      [],
      'source publication did not run reverse matching',
    );
    let [event] = await db.execute(
      'SELECT previous_row, next_row FROM lattice_index_events WHERE url = $1',
      { bind: [inputURL] },
    );
    assert.strictEqual((event.previous_row as any).search_doc.name, 'A');
    assert.strictEqual((event.next_row as any).search_doc.name, 'B');
    let jobs = await db.execute(
      "SELECT job_type, priority FROM jobs WHERE status = 'unfulfilled'",
    );
    assert.deepEqual(
      jobs,
      [{ job_type: 'lattice-materialize', priority: 8 }],
      'durable secondary job has its own priority',
    );
    assert.strictEqual(
      await latticeReadState(db, realmURL, ownerURL, stamp),
      'pending',
      'no false-ready window while reverse matching is paused',
    );
    let events: unknown[] = [];
    let matchResult = await latticeMaterialize({
      dbAdapter: db,
      indexWriter: writer,
      definitionLookup: lookup,
      virtualNetwork: network,
      queuePublisher: new PgQueuePublisher(db),
      prerenderer: {
        prerenderVisit: async () => {
          throw new Error('matching must not occupy a render tab');
        },
      } as unknown as Prerenderer,
      matrixURL: 'https://matrix.example/',
      log: logger('lattice-test'),
      getReader: () => ({}) as Reader,
      getAuthedFetch: async () => globalThis.fetch,
      createPrerenderAuth: () => 'test',
      reportStatus: () => {},
      reportRealmEvent: (event) => events.push(event),
    })({ realmURL, realmUsername: 'test', wave: 0, attempt: 0 });
    assert.true(matchResult.matchingComplete);
    assert.deepEqual(
      events,
      [
        {
          eventName: 'index',
          indexType: 'incremental',
          realmURL,
          invalidations: [],
          generation: undefined,
        },
      ],
      'matching completion revalidates pending readers even without a rendered owner',
    );
    assert.false(await publication.hasUnmatched(realmURL));
    assert.deepEqual(
      await registry.pending(realmURL),
      [{ ownerURL, generation: 3 }],
      'old document identifies the departed match',
    );
    assert.strictEqual(
      await latticeReadState(db, realmURL, ownerURL, stamp),
      'pending',
      'matching checkpoint is not materialization completion',
    );
    assert.false(
      await publication.matchPending(realmURL, 'test'),
      'checkpoint replay is idempotent',
    );
    let published = await writer.createBatch(new URL(realmURL), network);
    await published.updateEntry(new URL(ownerURL), entry('summary', 0, 3));
    await published.done({
      lattice: publication,
      latticeInputGeneration: 3,
      latticeFollowup: { realmUsername: 'test', wave: 1 },
    });
    [owner] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url = $1 AND type = $2',
      { bind: [ownerURL, 'instance'] },
    );
    assert.strictEqual(
      await latticeReadState(
        db,
        realmURL,
        ownerURL,
        (owner.pristine_doc as any).meta.publication,
      ),
      'ready',
      'published result is ready without waiting for queue acknowledgement',
    );

    for (let name of ['A', 'B']) {
      let next = await writer.createBatch(new URL(realmURL), network);
      await next.updateEntry(new URL(inputURL), entry(name));
      await next.done({ lattice: publication, latticeRealmUsername: 'test' });
    }
    let [{ count }] = await db.execute(
      'SELECT COUNT(*)::int count FROM lattice_index_events',
    );
    assert.strictEqual(
      count,
      2,
      'coalescing never loses intermediate old/new transitions',
    );
    jobs = await db.execute("SELECT id FROM jobs WHERE status = 'unfulfilled'");
    assert.strictEqual(
      jobs.length,
      1,
      'only the unreserved wake-up is coalesced',
    );
    await publication.matchPending(realmURL, 'test');
    await publication.matchPending(realmURL, 'test');
    assert.deepEqual(
      await registry.pending(realmURL),
      [{ ownerURL, generation: 6 }],
      'both enter and leave transitions advance dirty provenance',
    );

    let rollback = await writer.createBatch(new URL(realmURL), network);
    await rollback.updateEntry(new URL(inputURL), entry('A'));
    await rollback.flushWriteBuffer();
    await assert.rejects(
      db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
        if (!tx) throw new Error('transaction required');
        await publication.recordChange(tx, {
          realmURL,
          generation: 7,
          definitionRevision: rollback.loaderEpoch,
          realmUsername: 'test',
        });
        throw new Error('simulate failure before source promotion');
      }),
      /simulate failure/,
    );
    assert.false(
      await publication.hasUnmatched(realmURL),
      'failed source transaction leaves no outbox checkpoint',
    );
    [{ count }] = await db.execute(
      'SELECT COUNT(*)::int count FROM lattice_index_events',
    );
    assert.strictEqual(
      count,
      0,
      'old/new events roll back with their source transaction',
    );
  });

  test('Lattice retries failed background work twice without clearing dirty provenance', async function (assert) {
    await writer.createBatch(new URL(realmURL), network);
    // Failure retry is tested with an authorized reader. A missing read scope
    // is now a durable authority wait, not a failed computation attempt.
    await db.execute(
      'INSERT INTO realm_user_permissions(realm_url,username,read,write) VALUES($1,$2,TRUE,FALSE)',
      { bind: [realmURL, '@test:matrix.example'] },
    );
    let ownerURL = `${realmURL}missing-owner.json`;
    await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
      if (!tx) throw new Error('transaction required');
      await registry.publish(tx, {
        realmURL,
        ownerURL,
        generation: 1,
        inputGeneration: 0,
        definitionRevision: '0',
        watches: [],
        pending: true,
      });
    });
    let task = latticeMaterialize({
      dbAdapter: db,
      indexWriter: writer,
      definitionLookup: lookup,
      virtualNetwork: network,
      queuePublisher: new PgQueuePublisher(db),
      prerenderer: {} as Prerenderer,
      matrixURL: 'https://matrix.example/',
      log: logger('lattice-test'),
      getReader: () => ({
        readFile: async () => undefined,
        readStream: async () => undefined,
        mtimes: async () => ({}),
      }),
      getAuthedFetch: async () => globalThis.fetch,
      createPrerenderAuth: () => 'test',
      reportStatus: () => {},
    });
    for (let attempt of [0, 1, 2]) {
      // Simulate each successor having been claimed and finalized, so the
      // next failure must decide whether to enqueue another durable attempt.
      await db.execute("UPDATE jobs SET status = 'resolved'");
      await assert.rejects(
        task({ realmURL, realmUsername: 'test', wave: 0, attempt }),
        /Lattice could not materialize pending owners/,
      );
      let queued = await db.execute(
        "SELECT args FROM jobs WHERE status = 'unfulfilled'",
      );
      assert.strictEqual(queued.length, attempt < 2 ? 1 : 0);
      if (queued.length)
        assert.strictEqual(
          (queued[0].args as any).attempt,
          0,
          'owner failure does not spend the realm infrastructure retry budget',
        );
      const [failure] = await db.execute(
        'SELECT attempts FROM lattice_work_failures WHERE owner_url=$1',
        { bind: [ownerURL] },
      );
      assert.strictEqual(failure.attempts, attempt + 1);
      assert.deepEqual(await registry.pending(realmURL), [
        { ownerURL, generation: 1 },
      ]);
    }
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
    await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
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
      db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
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
    await assertLatticeGeneration(db, realmURL, 1);
  });

  test('Lattice input reads reject changed generations and malformed revision headers', async function (assert) {
    await db.execute(
      'INSERT INTO realm_generations (realm_url, current_generation) VALUES ($1, 7)',
      { bind: [realmURL] },
    );
    await assertLatticeGeneration(db, realmURL, 7);
    assert.strictEqual(
      latticeRequestedGeneration(
        new Request(realmURL, {
          headers: { [LATTICE_INPUT_GENERATION_HEADER]: '7' },
        }),
      ),
      7,
    );
    for (let value of ['', '-1', '1.5', 'NaN', '9007199254740992']) {
      assert.throws(
        () =>
          latticeRequestedGeneration(
            new Request(realmURL, {
              headers: { [LATTICE_INPUT_GENERATION_HEADER]: value },
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
      assertLatticeGeneration(db, realmURL, 7),
      /input revision changed/,
    );
    await db.withWriteLock(`lattice:${realmURL}`, async (tx) => {
      await assertLatticeGeneration(db, realmURL, 8, tx);
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
      let compiled = await engine.reverseCompileFilter(filter);
      assert.strictEqual(
        await engine.reverseMatchesDocument(filter, record('A'), compiled),
        expected,
        JSON.stringify(filter),
      );
    }
    assert.true(
      await engine.reverseMatchesDocument(
        { on, eq: { score: null } },
        { ...record('A'), search_doc: { name: 'A' } },
      ),
      'missing field follows SQL null semantics',
    );
  });

  for (let lostIndex of [false, true]) {
    test(`Lattice retires a deleted owner without compiling its removed query definition${lostIndex ? ' after index loss' : ''}`, async function (assert) {
      let removed = false;
      let lookup = {
        async lookupDefinition() {
          if (removed) throw new Error('The watched type module was deleted');
          return definition;
        },
      } as unknown as DefinitionLookup;
      let lifecycle = writer.latticePublication(lookup, network);
      let ownerURL = `${realmURL}deleted-summary.json`;
      let source = await writer.createBatch(new URL(realmURL), network);
      await source.updateEntry(new URL(ownerURL), {
        type: 'instance',
        lastModified: 1,
        resourceCreatedAt: 1,
        resource: {
          id: rri(ownerURL.replace('.json', '')),
          type: 'card',
          attributes: { name: 'summary', count: 0 },
          meta: {
            adoptsFrom: on,
            publication: {
              version: 1,
              state: 'pending',
              computedFields: ['count'],
              queryFields: ['inputs'],
              watches: [
                {
                  fieldPath: 'inputs',
                  query: { filter: { on, eq: { name: 'A' } } },
                },
              ],
              validatedThrough: 0,
            },
          },
        },
        searchData: { name: 'summary', count: 0 },
        types: [`${on.module}/${on.name}`],
        displayNames: ['LatticeRecord'],
        deps: new Set(),
      });
      await source.done({ lattice: lifecycle });
      assert.strictEqual(await registry.activeOwnerCount(realmURL), 1);
      removed = true;
      if (lostIndex) {
        await db.execute(
          'TRUNCATE boxel_index, boxel_index_working, lattice_input_artifacts',
        );
        let [clock] = await db.execute(
          "SELECT relpersistence FROM pg_class WHERE oid = 'realm_generations'::regclass",
        );
        assert.strictEqual(
          clock.relpersistence,
          'p',
          'the watch revision clock is durable',
        );
      }
      let deletion = await writer.createBatch(new URL(realmURL), network);
      assert.true(
        (await deletion.getModifiedTimes()).has(ownerURL),
        'discovery includes the surviving owner',
      );
      await deletion.invalidate([new URL(ownerURL)]);
      assert.deepEqual(
        await db.execute(
          'SELECT url, generation, type, is_deleted FROM boxel_index_working WHERE realm_url=$1',
          { bind: [realmURL] },
        ),
        [{ url: ownerURL, generation: 2, type: 'instance', is_deleted: true }],
        'the missing owner receives a source tombstone',
      );
      await deletion.done({ lattice: lifecycle });
      assert.strictEqual(await registry.activeOwnerCount(realmURL), 0);
      assert.deepEqual(await registry.pending(realmURL), []);
      let rows = await db.execute(
        'SELECT owner_url FROM lattice_query_watches WHERE realm_url = $1',
        { bind: [realmURL] },
      );
      assert.deepEqual(rows, [], 'deleted owners leave no watches to compile');
      assert.false(await latticeHasOwner(db, realmURL, ownerURL));
      let [indexed] = await db.execute(
        'SELECT is_deleted FROM boxel_index WHERE url = $1 AND type = $2',
        { bind: [ownerURL, 'instance'] },
      );
      assert.true(
        indexed.is_deleted,
        'owner deletion publishes together with retirement',
      );
    });
  }

  test('Lattice concrete dependencies match any changed URL with bound values', async function (assert) {
    let inputA = `${realmURL}first.json`;
    let inputB = `${realmURL}second'quoted.json`;
    let matchingOwner = `${realmURL}dependent.json`;
    let unrelatedOwner = `${realmURL}unrelated.json`;
    let entry = (url: string, deps: string[] = []): InstanceEntry => ({
      type: 'instance',
      lastModified: 1,
      resourceCreatedAt: 1,
      resource: {
        id: rri(url.replace('.json', '')),
        type: 'card',
        attributes: { name: url },
        meta: { adoptsFrom: on },
      },
      searchData: { name: url },
      types: [`${on.module}/${on.name}`],
      displayNames: ['LatticeRecord'],
      deps: new Set(deps),
    });
    let initial = await writer.createBatch(new URL(realmURL), network);
    await initial.updateEntry(
      new URL(matchingOwner),
      entry(matchingOwner, [inputB]),
    );
    await initial.updateEntry(
      new URL(unrelatedOwner),
      entry(unrelatedOwner, [`${realmURL}unchanged.json`]),
    );
    await initial.done({ lattice: publication });
    await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
      for (let ownerURL of [matchingOwner, unrelatedOwner]) {
        await registry.publish(tx!, {
          realmURL,
          ownerURL,
          generation: 1,
          inputGeneration: 1,
          definitionRevision: '0',
          watches: [],
        });
      }
    });
    let change = await writer.createBatch(new URL(realmURL), network);
    await change.updateEntry(new URL(inputA), entry(inputA));
    await change.updateEntry(new URL(inputB), entry(inputB));
    await change.done({ lattice: publication });
    assert.deepEqual(
      await registry.pending(realmURL),
      [{ ownerURL: matchingOwner, generation: 2 }],
      'a later member of the changed set invalidates only its dependent owner',
    );
  });

  test('Lattice token sets route long membership lists, escaped values and broad predicates without duplicate candidates', async function (assert) {
    let values = Array.from({ length: 1000 }, (_, i) => `name-${i}`);
    let unusual = 'quote" slash\\ comma, bracket] newline\n café 🐈';
    values.push(unusual, unusual);
    let ownerURL = `${realmURL}members.json`;
    let broadURL = `${realmURL}high-scores.json`;
    let publish = async (url: string, filter: Filter, generation = 1) =>
      db.withWriteLock(`lattice:index:${realmURL}`, async (tx) =>
        registry.publish(tx!, {
          realmURL,
          ownerURL: url,
          generation,
          inputGeneration: generation,
          definitionRevision: 'lattice-v1',
          watches: await registry.prepare([
            { fieldPath: 'records', query: { filter } },
          ]),
        }),
      );
    await publish(ownerURL, { on, in: { name: values } });
    await publish(broadURL, { on, range: { score: { gt: 10 } } });
    let candidateURLs = async (document: LatticeDocument) =>
      (await registry.candidates(realmURL, document))
        .map((watch) => watch.ownerURL)
        .sort();
    assert.deepEqual(
      await candidateURLs(record(unusual)),
      [broadURL, ownerURL].sort(),
      'the last list member matches once, even when repeated or escaped',
    );
    assert.deepEqual(
      await candidateURLs({
        ...record('unmatched'),
        search_doc: { name: 'unmatched', differentField: unusual },
      }),
      [broadURL],
      'the token includes the field path; broad predicates remain candidates',
    );
    assert.deepEqual(
      await candidateURLs({
        ...record('unmatched'),
        types: [`${realmURL}different/Type`],
      }),
      [],
      'the range watch uses its mandatory type guard instead of inspecting unrelated types',
    );
    assert.deepEqual(
      await registry.affected(realmURL, record(unusual), record('unmatched')),
      [ownerURL],
      'exact verification rejects the range candidate and preserves membership exits',
    );
    assert.deepEqual(
      await registry.affected(realmURL, undefined, record('name-999')),
      [ownerURL],
      'a long in-list remains selectively routed',
    );
    assert.deepEqual(
      await registry.candidates(
        'https://other-lattice.example/',
        record(unusual),
      ),
      [],
      'realm isolation is retained',
    );
    await publish(ownerURL, { on, eq: { name: 'replacement' } }, 2);
    assert.deepEqual(
      await candidateURLs(record(unusual)),
      [broadURL],
      'replacing a watch removes its old inverted-index entries',
    );
    assert.deepEqual(
      await candidateURLs(record('replacement')),
      [broadURL, ownerURL].sort(),
    );
  });

  test('Lattice preparation routes old and new documents before compiling unrelated watches', async function (assert) {
    for (let name of ['A', 'B', 'unrelated']) {
      let watches = await registry.prepare([
        { fieldPath: 'records', query: { filter: { on, eq: { name } } } },
      ]);
      await db.withWriteLock(`lattice:${realmURL}`, async (tx) => {
        await registry.publish(tx!, {
          realmURL,
          ownerURL: `${realmURL}${name}.json`,
          generation: 1,
          inputGeneration: 1,
          definitionRevision: 'lattice-v1',
          watches,
        });
      });
    }
    let matchers = await registry.prepareMatchers(realmURL, [], new Set(), [
      record('A'),
      record('B'),
    ]);
    assert.strictEqual(
      matchers.size,
      2,
      'only old/new routing candidates are compiled',
    );
    assert.deepEqual(
      await registry.affected(
        realmURL,
        record('A'),
        record('B'),
        undefined,
        matchers,
      ),
      [`${realmURL}A.json`, `${realmURL}B.json`],
      'both membership exit and entry remain exact',
    );
    let deleted = await registry.prepareMatchers(realmURL, [], new Set(), [
      record('A'),
    ]);
    assert.strictEqual(deleted.size, 1);
    assert.deepEqual(
      await registry.affected(
        realmURL,
        record('A'),
        undefined,
        undefined,
        deleted,
      ),
      [`${realmURL}A.json`],
      'the old document alone routes deletion',
    );
    let empty = await registry.prepareMatchers(realmURL, [], new Set(), []);
    assert.strictEqual(empty.size, 0, 'an empty change set compiles nothing');
  });

  test('Lattice publication reuses compiled watches without definition lookups inside the commit', async function (assert) {
    let preparing = true;
    let lookups = new Map<string, number>();
    let lookup = {
      async lookupDefinition(ref: unknown) {
        if (!preparing) throw new Error('Definition lookup during publication');
        let key = JSON.stringify(ref);
        lookups.set(key, (lookups.get(key) ?? 0) + 1);
        return definition;
      },
    } as unknown as DefinitionLookup;
    let cached = new LatticeQueryRegistry(
      db,
      new IndexQueryEngine(db, lookup, network),
    );
    let ownerURL = `${realmURL}compiled-summary`;
    let watches = await cached.prepare([
      { fieldPath: 'records', query: { filter: { on, eq: { name: 'A' } } } },
    ]);
    await db.withWriteLock(`lattice:${realmURL}`, async (tx) => {
      await cached.publish(tx!, {
        realmURL,
        ownerURL,
        generation: 1,
        inputGeneration: 1,
        definitionRevision: 'lattice-v1',
        watches,
      });
    });
    lookups.clear();
    let matchers = await cached.prepareMatchers(realmURL, []);
    assert.true(lookups.size > 0);
    assert.true(
      [...lookups.values()].every((count) => count === 1),
      'preparation loads each definition once even across multiple field walks',
    );
    await cached.prepareMatchers(realmURL, []);
    assert.true(
      [...lookups.values()].every((count) => count === 2),
      'the next publication reloads definitions instead of reusing stale schemas',
    );
    preparing = false;
    await db.withWriteLock(`lattice:${realmURL}`, async (tx) => {
      assert.deepEqual(
        await cached.affected(realmURL, record('A'), record('B'), tx, matchers),
        [ownerURL],
        'membership exit invalidates',
      );
      assert.deepEqual(
        await cached.affected(realmURL, record('B'), record('A'), tx, matchers),
        [ownerURL],
        'membership entry invalidates',
      );
      assert.deepEqual(
        await cached.affected(realmURL, undefined, record('B'), tx, matchers),
        [],
        'a nonmatching document remains unrelated',
      );
    });
  });

  test('Lattice shares definitions across publication routing and matching, but never across publications', async function (assert) {
    let available = true;
    let reads = new Map<string, number>();
    let currentLookup = {
      async lookupDefinition(ref: unknown) {
        if (!available) throw new Error('Watched definition is unavailable');
        let key = JSON.stringify(ref);
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return definition;
      },
    } as unknown as DefinitionLookup;
    let currentRegistry = new LatticeQueryRegistry(
      db,
      new IndexQueryEngine(db, currentLookup, network),
    );
    let ownerWatches = new Map<string, LatticeWatch[]>(
      ['A', 'B'].map((name) => [
        `${realmURL}${name}.json`,
        [{ fieldPath: 'records', query: { filter: { on, eq: { name } } } }],
      ]),
    );
    let prepare = () =>
      currentRegistry.preparePublication(realmURL, ownerWatches, new Set(), [
        record('A'),
        record('B'),
      ]);
    let prepared = await prepare();
    assert.true(reads.size > 0);
    assert.true(
      [...reads.values()].every((count) => count === 1),
      'multiple owners, routing and matching share one read per definition',
    );
    available = false;
    await db.withWriteLock(`lattice:${realmURL}`, async (tx) => {
      for (let [ownerURL, watches] of prepared.watches) {
        assert.true(
          await currentRegistry.publish(tx!, {
            realmURL,
            ownerURL,
            generation: 1,
            inputGeneration: 1,
            definitionRevision: 'lattice-preparation-v1',
            watches,
          }),
        );
      }
      assert.deepEqual(
        await currentRegistry.affected(
          realmURL,
          record('A'),
          record('B'),
          tx,
          prepared.matchers,
        ),
        [...ownerWatches.keys()],
        'both membership exit and entry invalidate without loading code in commit',
      );
    });
    await assert.rejects(
      prepare(),
      /Watched definition is unavailable/,
      'the next publication cannot reuse the previous definition receipt',
    );
    available = true;
    reads.clear();
    let recovered = await prepare();
    assert.deepEqual(recovered.watches, prepared.watches);
    assert.true(
      [...reads.values()].every((count) => count === 1),
      'recovery creates a new preparation scope, including registered watches',
    );
  });

  test('native preparations preserve exact routing and matching without reloading their definitions', async (assert) => {
    let available = true;
    let reads = 0;
    const nativeEngine = new IndexQueryEngine(
      db,
      {
        lookupDefinition: async () => {
          if (!available) throw new Error('Definition read after computation');
          reads++;
          return definition;
        },
      } as unknown as DefinitionLookup,
      network,
    );
    const currentRegistry = new LatticeQueryRegistry(db, nativeEngine);
    const ownerURL = realmURL + 'native-summary.json';
    const watches: LatticeWatch[] = [
      {
        fieldPath: 'records',
        query: { filter: { on, eq: { name: 'A' } }, page: { size: 1 } },
      },
      { fieldPath: 'tags', query: { filter: { on, eq: { tags: 'blue' } } } },
    ];
    const owners = new Map([[ownerURL, watches]]);
    const expected = await currentRegistry.preparePublication(
      realmURL,
      owners,
      new Set(),
      [record('A'), record('B')],
    );
    const native = await currentRegistry.prepareNativeQueries(
      watches,
      nativeEngine.reverseCompilationScope(),
    );
    assert.ok(native);
    assert.true(reads > 0);
    available = false;
    const actual = await currentRegistry.preparePublication(
      realmURL,
      owners,
      new Set(),
      [record('A'), record('B')],
      new Map([[ownerURL, native!]]),
    );
    assert.deepEqual(
      actual,
      expected,
      'query plans and routing terms match the fresh preparation',
    );
    await db.withWriteLock('lattice:' + realmURL, async (tx) => {
      await currentRegistry.publish(tx!, {
        realmURL,
        ownerURL,
        generation: 1,
        inputGeneration: 1,
        definitionRevision: 'reviewed',
        watches: actual.watches.get(ownerURL)!,
      });
      assert.deepEqual(
        await currentRegistry.affected(
          realmURL,
          record('A'),
          record('B'),
          tx,
          actual.matchers,
        ),
        [ownerURL],
        'membership exit is matched by the prepared predicates',
      );
      assert.deepEqual(
        await currentRegistry.affected(
          realmURL,
          undefined,
          record('A'),
          tx,
          actual.matchers,
        ),
        [ownerURL],
        'membership entry is matched by the prepared predicates',
      );
    });
  });

  test('a native preparation cannot stand in for a different query manifest', async (assert) => {
    const ownerURL = realmURL + 'manifest.json';
    const watches: LatticeWatch[] = [
      {
        fieldPath: 'records',
        query: { filter: { on, eq: { name: 'A' } }, page: { size: 1 } },
      },
    ];
    const native = await registry.prepareNativeQueries(
      watches,
      engine.reverseCompilationScope(),
    );
    for (const replacement of [
      [{ ...watches[0], fieldPath: 'other' }],
      [{ ...watches[0], query: { ...watches[0].query, page: { size: 2 } } }],
      [{ ...watches[0], query: { filter: { on, eq: { name: 'B' } } } }],
      [],
    ]) {
      await assert.rejects(
        registry.preparePublication(
          realmURL,
          new Map([[ownerURL, replacement]]),
          new Set(),
          [],
          new Map([[ownerURL, native!]]),
        ),
        /do not match the published watches/,
      );
    }
  });

  test('oversized native preparations fall back without dropping any watch', async (assert) => {
    const watches: LatticeWatch[] = ['A', 'B'].map((name) => ({
      fieldPath: name,
      query: { filter: { on, eq: { name } } },
    }));
    const native = await registry.prepareNativeQueries(
      watches,
      engine.reverseCompilationScope(),
      1,
    );
    assert.strictEqual(native, undefined);
    const ownerURL = realmURL + 'large.json';
    const prepared = await registry.preparePublication(
      realmURL,
      new Map([[ownerURL, watches]]),
      new Set(),
      [record('A'), record('B')],
    );
    assert.strictEqual(prepared.watches.get(ownerURL)?.length, 2);
    assert.strictEqual(prepared.matchers.size, 2);
  });

  test('Lattice batches multiple watches without sharing plural-path join scopes', async function (assert) {
    let watches: Array<{ ownerURL: string; filter: Filter }> = [
      { ownerURL: 'name', filter: { on, eq: { name: 'A' } } },
      { ownerURL: 'active', filter: { on, eq: { active: true } } },
      { ownerURL: 'wrong-name', filter: { on, eq: { name: 'B' } } },
      { ownerURL: 'blue', filter: { on, eq: { tags: 'blue' } } },
      { ownerURL: 'green', filter: { on, eq: { tags: 'green' } } },
    ];
    let candidates = await Promise.all(
      watches.map(async (candidate) => ({
        ...candidate,
        compiled: await engine.reverseCompileFilter(candidate.filter),
      })),
    );
    assert.deepEqual(
      (await engine.reverseMatchingCandidates(candidates, record('A'))).sort(),
      ['active', 'blue', 'name'],
    );
    assert.deepEqual(
      (
        await engine.reverseMatchingCandidates(candidates, {
          ...record('A'),
          search_doc: { name: 'A', active: true, tags: [] },
        })
      ).sort(),
      ['active', 'name'],
      'an empty plural input does not suppress other matching watches',
    );
  });

  test('Lattice room and wildcard keys route array membership changes precisely', async function (assert) {
    let rooms = ['1a', '2b', '10a'];
    for (let room of rooms) {
      let watches = await registry.prepare([
        {
          fieldPath: 'alerts',
          query: { filter: { on, in: { tags: ['*', room] } } },
        },
      ]);
      await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
        await registry.publish(tx!, {
          realmURL,
          ownerURL: `${realmURL}${room}.json`,
          generation: 1,
          inputGeneration: 1,
          definitionRevision: 'lattice-routing-v1',
          watches,
        });
      });
    }
    let notice = (tags: string[]): LatticeDocument => ({
      ...record('notice'),
      search_doc: { tags },
    });
    let owners = (...keys: string[]) =>
      keys.map((key) => `${realmURL}${key}.json`).sort();
    assert.deepEqual(
      await registry.affected(realmURL, undefined, notice(['10a'])),
      owners('10a'),
      'a new targeted notice affects only its room',
    );
    assert.deepEqual(
      await registry.affected(realmURL, notice(['10a']), notice(['1a'])),
      owners('1a', '10a'),
      'retargeting refreshes both the old and new room',
    );
    assert.deepEqual(
      await registry.affected(realmURL, notice(['10a']), undefined),
      owners('10a'),
      'deletion refreshes its previous audience',
    );
    assert.deepEqual(
      await registry.affected(realmURL, notice(['10a']), notice(['*'])),
      owners(...rooms),
      'a school-wide notice reaches every registered room',
    );
    assert.deepEqual(
      await registry.affected(realmURL, notice(['*']), notice([])),
      owners(...rooms),
      'removing a whole-school audience clears every previous view',
    );
    assert.deepEqual(
      await registry.affected(realmURL, undefined, notice([])),
      [],
      'an explicitly empty audience does not acquire a wildcard',
    );
    assert.deepEqual(
      await registry.affected(realmURL, undefined, notice(['1a', '10a', '1a'])),
      owners('1a', '10a'),
      'multiple room keys match once each',
    );
  });

  test('watch publication rolls back atomically and dirty state survives a new connection', async function (assert) {
    let owner = {
      realmURL,
      ownerURL: `${realmURL}summary`,
      generation: 1,
      inputGeneration: 1,
      definitionRevision: 'lattice-v1',
      watches: await registry.prepare([
        { fieldPath: 'records', query: { filter: { on, eq: { name: 'A' } } } },
      ]),
    };
    await assert.rejects(
      db.withWriteLock(`lattice:${realmURL}`, async (tx) => {
        await registry.publish(tx!, owner);
        throw new Error('Lattice injected rollback');
      }),
      /injected rollback/,
    );
    assert.deepEqual(
      await registry.affected(realmURL, undefined, record('A')),
      [],
      'rollback leaves no partial watch or terms',
    );
    await db.withWriteLock(`lattice:${realmURL}`, async (tx) => {
      assert.true(await registry.publish(tx!, owner));
    });
    assert.deepEqual(
      await registry.affected(realmURL, record('A'), record('B')),
      [owner.ownerURL],
      'membership exit invalidates',
    );
    await db.withWriteLock(`lattice:${realmURL}`, async (tx) => {
      await registry.markDirty(tx!, realmURL, [owner.ownerURL], 3);
    });
    let { PgAdapter } = await import('@cardstack/postgres');
    let reopened = new PgAdapter();
    try {
      let afterRestart = new LatticeQueryRegistry(reopened, engine);
      assert.deepEqual(
        await afterRestart.pending(realmURL),
        [{ ownerURL: owner.ownerURL, generation: 3 }],
        'dirty work is durable',
      );
      await reopened.withWriteLock(`lattice:${realmURL}`, async (tx) => {
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
