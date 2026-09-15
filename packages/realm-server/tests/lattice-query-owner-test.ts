import { renderFileForIndexing } from '@cardstack/runtime-common/index-runner/visit-file';
import { LatticeRetainedSnapshots } from '@cardstack/runtime-common/lattice-retained-snapshots';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import QUnit from 'qunit';
import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import { PgQueuePublisher, type PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  RealmPaths,
  CachingDefinitionLookup,
  logger,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type InstanceEntry,
  type Prerenderer,
} from '@cardstack/runtime-common';
import { IndexRunner } from '@cardstack/runtime-common/index-runner';
import { latticeMaterialize } from '@cardstack/runtime-common/tasks/lattice';
import { enqueueLattice } from '@cardstack/runtime-common/jobs/lattice';
import { LatticeWorkSuperseded } from '@cardstack/runtime-common/lattice-work';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import { createLatticeNativeCardIndexer } from '../lib/lattice-native-card-indexer.ts';
import { LatticeMaterializationInputs } from '../lib/lattice-materialization-inputs.ts';
import { openLatticeNativeWork } from '../lib/lattice-native-work.ts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-query-owner.example/';
const actor = '@reader:example';
const owner = realm + 'Dashboard/one.json';
const recordRef = { module: rri(realm + 'record'), name: 'Record' };
const rootRef = { module: rri(realm + 'dashboard'), name: 'Dashboard' };
const number = {
  type: 'contains' as const,
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: { module: rri(realm + 'number'), name: 'Number' },
  nativeCodec: { kind: 'primitive' as const, serializer: 'number' as const },
  serializerName: 'number' as const,
};
const string = {
  ...number,
  nativeCodec: { kind: 'primitive' as const, scalar: 'string' as const },
  serializerName: undefined,
};
const records: Definition = {
  type: 'card-def',
  codeRef: recordRef,
  displayName: 'Record',
  fields: { amount: 'amount', group: 'group', id: 'id', person: 'person' },
  fieldDefs: {
    amount: number,
    group: string,
    id: string,
    person: {
      type: 'linksTo',
      isComputed: false,
      isPrimitive: false,
      fieldOrCard: recordRef,
    },
  },
};
const formula = (expression: string) =>
  getBxlComputeDefinition(
    bxl(expression, { readableSyntax: false, libraries: ['core'] }),
  )!;
function definition(): Definition {
  const linked = {
    type: 'linksToMany' as const,
    isComputed: false,
    isPrimitive: false,
    fieldOrCard: recordRef,
    nativeCodec: { kind: 'compound' as const, resourceType: 'card' as const },
  };
  return {
    type: 'card-def',
    displayName: 'Dashboard',
    codeRef: rootRef,
    nativeCodec: { kind: 'compound', resourceType: 'card' },
    nativeIndex: {
      types: [rootRef],
      displayNames: ['Dashboard'],
      cardType: 'Dashboard',
      materialized: true,
    },
    nativeQueryInputs: {
      members: {},
      chosen: { links: { person: { many: false, projection: {} } } },
    },
    // Intentionally put the dependent query first: the resolver must settle
    // member IDs and their query before it can resolve this membership.
    fields: {
      group: 'group',
      chosen: 'chosen',
      chosenIds: 'chosenIds',
      members: 'members',
      total: 'total',
    },
    fieldDefs: {
      group: string,
      chosen: {
        ...linked,
        query: {
          filter: { in: { id: '$this.chosenIds' } },
          page: { size: 20 },
        },
      },
      chosenIds: {
        ...string,
        type: 'containsMany',
        isComputed: true,
        bxl: formula('[.members[] | select(.amount > 1) | .id]'),
      },
      members: {
        ...linked,
        query: { filter: { eq: { group: '$this.group' } }, page: { size: 20 } },
      },
      total: {
        ...number,
        isComputed: true,
        bxl: formula('[.chosen[] | .person.amount] | add // 0'),
      },
    },
  };
}

module('Lattice | native query-owner publication', (hooks) => {
  let db: PgAdapter,
    writer: IndexWriter,
    network: VirtualNetwork,
    worker: LatticeBxlWorker,
    root: Definition;
  let recordDefinition: Definition;
  let lookup: DefinitionLookup;
  let publication: ReturnType<IndexWriter['latticePublication']>;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realm]),
      });
      network = new VirtualNetwork();
      worker = new LatticeBxlWorker();
      root = definition();
      recordDefinition = structuredClone(records);
      lookup = {
        lookupDefinition: async () => recordDefinition,
      } as unknown as DefinitionLookup;
      publication = writer.latticePublication(lookup, network);
      await db.execute(
        'INSERT INTO realm_generations(realm_url,current_generation,loader_epoch) VALUES($1,5,$2)',
        { bind: [realm, 'epoch'] },
      );
      await db.execute('INSERT INTO realm_metadata(url) VALUES($1)', {
        bind: [realm],
      });
      await db.execute(
        'INSERT INTO realm_user_permissions(realm_url,username,read,write,realm_owner) VALUES($1,$2,TRUE,FALSE,FALSE)',
        { bind: [realm, actor] },
      );
      await db.execute(
        "CREATE TABLE lattice_owner_code_revision (revision text NOT NULL, record_revision text NOT NULL DEFAULT 'record-v1')",
      );
      await db.execute(
        "INSERT INTO lattice_owner_code_revision(revision) VALUES ('code-v1')",
      );
      for (const [name, amount, group, person] of [
        ['one', 1, 'A', null],
        ['two', 2, 'A', '../Person/one'],
        ['../Person/one', 5, 'B', null],
      ] as const) {
        const url = new URL('Record/' + name + '.json', realm).href;
        const resource = {
          id: url.replace(/\.json$/, ''),
          type: 'card',
          attributes: { amount, group },
          meta: { adoptsFrom: recordRef },
          ...(person
            ? { relationships: { person: { links: { self: person } } } }
            : {}),
        };
        await db.execute(
          "INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types) VALUES($1,$1,$2,'instance',5,FALSE,FALSE,$3,$4,$5)",
          {
            bind: [
              url,
              realm,
              JSON.stringify(resource),
              JSON.stringify({ id: resource.id, amount, group }),
              JSON.stringify([internalKeyFor(recordRef, undefined, network)]),
            ],
          },
        );
      }
    },
  });
  hooks.afterEach(async () => {
    await worker.close();
  });

  function createIndexer(
    openWork?: Parameters<typeof createLatticeNativeCardIndexer>[0]['openWork'],
  ) {
    return createLatticeNativeCardIndexer({
      worker,
      openWork,
      admit: async () => ({
        root: { definition: root, revision: 'code-v1' },
        lookup: async () => ({
          definition: recordDefinition,
          revision: 'record-v1',
        }),
        resolve: (ref, base) => new URL(ref, base).href,
        relative: (ref) => ref,
        typeKey: (ref) => internalKeyFor(ref, undefined, network),
        deps: [realm + 'dashboard'],
        runtimeRevision: 'runtime-v1',
        inputActor: actor,
        assertCurrent: async (tx, receipt) => {
          const [row] = await tx([
            'SELECT revision,record_revision FROM lattice_owner_code_revision FOR SHARE',
          ]);
          if (row.revision !== 'code-v1')
            throw new Error('Code changed before publication');
          if (
            receipt.definitions.some(
              ({ codeRef, revision }) =>
                'module' in codeRef &&
                codeRef.module === recordRef.module &&
                revision !== row.record_revision,
            )
          )
            throw new Error('Input policy changed before publication');
        },
      }),
      openInputs: (request) =>
        LatticeMaterializationInputs.open({
          db,
          network,
          realmURL: realm,
          actor,
          generation: request.inputSnapshot!.generation,
          loaderEpoch: request.loaderEpoch,
          lookup,
        }),
    });
  }

  async function candidate(
    group = 'A',
    openWork?: Parameters<typeof createLatticeNativeCardIndexer>[0]['openWork'],
    discovery = false,
  ) {
    const batch = await writer.createBatch(new URL(realm), network);
    const indexer = createIndexer(openWork);
    const result = await indexer({
      url: owner,
      realmURL: realm,
      sourceJSON: JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            group,
            ...(discovery ? { total: 999, chosenIds: ['forged'] } : {}),
          },
          meta: { adoptsFrom: rootRef },
        },
      }),
      generation: batch.currentGeneration,
      loaderEpoch: batch.loaderEpoch,
      lastModified: 1,
      resourceCreatedAt: 1,
      inputSnapshot: discovery
        ? undefined
        : {
            realmURL: realm,
            generation: batch.currentGeneration - 1,
          },
    });
    if (!result?.card.serialized || !result.card.searchDoc)
      throw new Error('Missing native owner');
    batch.registerLatticeNativeCard(
      owner,
      result.assertCurrent,
      result.codeReference,
      result.queryPreparation,
      result.retainedInputs,
    );
    await batch.updateEntry(new URL(owner), {
      type: 'instance',
      resource: result.card.serialized.data,
      searchData: result.card.searchDoc,
      types: result.card.types!,
      displayNames: result.card.displayNames!,
      deps: new Set(result.card.deps),
      lastModified: 1,
      resourceCreatedAt: 1,
    } as InstanceEntry);
    return {
      result,
      batch,
      indexer,
      publish: () =>
        batch.done({
          lattice: publication,
          ...(discovery
            ? { latticeRealmUsername: 'reader' }
            : { latticeInputGeneration: batch.currentGeneration - 1 }),
          countIndexEntries: false,
        }),
    };
  }

  test('native query publication retains input bytes automatically and honors per-field policy', async (assert) => {
    root.fieldDefs.members.snapshot = false;
    const sourceURL = realm + 'Record/two';
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,snapshot}','false') WHERE url=$1",
      { bind: [sourceURL + '.json'] },
    );
    const prepared = await candidate();
    assert.deepEqual(
      prepared.result.retainedInputs?.inputs
        .filter((input) => !input.owner)
        .map(({ fieldPath, sourceURL }) => ({ fieldPath, sourceURL })),
      [{ fieldPath: 'chosen', sourceURL }],
      'the same input is still retained for its other, default-policy field',
    );
    const store = new LatticeRetainedSnapshots(
      new LatticeRealmConfig([realm]),
      (expr) => db.withConnection((tx) => tx(expr)),
    );
    const link = {
      realmURL: realm,
      ownerURL: owner.slice(0, -5),
      fieldPath: 'chosen',
      source: { realmURL: realm, url: sourceURL },
    };
    assert.strictEqual(
      await store.read({ link }),
      undefined,
      'candidate construction does not write copies',
    );
    await prepared.publish();
    const copy = (await store.read({ link }))!;
    assert.strictEqual(JSON.parse(copy.document).data.attributes.amount, 2);
    assert.strictEqual(copy.snapshot.validatedThrough, 5);
    assert.strictEqual(copy.snapshot.definitionSeal, 'epoch');
    assert.strictEqual(copy.snapshot.status, 'live');
    assert.strictEqual(
      await store.read({ link: { ...link, fieldPath: 'members' } }),
      undefined,
    );
    await db.execute('DELETE FROM boxel_index WHERE url=$1', {
      bind: [sourceURL + '.json'],
    });
    assert.strictEqual(
      (await store.read({ link }))?.document,
      copy.document,
      'committed bytes survive independently of the input row',
    );
  });

  test('projected relationships retain at their own identities with trusted singular and plural policy', async (assert) => {
    const person = recordDefinition.fieldDefs.person;
    for (const [name, type, snapshot] of [
      ['privatePerson', 'linksTo', false],
      ['people', 'linksToMany', undefined],
      ['privatePeople', 'linksToMany', false],
      ['identity', 'linksTo', undefined],
    ] as const) {
      recordDefinition.fields[name] = name;
      recordDefinition.fieldDefs[name] = {
        ...person,
        type,
        ...(snapshot === false ? { snapshot } : {}),
      };
    }
    root.nativeQueryInputs!.chosen = {
      links: {
        person: {
          many: false,
          projection: { links: { person: { many: false, projection: {} } } },
        },
        privatePerson: { many: false, projection: {} },
        people: { many: true, projection: {} },
        privatePeople: { many: true, projection: {} },
        identity: { many: false, projection: 'id' },
      },
    };
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{relationships}',$2::jsonb) WHERE url=$1",
      {
        bind: [
          realm + 'Record/two.json',
          JSON.stringify({
            person: {
              links: { self: '../Person/one' },
              meta: { snapshot: false },
            },
            privatePerson: { links: { self: '../Person/one' } },
            'people.0': { links: { self: '../Person/one' } },
            'people.1': { links: { self: './one' } },
            'privatePeople.0': { links: { self: './one' } },
            identity: { links: { self: '../NotLoaded/one' } },
            unrelated: { links: { self: '../NotLoaded/two' } },
          }),
        ],
      },
    );
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{relationships}',$2::jsonb) WHERE url=$1",
      {
        bind: [
          realm + 'Person/one.json',
          JSON.stringify({ person: { links: { self: '../Record/one' } } }),
        ],
      },
    );
    const prepared = await candidate();
    assert.strictEqual(
      prepared.result.card.serialized!.data.attributes?.total,
      5,
    );
    await prepared.publish();
    const copies = await db.execute(
      'SELECT owner_url,field_path,source_url FROM lattice_retained_snapshots ORDER BY owner_url,field_path,source_url',
    );
    assert.deepEqual(
      copies,
      [
        {
          owner_url: owner.slice(0, -5),
          field_path: 'chosen',
          source_url: realm + 'Record/two',
        },
        {
          owner_url: owner.slice(0, -5),
          field_path: 'members',
          source_url: realm + 'Record/one',
        },
        {
          owner_url: owner.slice(0, -5),
          field_path: 'members',
          source_url: realm + 'Record/two',
        },
        {
          owner_url: realm + 'Person/one',
          field_path: 'person',
          source_url: realm + 'Record/one',
        },
        {
          owner_url: realm + 'Record/two',
          field_path: 'people',
          source_url: realm + 'Person/one',
        },
        {
          owner_url: realm + 'Record/two',
          field_path: 'people',
          source_url: realm + 'Record/one',
        },
        {
          owner_url: realm + 'Record/two',
          field_path: 'person',
          source_url: realm + 'Person/one',
        },
      ],
      'no root-relative pseudo-paths, opt-out copies or unloaded identity bodies',
    );
    const nestedCopy = await new LatticeRetainedSnapshots(
      new LatticeRealmConfig([realm]),
      (expr) => db.withConnection((tx) => tx(expr)),
    ).read({
      link: {
        realmURL: realm,
        ownerURL: realm + 'Record/two',
        fieldPath: 'person',
        source: { realmURL: realm, url: realm + 'Person/one' },
      },
    });
    assert.strictEqual(
      JSON.parse(nestedCopy!.document).data.attributes.amount,
      5,
    );
  });

  test('a projected field policy revision changing before publication rejects all copies', async (assert) => {
    const prepared = await candidate();
    await db.execute(
      "UPDATE lattice_owner_code_revision SET record_revision='record-v2'",
    );
    await assert.rejects(
      prepared.publish(),
      /Input policy changed before publication/,
    );
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
  });

  test('missing projected field definitions cannot silently enable retention', async (assert) => {
    delete recordDefinition.fields.person;
    await assert.rejects(
      candidate(),
      /Missing trusted projected relationship definition/,
    );
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
  });

  test('a source mutation before native publication installs neither output nor copies', async (assert) => {
    const prepared = await candidate();
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','999') WHERE url=$1",
      { bind: [realm + 'Record/two.json'] },
    );
    await assert.rejects(
      prepared.publish(),
      /input changed before publication/,
    );
    assert.deepEqual(
      await db.execute('SELECT owner_url FROM lattice_retained_snapshots'),
      [],
    );
    assert.deepEqual(
      await db.execute(
        "SELECT url FROM boxel_index WHERE url=$1 AND type='instance'",
        { bind: [owner] },
      ),
      [],
    );
  });

  test('the normal index visit carries native capture through to Batch publication', async (assert) => {
    const batch = await writer.createBatch(new URL(realm), network);
    const unexpected = async (): Promise<never> => {
      throw new Error('Native visit must not call Chrome or streams');
    };
    const result = await renderFileForIndexing({
      nativeCardIndexer: createIndexer(),
      url: new URL(owner),
      realmURL: new URL(realm),
      ignoreMap: new Map(),
      realmPaths: new RealmPaths(new URL(realm), network),
      batch,
      jobInfo: { jobId: 42, reservationId: 1, priority: 10, queueWaitMs: null },
      auth: '',
      batchId: 'retained-input-visit',
      virtualNetwork: network,
      inputSnapshot: {
        realmURL: realm,
        generation: batch.currentGeneration - 1,
      },
      reader: {
        readFile: async () => ({
          content: JSON.stringify({
            data: {
              type: 'card',
              attributes: { group: 'A' },
              meta: { adoptsFrom: rootRef },
            },
          }),
          lastModified: 1,
          created: 1,
          path: 'Dashboard/one.json',
        }),
        readStream: unexpected,
        mtimes: async () => ({ [owner]: 1 }),
      },
      prerenderer: {
        prerenderVisit: unexpected,
        prerenderModule: unexpected,
        runCommand: unexpected,
      },
      consumeClearCacheForRender: () => false,
      logDebug() {},
      logWarn() {},
    });
    if (!result?.card?.serialized || !result.card.searchDoc)
      throw new Error('Missing native visit');
    await batch.updateEntry(new URL(owner), {
      type: 'instance',
      resource: result.card.serialized.data,
      searchData: result.card.searchDoc,
      types: result.card.types!,
      displayNames: result.card.displayNames!,
      deps: new Set(result.card.deps),
      lastModified: 1,
      resourceCreatedAt: 1,
    } as InstanceEntry);
    await batch.done({
      lattice: publication,
      latticeInputGeneration: batch.currentGeneration - 1,
      countIndexEntries: false,
    });
    const copies = await db.execute(
      'SELECT field_path, source_url FROM lattice_retained_snapshots ORDER BY field_path, source_url',
    );
    assert.deepEqual(copies, [
      { field_path: 'chosen', source_url: realm + 'Record/two' },
      { field_path: 'members', source_url: realm + 'Record/one' },
      { field_path: 'members', source_url: realm + 'Record/two' },
      { field_path: 'person', source_url: realm + 'Person/one' },
    ]);
  });

  test('failure after capture rolls back owner promotion and retained inputs together', async (assert) => {
    const prepared = await candidate();
    await db.execute(
      "ALTER TABLE boxel_index ADD CONSTRAINT reject_retained_owner CHECK (url NOT LIKE '%Dashboard/one.json')",
    );
    await assert.rejects(prepared.publish(), /reject_retained_owner/);
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
    assert.deepEqual(
      await db.execute('SELECT owner_url FROM lattice_retained_snapshots'),
      [],
    );
    assert.deepEqual(
      await db.execute('SELECT owner_url FROM lattice_owners'),
      [],
    );
  });

  test('a removed working candidate cannot leave orphaned input copies', async (assert) => {
    const prepared = await candidate();
    await db.execute('DELETE FROM boxel_index_working WHERE url=$1', {
      bind: [owner],
    });
    await prepared.publish();
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
  });

  test('source discovery registers pending work without resolving queries or trusting supplied computed values', async (assert) => {
    const statements: string[] = [];
    const execute = db.execute.bind(db);
    db.execute = async (sql, options) => {
      statements.push(sql);
      return execute(sql, options);
    };
    const source = await candidate('A', undefined, true);
    const data = source.result.card.serialized!.data;
    assert.deepEqual(data.attributes, { group: 'A' });
    assert.notOk(
      data.relationships,
      'unresolved queries are absent, not fake empty results',
    );
    assert.strictEqual(data.meta.publication?.state, 'pending');
    assert.deepEqual(data.meta.publication?.computedFields, [
      'chosenIds',
      'total',
    ]);
    assert.deepEqual(data.meta.publication?.queryFields, ['chosen', 'members']);
    assert.deepEqual(data.meta.publication?.watches, []);
    assert.false(
      statements.some((sql) => sql.includes('END AS body')),
      'source discovery does not load matching input documents',
    );
    await source.publish();
    const [pending] = await db.execute(
      "SELECT pristine_doc FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [owner] },
    );
    assert.strictEqual(
      (pending.pristine_doc as any).meta.publication.state,
      'pending',
    );
    while (await publication.matchPending(realm, 'reader')) {
      /* capture and matching establish the durable first obligation */
    }
    assert.deepEqual(await publication.registry.pending(realm), [
      { ownerURL: owner, generation: 6 },
    ]);
    const current = await candidate('A', (request, admission) =>
      openLatticeNativeWork(db, request, admission),
    );
    await current.publish();
    const [ready] = await db.execute(
      "SELECT pristine_doc FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [owner] },
    );
    const published = ready.pristine_doc as any;
    assert.strictEqual(published.attributes.total, 5);
    assert.strictEqual(published.meta.publication.state, 'ready');
    assert.strictEqual(published.meta.publication.validatedThrough, 6);
    assert.strictEqual(published.meta.publication.outputRevision, 7);
    assert.deepEqual(await publication.registry.pending(realm), []);
    assert.strictEqual(
      (
        await db.execute(
          'SELECT field_path FROM lattice_query_watches WHERE owner_url=$1',
          { bind: [owner] },
        )
      ).length,
      3,
      'the computed value installs both query watches and explicit linked-input watches',
    );
  });

  test('query, computed parameter, explicit linked data and publication stay in one card identity', async (assert) => {
    const { result, publish } = await candidate();
    const timings = result.timings!;
    assert.deepEqual(
      timings.inputStages
        ?.filter((stage) => stage.kind === 'query')
        .map((stage) => stage.field),
      ['members', 'chosen'],
      'query measurements follow actual dependency settlement order',
    );
    const prerequisite = timings.inputStages?.find(
      (stage) => stage.kind === 'prerequisite',
    );
    assert.strictEqual(prerequisite?.field, 'chosenIds');
    assert.true(prerequisite!.inputBytes! > 0);
    assert.true(prerequisite!.evaluatorMs! >= 0);
    assert.true(
      timings.assembly!.queryInputs >=
        timings.inputStages!.reduce(
          (total, stage) => total + stage.elapsedMs,
          0,
        ),
      'input phase walls fit inside the surrounding query-input wall',
    );
    assert.strictEqual(timings.omittedInputStages, 0);
    assert.strictEqual(result.card.serialized!.data.attributes?.total, 5);
    const chosen = result.card.serialized!.data.relationships?.chosen;
    if (Array.isArray(chosen)) throw new Error('Expected one relationship');
    assert.deepEqual(chosen?.data, [
      { id: realm + 'Record/two', type: 'card' },
    ]);
    assert.notOk(
      Object.hasOwn(result.card.searchDoc!, 'chosen'),
      'query graph is absent from search data',
    );
    await publish();
    const [row] = await db.execute(
      "SELECT pristine_doc FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [owner] },
    );
    const published = row.pristine_doc as any;
    assert.strictEqual(published.attributes.total, 5);
    assert.strictEqual(published.meta.publication.state, 'ready');
    assert.deepEqual(published.meta.publication.queryFields.sort(), [
      'chosen',
      'members',
    ]);
    const watches = await db.execute(
      'SELECT field_path,query FROM lattice_query_watches WHERE owner_url=$1',
      { bind: [owner] },
    );
    assert.true(
      watches.some(
        (row) =>
          row.field_path === '@lattice/inputs' &&
          (row.query as any).filter.in.id.includes(realm + 'Person/one'),
      ),
      'a joined person gets a secondary invalidation watch',
    );
    const affected = await publication.registry.affected(
      realm,
      {
        url: realm + 'Person/one.json',
        types: [internalKeyFor(recordRef, undefined, network)],
        search_doc: { id: realm + 'Person/one', group: 'B', amount: 5 },
      },
      undefined,
    );
    assert.true(
      affected.includes(owner),
      'changing the joined person invalidates the owner even though it misses the membership query',
    );
  });

  test('a deleted projected link preserves the owner and retains its restoration watch', async (assert) => {
    const target = realm + 'Person/one.json';
    await (await candidate()).publish();
    const store = new LatticeRetainedSnapshots(
      new LatticeRealmConfig([realm]),
      (expr) => db.withConnection((tx) => tx(expr)),
    );
    const link = {
      realmURL: realm,
      ownerURL: realm + 'Record/two',
      fieldPath: 'person',
      source: { realmURL: realm, url: target.slice(0, -5) },
    };
    const before = (await store.read({ link }))!;
    await db.execute('UPDATE boxel_index SET is_deleted=TRUE WHERE url=$1', {
      bind: [target],
    });
    const { result, publish } = await candidate();
    assert.strictEqual(result.card.serialized!.data.attributes?.total, 0);
    const chosen = result.card.serialized!.data.relationships?.chosen;
    if (Array.isArray(chosen)) throw new Error('Expected one relationship');
    assert.deepEqual(
      chosen?.data,
      [{ id: realm + 'Record/two', type: 'card' }],
      'a missing link does not remove its live query member',
    );
    await publish();
    const after = (await store.read({ link }))!;
    assert.strictEqual(
      after.document,
      before.document,
      'missing input preserves the last retained bytes',
    );
    assert.strictEqual(
      after.snapshot.validatedThrough,
      before.snapshot.validatedThrough,
      'deletion is not a new confirmation of the old value',
    );
    assert.true(
      (
        await publication.registry.affected(realm, undefined, {
          url: target,
          types: [internalKeyFor(recordRef, undefined, network)],
          search_doc: { id: realm + 'Person/one', group: 'B', amount: 5 },
        })
      ).includes(owner),
      'restoring the absent target still reaches its consumer',
    );
    await db.execute('UPDATE boxel_index SET is_deleted=FALSE WHERE url=$1', {
      bind: [target],
    });
    const restored = await candidate();
    assert.strictEqual(
      restored.result.card.serialized!.data.attributes?.total,
      5,
    );
  });

  test('publication reuses native queries without another schema read or serializing SQL into card data', async (assert) => {
    const { result, publish } = await candidate();
    assert.strictEqual(result.queryPreparation?.watches.length, 2);
    assert.false(
      JSON.stringify(result.card).includes('lattice_input'),
      'compiled expressions stay outside card JSON',
    );
    lookup.lookupDefinition = async (ref) => {
      if (ref.module === recordRef.module)
        throw new Error('Duplicate definition lookup');
      return recordDefinition;
    };
    // Registration must own its compact copy, independent of the producer.
    result.queryPreparation!.watches.length = 0;
    await publish();
    const watches = await db.execute(
      'SELECT field_path FROM lattice_query_watches WHERE owner_url=$1',
      { bind: [owner] },
    );
    assert.strictEqual(watches.length, 3);
  });

  test('replacing a native result without prepared queries falls back to normal preparation', async (assert) => {
    const { result, batch, publish } = await candidate();
    batch.registerLatticeNativeCard(owner, result.assertCurrent);
    lookup.lookupDefinition = async () => {
      throw new Error('Fresh schema preparation required');
    };
    await assert.rejects(publish(), /Fresh schema preparation required/);
    assert.strictEqual(
      (
        await db.execute(
          'SELECT owner_url FROM lattice_owners WHERE owner_url=$1',
          { bind: [owner] },
        )
      ).length,
      0,
    );
  });

  test('a proven empty membership stays empty after prerequisites settle', async (assert) => {
    const { result, publish } = await candidate('missing');
    assert.strictEqual(result.card.serialized!.data.attributes?.total, 0);
    const chosen = result.card.serialized!.data.relationships?.chosen;
    if (Array.isArray(chosen)) throw new Error('Expected one relationship');
    assert.deepEqual(chosen?.data, []);
    await publish();
  });

  for (const change of ['input', 'code'])
    test(
      'a changed ' + change + ' rejects the whole native owner publication',
      async (assert) => {
        const { publish } = await candidate();
        if (change === 'input')
          await db.execute(
            "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','8') WHERE url=$1",
            { bind: [realm + 'Person/one.json'] },
          );
        else
          await db.execute(
            "UPDATE lattice_owner_code_revision SET revision='code-v2'",
          );
        await assert.rejects(publish(), /changed before publication/);
        assert.strictEqual(
          (
            await db.execute(
              "SELECT url FROM boxel_index WHERE url=$1 AND type='instance'",
              { bind: [owner] },
            )
          ).length,
          0,
        );
        assert.strictEqual(
          (
            await db.execute(
              'SELECT owner_url FROM lattice_owners WHERE owner_url=$1',
              { bind: [owner] },
            )
          ).length,
          0,
        );
        assert.strictEqual(
          (
            await db.execute(
              'SELECT field_path FROM lattice_query_watches WHERE owner_url=$1',
              { bind: [owner] },
            )
          ).length,
          0,
          'no query registration escapes the rejected publication',
        );
        assert.strictEqual(
          (await db.execute('SELECT id FROM lattice_publication_events'))
            .length,
          0,
          'no publication event escapes the rejected publication',
        );
      },
    );

  test('a query/computed dependency cycle does not publish an empty value', async (assert) => {
    root.fieldDefs.chosenIds.bxl = formula('[.chosen[].id]');
    await assert.rejects(candidate(), /query\/computation cycle/);
  });
  test('an unresolved linked record declines native execution without publishing a partial total', async (assert) => {
    await db.execute('DELETE FROM boxel_index WHERE url=$1', {
      bind: [realm + 'Person/one.json'],
    });
    let closed = false;
    const indexer = createIndexer(async () => ({
      signal: new AbortController().signal,
      close: async () => {
        closed = true;
      },
    }));
    const request = {
      url: owner,
      realmURL: realm,
      sourceJSON: JSON.stringify({
        data: {
          type: 'card',
          attributes: { group: 'A' },
          meta: { adoptsFrom: rootRef },
        },
      }),
      generation: 6,
      loaderEpoch: 'epoch',
      lastModified: 1,
      resourceCreatedAt: 1,
      inputSnapshot: { realmURL: realm, generation: 5 },
    };
    const result = await indexer(request);
    assert.strictEqual(
      result,
      undefined,
      'the existing browser producer may try',
    );
    assert.true(closed, 'native work is closed before fallback');
    assert.strictEqual(
      (await db.execute('SELECT owner_url FROM lattice_owners')).length,
      0,
      'no owner is published by the declined attempt',
    );
    assert.strictEqual(
      (await db.execute('SELECT owner_url FROM lattice_query_watches')).length,
      0,
      'partial input watches do not escape',
    );

    const controller = new AbortController();
    const reason = new LatticeWorkSuperseded('input changed during read');
    const execute = db.execute.bind(db);
    db.execute = async (sql, options) => {
      const rows = await execute(sql, options);
      if (sql.includes('AS code_current')) controller.abort(reason);
      return rows;
    };
    closed = false;
    const cancelled = createIndexer(async () => ({
      signal: controller.signal,
      close: async () => {
        closed = true;
      },
    }));
    await assert.rejects(
      cancelled(request),
      (error: unknown) => error === reason,
      'cancellation wins over a simultaneous unknown-target decline',
    );
    assert.true(closed, 'cancelled native work is also closed');
  });

  for (const state of ['failed', 'future', 'oversized']) {
    test(`a ${state} projected input is an error rather than a native decline`, async (assert) => {
      const changes = {
        failed: 'has_error=TRUE',
        future: 'generation=6',
        oversized:
          "pristine_doc=jsonb_set(pristine_doc,'{attributes,large}',to_jsonb(repeat('x',1048577)))",
      };
      await db.execute(
        `UPDATE boxel_index SET ${changes[state as keyof typeof changes]} WHERE url=$1`,
        { bind: [realm + 'Person/one.json'] },
      );
      await assert.rejects(candidate(), /failed, future or oversized/);
    });
  }

  test('a truncated query cannot publish a complete-looking total', async (assert) => {
    root.fieldDefs.members.query!.page = { size: 1 };
    await assert.rejects(candidate(), /Incomplete Lattice query membership/);
  });

  test('a foreign query realm is not silently replaced by the owner realm', async (assert) => {
    root.fieldDefs.members.query!.realms = ['https://another-realm.example/'];
    await assert.rejects(candidate(), /must stay in its authorized realm/);
  });

  test('a queued source change after computation supersedes publication', async (assert) => {
    const { publish } = await candidate();
    await db.execute(
      `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
      VALUES('incremental-index',$1,10,10,'{}')`,
      { bind: ['indexing:' + realm] },
    );
    await assert.rejects(
      publish(),
      (error: unknown) => error instanceof LatticeWorkSuperseded,
    );
    assert.strictEqual(
      (
        await db.execute(
          'SELECT owner_url FROM lattice_owners WHERE owner_url=$1',
          { bind: [owner] },
        )
      ).length,
      0,
    );
  });

  for (const reason of ['newer source', 'read authority changed']) {
    test(`the real materialization task preserves superseded work for ${reason} without retries or Chrome warming`, async (assert) => {
      let cancel = false;
      const initial = await candidate('A', async (request, admission) => {
        if (cancel && reason === 'read authority changed')
          return openLatticeNativeWork(db, request, admission);
        const controller = new AbortController();
        if (cancel) controller.abort(new LatticeWorkSuperseded(reason));
        return { signal: controller.signal, close: async () => {} };
      });
      await initial.publish();
      while (await publication.matchPending(realm, 'reader')) {
        /* drain the fixture's committed events */
      }
      await db.execute('UPDATE jobs SET status=$1', { bind: ['resolved'] });
      await db.execute(
        'UPDATE lattice_owners SET dirty_generation=6 WHERE owner_url=$1',
        { bind: [owner] },
      );
      cancel = true;
      if (reason === 'read authority changed')
        await db.execute(
          'UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1',
          { bind: [realm] },
        );
      await db.withWriteLock('lattice:index:' + realm, async (tx) => {
        if (!tx) throw new Error('Expected transaction');
        await enqueueLattice(tx, realm, 'reader', 999, 2);
      });
      const publisher = new PgQueuePublisher(db);
      const unexpected = async (): Promise<never> => {
        throw new Error('Unexpected browser/module work');
      };
      const prerenderer: Prerenderer = {
        prerenderModule: unexpected,
        prerenderVisit: unexpected,
        runCommand: unexpected,
      };
      // The fixture supplies its indexed schema directly, as native admission
      // does above. Frontier planning may inspect type identities; it must not
      // fetch a nonexistent .example realm to obtain this fixture's schema.
      const definitionLookup = {
        forRealm() {
          return this;
        },
        lookupDefinition: lookup.lookupDefinition.bind(lookup),
      } as unknown as DefinitionLookup;
      const content = JSON.stringify({
        data: {
          type: 'card',
          attributes: { group: 'A' },
          meta: { adoptsFrom: rootRef },
        },
      });
      const task = latticeMaterialize({
        nativeCardIndexer: initial.indexer,
        dbAdapter: db,
        queuePublisher: publisher,
        matrixURL: 'https://example',
        indexWriter: writer,
        definitionLookup,
        virtualNetwork: network,
        prerenderer,
        createPrerenderAuth: () => '',
        getAuthedFetch: async () => network.fetch,
        getReader: () => ({
          readFile: async () => ({
            content,
            path: 'Dashboard/one.json',
            lastModified: 1,
            created: 1,
          }),
          readStream: unexpected,
          mtimes: async () => ({ [owner]: 1 }),
        }),
        reportStatus() {},
        log: logger('lattice-cancellation-test'),
      });
      try {
        const result = await task({
          realmURL: realm,
          realmUsername: 'reader',
          wave: 1,
          attempt: 2,
        });
        assert.strictEqual(result.superseded, reason);
        assert.deepEqual(result.invalidations, []);
        const [pending] = await db.execute(
          "SELECT args FROM jobs WHERE status='unfulfilled' AND job_type='lattice-materialize'",
        );
        assert.strictEqual(
          (pending.args as any).attempt,
          0,
          'supersession did not spend or inherit error retry budget',
        );
        assert.strictEqual((pending.args as any).wave, 0);
        assert.deepEqual(
          (pending.args as any).latticeWaitForRead,
          reason === 'read authority changed'
            ? { realmURL: realm, actor }
            : undefined,
        );
        assert.strictEqual(
          (await db.execute("SELECT id FROM jobs WHERE status='unfulfilled'"))
            .length,
          1,
          'the obsolete pending wake-up was updated, not duplicated',
        );
        const [record] = await db.execute(
          'SELECT dirty_generation,published_generation FROM lattice_owners WHERE owner_url=$1',
          { bind: [owner] },
        );
        assert.strictEqual(Number(record.dirty_generation), 6);
        assert.strictEqual(Number(record.published_generation), 6);
        assert.strictEqual(
          (
            await db.execute(
              'SELECT url FROM boxel_index WHERE realm_url=$1 AND has_error=TRUE',
              { bind: [realm] },
            )
          ).length,
          0,
        );
      } finally {
        await publisher.destroy();
      }
    });
  }

  for (const retired of [false, true])
    test(`an obsolete wake-up does no work after an owner is ${retired ? 'retired' : 'already fresh'}`, async (assert) => {
      await db.execute(
        `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,
         dirty_generation,definition_revision,retired) VALUES($1,$2,5,5,NULL,'epoch',$3)`,
        { bind: [realm, owner, retired] },
      );
      // These dependencies must remain unused: this wake-up has no current
      // computation to perform. Registry and generation reads use real SQL.
      const unexpected = async (): Promise<never> => {
        throw new Error('Obsolete work attempted source or module execution');
      };
      const prerenderer = {
        prerender: unexpected,
        prerenderModule: unexpected,
        visit: unexpected,
      } as unknown as Prerenderer;
      const runner = new IndexRunner({
        realmURL: new URL(realm),
        reader: {
          readFile: unexpected,
          readStream: unexpected,
          mtimes: unexpected,
        },
        indexWriter: writer,
        definitionLookup: new CachingDefinitionLookup(
          db,
          prerenderer,
          network,
          () => '',
        ),
        virtualNetwork: network,
        prerenderer,
        auth: '',
        fetch: unexpected,
        realmOwnerUserId: actor,
      });
      const result = await IndexRunner.materialize(runner, 'reader', 1000);
      assert.deepEqual(result.invalidations, []);
      assert.strictEqual(
        result.generation,
        undefined,
        'no publication batch was opened',
      );
      const [row] = await db.execute(
        'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
        { bind: [realm] },
      );
      assert.strictEqual(Number(row.current_generation), 5);
      assert.strictEqual(
        (await db.execute('SELECT id FROM jobs')).length,
        0,
        'no retry is queued',
      );
    });
});
