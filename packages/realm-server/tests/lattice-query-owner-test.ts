import { recordLatticeReadDemand } from '@cardstack/runtime-common/lattice-demand';
import { renderFileForIndexing } from '@cardstack/runtime-common/index-runner/visit-file';
import { basename } from 'node:path';
import { LatticeRetainedSnapshots } from '@cardstack/runtime-common/lattice-retained-snapshots';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import QUnit from 'qunit';
import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import { PgQueuePublisher, type PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
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
import {
  enqueueLattice,
  latticeOverdueWorkSQL,
} from '@cardstack/runtime-common/jobs/lattice';
import { LatticeWorkSuperseded } from '@cardstack/runtime-common/lattice-work';
import {
  latticeInterleaveStale,
  latticePublicationDecision,
  latticeWorkDecision,
} from '@cardstack/runtime-common/lattice-kernel';
import { latticeReadPathsChanged } from '@cardstack/runtime-common/lattice-query-registry';
import {
  applyLatticeProjectionWhere,
  assertLatticeProjectionWhere,
} from '../lib/lattice-data-projection.ts';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import { createLatticeNativeCardIndexer } from '../lib/lattice-native-card-indexer.ts';
import { LatticeMaterializationInputs } from '../lib/lattice-materialization-inputs.ts';
import { openLatticeNativeWork } from '../lib/lattice-native-work.ts';
import {
  LatticeQueryRegistry,
  type LatticeDocument,
} from '@cardstack/runtime-common/lattice-query-registry';
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

module(basename(import.meta.filename), function (hooks) {
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
          ...(request.inputSnapshot!.stale ? { stale: true as const } : {}),
          lookup,
        }),
    });
  }

  async function candidate(
    group = 'A',
    openWork?: Parameters<typeof createLatticeNativeCardIndexer>[0]['openWork'],
    discovery = false,
    opts?: { stale?: true; ownerURL?: string; isolated?: boolean },
  ) {
    const candidateOwner = opts?.ownerURL ?? owner;
    const batch = await writer.createBatch(new URL(realm), network, undefined, {
      latticeMaterialization: opts?.isolated,
    });
    const inputGeneration = batch.currentGeneration - 1;
    const indexer = createIndexer(openWork);
    const result = await indexer({
      url: candidateOwner,
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
            ...(opts?.stale ? { stale: true as const } : {}),
          },
    });
    if (!result?.card.serialized || !result.card.searchDoc)
      throw new Error('Missing native owner');
    batch.registerLatticeNativeCard(
      candidateOwner,
      result.assertCurrent,
      result.codeReference,
      result.queryPreparation,
      result.retainedInputs,
    );
    await batch.updateEntry(new URL(candidateOwner), {
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
            : { latticeInputGeneration: inputGeneration }),
          countIndexEntries: false,
        }),
    };
  }

  test('overlapping candidate attempts cannot replace each other or primary staging', async (assert) => {
    const older = await candidate('A', undefined, false, { isolated: true });
    const primary = await writer.createBatch(new URL(realm), network);
    await primary.updateEntry(new URL(owner), {
      type: 'instance',
      resource: {
        ...older.result.card.serialized!.data,
        attributes: { group: 'source-only' },
      },
      searchData: { group: 'source-only' },
      types: [],
      displayNames: [],
      deps: new Set(),
      lastModified: 1,
      resourceCreatedAt: 1,
    } as InstanceEntry);
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','7'),search_doc=jsonb_set(search_doc,'{amount}','7') WHERE url=$1",
      { bind: [realm + 'Person/one.json'] },
    );
    const newer = await candidate('A', undefined, false, { isolated: true });
    const [staged] = await db.execute(
      'SELECT count(*) AS n FROM lattice_index_candidates WHERE url=$1',
      { bind: [owner] },
    );
    assert.strictEqual(Number(staged.n), 2, 'both attempts have their own row');
    await assert.rejects(
      older.publish(),
      /input changed/,
      'old inputs still fence an expired candidate',
    );
    await older.batch.discardLatticeCandidates();
    await newer.publish();
    const [published] = await db.execute(
      "SELECT pristine_doc->'attributes' AS value FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [owner] },
    );
    assert.strictEqual(
      (published.value as any).total,
      7,
      'only the validated attempt publishes',
    );
    const [source] = await db.execute(
      "SELECT pristine_doc->'attributes'->>'group' AS value FROM boxel_index_working WHERE url=$1 AND type='instance'",
      { bind: [owner] },
    );
    assert.strictEqual(
      source.value,
      'source-only',
      'publication and cleanup leave primary staging untouched',
    );
    await newer.batch.discardLatticeCandidates();
    const [remaining] = await db.execute(
      'SELECT count(*) AS n FROM lattice_index_candidates',
    );
    assert.strictEqual(Number(remaining.n), 0);
  });

  test('a stale candidate rebases beside primary indexing; a fresh candidate does not', async (assert) => {
    staleTotal();
    await (await candidate()).publish();
    await db.execute(
      "UPDATE lattice_owners SET dirty_generation=6,stale_after=now()-interval '1 second' WHERE owner_url=$1",
      { bind: [owner] },
    );
    const stale = await candidate('A', undefined, false, {
      isolated: true,
      stale: true,
    });
    const fresh = await candidate('A', undefined, false, { isolated: true });
    const primary = await writer.createBatch(new URL(realm), network);
    const writeUnrelated = async (batch: typeof primary, name: string) => {
      const url = realm + name + '.json';
      await batch.updateEntry(new URL(url), {
        type: 'instance',
        resource: {
          id: rri(url.slice(0, -5)),
          type: 'card',
          attributes: { group: 'Z', amount: 0 },
          meta: { adoptsFrom: recordRef },
        },
        searchData: { group: 'Z', amount: 0 },
        types: [internalKeyFor(recordRef, undefined, network)],
        displayNames: ['Record'],
        deps: new Set(),
        lastModified: 1,
        resourceCreatedAt: 1,
      } as InstanceEntry);
    };
    await writeUnrelated(primary, 'Unrelated/one');
    await primary.done({
      lattice: publication,
      latticeRealmUsername: 'reader',
      countIndexEntries: false,
    });
    assert.strictEqual(primary.currentGeneration, 7);
    const nextPrimary = await writer.createBatch(new URL(realm), network);
    await writeUnrelated(nextPrimary, 'Unrelated/two');
    await assert.rejects(
      fresh.publish(),
      /generation or read authority changed/,
      'ordinary attempts cannot call old inputs fresh',
    );
    await stale.publish();
    assert.strictEqual(
      stale.batch.currentGeneration,
      8,
      'stale output gets a new commit revision',
    );
    const row = await ownerRow();
    assert.notStrictEqual(
      row.dirty_generation,
      null,
      'stale output keeps its obligation',
    );
    const [body] = await db.execute(
      "SELECT pristine_doc->'meta'->'publication' AS receipt FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [owner] },
    );
    assert.strictEqual(
      (body.receipt as any).validatedThrough,
      6,
      'input revision was not relabeled as fresh',
    );
    await nextPrimary.done({
      lattice: publication,
      latticeRealmUsername: 'reader',
      countIndexEntries: false,
    });
    assert.strictEqual(
      nextPrimary.currentGeneration,
      9,
      'primary also advances past the intervening wave',
    );
    const [clock] = await db.execute(
      'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.strictEqual(Number(clock.current_generation), 9);
    await stale.batch.discardLatticeCandidates();
    await fresh.batch.discardLatticeCandidates();
  });

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
    assert.deepEqual(
      data.meta.publication?.sourceFields,
      { group: 'string' },
      'only admitted source primitives can narrow readiness',
    );
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
      { ownerURL: owner, generation: 6, stale: true },
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
        // LatticeMaterializationInputs.MAX_CARD_BYTES
        oversized:
          "pristine_doc=jsonb_set(pristine_doc,'{attributes,large}',to_jsonb(repeat('x',4194305)))",
      };
      await db.execute(
        `UPDATE boxel_index SET ${changes[state as keyof typeof changes]} WHERE url=$1`,
        { bind: [realm + 'Person/one.json'] },
      );
      await assert.rejects(
        candidate(),
        state === 'future'
          ? (error: unknown) => error instanceof LatticeWorkSuperseded
          : /failed, future or oversized/,
      );
    });
  }

  test('a truncated query cannot publish a complete-looking total', async (assert) => {
    root.fieldDefs.members.query!.page = { size: 1 };
    await assert.rejects(candidate(), /Incomplete Lattice query membership/);
  });

  // A sorted page is Ziggrid's `limit top`: the owner reads the page, and the
  // watch carries the page's key range so a row that cannot reach the page
  // never invalidates it.
  // --- staleAfter: the deadline side of a value's validity window ---------
  const deadline = (seconds: number) =>
    `(.__clock.now | fromdateiso8601) + ${seconds} | todateiso8601`;
  function staleTotal(seconds = 90) {
    root.fieldDefs.total.bxl = getBxlComputeDefinition(
      bxl('[.chosen[] | .person.amount] | add // 0', {
        readableSyntax: false,
        libraries: ['core'],
        staleAfter: deadline(seconds),
      }),
    )!;
  }
  const ownerRow = async () =>
    (
      await db.execute(
        `SELECT published_generation, dirty_generation, settle_until,
           stale_within, stale_after, stale_after > now() AS deferred,
           EXTRACT(EPOCH FROM (stale_after - now())) AS seconds
         FROM lattice_owners WHERE owner_url=$1`,
        { bind: [owner] },
      )
    )[0];

  test('a staleness bound is published as a window and armed when the owner turns dirty', async (assert) => {
    staleTotal(90);
    const { result, publish } = await candidate();
    const stamp = result.card.serialized!.data.meta.publication!;
    assert.strictEqual(
      stamp.staleWithin,
      90,
      'the receipt carries the earliest window, measured from the clock the program read',
    );
    assert.strictEqual(stamp.stale, undefined, 'an ordinary attempt');
    await publish();
    let row = await ownerRow();
    assert.strictEqual(row.dirty_generation, null, 'published clean');
    assert.strictEqual(
      row.settle_until,
      null,
      'no freshness hold was asked for',
    );
    assert.strictEqual(Number(row.stale_within), 90);
    assert.strictEqual(row.stale_after, null, 'a clean owner has no deadline');
    const registry = new LatticeQueryRegistry(
      db,
      new IndexQueryEngine(db, lookup, network),
    );
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      await registry.markDirty(tx!, realm, [owner], 7);
    });
    row = await ownerRow();
    assert.ok(
      Number(row.seconds) > 85,
      `turning dirty arms the deadline ninety seconds out, got ${row.seconds}`,
    );
    assert.ok(Number(row.seconds) <= 90, 'and no further');
    const armed = String(row.stale_after);
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      await registry.markDirty(tx!, realm, [owner], 8);
    });
    assert.strictEqual(
      String((await ownerRow()).stale_after),
      armed,
      'further dirt does not push the deadline out',
    );
    // The owner's own card re-indexed as a source: a pending re-registration
    // that evaluated no grains. The window and the armed deadline survive it.
    const [{ definition_revision }] = await db.execute(
      'SELECT definition_revision FROM lattice_owners WHERE owner_url=$1',
      { bind: [owner] },
    );
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      await registry.publish(tx!, {
        realmURL: realm,
        ownerURL: owner,
        generation: 9,
        inputGeneration: 0,
        definitionRevision: String(definition_revision),
        watches: [],
        pending: true,
      });
    });
    row = await ownerRow();
    assert.strictEqual(
      Number(row.stale_within),
      90,
      'a re-registration without grains keeps the window',
    );
    assert.strictEqual(
      String(row.stale_after),
      armed,
      'and keeps the deadline already armed',
    );
  });

  test('the kernel admits an overdue owner past the source, input and obligation fences', async (assert) => {
    const blocked = {
      id: owner,
      obligation: 6,
      authorized: true,
      sourcePending: true,
      active: true,
      inputsCurrent: false,
      codeCurrent: true,
    };
    assert.strictEqual(latticeWorkDecision(blocked).status, 'withheld');
    assert.deepEqual(latticeWorkDecision({ ...blocked, overdue: true }), {
      status: 'ready',
      claim: { id: owner, obligation: 6, stale: true },
    });
    assert.strictEqual(
      latticeWorkDecision({ ...blocked, overdue: true, obligation: null })
        .status,
      'withheld',
      'nothing to do is still nothing to do',
    );
    assert.strictEqual(
      latticeWorkDecision({ ...blocked, overdue: true, codeCurrent: false })
        .status,
      'withheld',
      'stale code is never run',
    );
    assert.strictEqual(
      latticeWorkDecision({ ...blocked, overdue: true, authorized: false })
        .status,
      'withheld',
    );
    assert.strictEqual(
      latticeWorkDecision(
        { ...blocked, overdue: true, obligation: 8 },
        { id: owner, obligation: 6, stale: true },
      ).status,
      'ready',
      'a newer obligation does not withdraw a stale claim',
    );
    assert.strictEqual(
      latticeWorkDecision(
        {
          ...blocked,
          overdue: true,
          obligation: 8,
          sourcePending: false,
          inputsCurrent: true,
        },
        { id: owner, obligation: 6 },
      ).status,
      'withheld',
      'an ordinary claim still yields to a newer obligation',
    );
    assert.deepEqual(
      latticePublicationDecision(
        { publishedAt: 7, validatedThrough: 6, kind: 'publish', stale: true },
        { publishedAt: 6, dirtyAt: 7 },
      ),
      { status: 'publish' },
      'a stale publication may trail the obligation',
    );
    assert.strictEqual(
      latticePublicationDecision(
        { publishedAt: 7, validatedThrough: 6, kind: 'publish' },
        { publishedAt: 6, dirtyAt: 7 },
      ).status,
      'reject',
    );
    // A wave alternates stale attempts with ordinary owners, so a drain
    // of many games ahead of a few seasons in URL order still gives the
    // seasons half of every wave.
    const g = (id: string) => ({ ownerURL: id });
    const s = (id: string) => ({ ownerURL: id, stale: true as const });
    assert.deepEqual(
      latticeInterleaveStale([g('g1'), g('g2'), g('g3'), s('s1'), s('s2')]).map(
        (o) => o.ownerURL,
      ),
      ['s1', 'g1', 's2', 'g2', 'g3'],
    );
    assert.deepEqual(
      latticeInterleaveStale([g('g1'), g('g2')]).map((o) => o.ownerURL),
      ['g1', 'g2'],
      'no stale owners, no change',
    );
  });

  test('past its deadline a dirty owner is scheduled ahead of its dirty inputs', async (assert) => {
    staleTotal();
    await (await candidate()).publish();
    const registry = new LatticeQueryRegistry(
      db,
      new IndexQueryEngine(db, lookup, network),
    );
    // A materialized feeder the owner reads, itself dirty: the readiness
    // join holds the owner back until the feeder publishes.
    const feeder = realm + 'Person/one.json';
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
       VALUES($1,$2,5,4,6,'epoch',FALSE)`,
      { bind: [realm, feeder] },
    );
    // Registered by discovery but never published: there is no last body a
    // stale attempt could read, so it blocks an overdue owner too.
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication}',$2::jsonb) WHERE url=$1`,
      {
        bind: [
          feeder,
          JSON.stringify({
            version: 1,
            state: 'pending',
            validatedThrough: 0,
            computedFields: [],
            queryFields: [],
          }),
        ],
      },
    );
    await db.execute(
      "UPDATE boxel_index SET deps = COALESCE(deps,'[]'::jsonb) || $2::jsonb WHERE url=$1",
      { bind: [owner, JSON.stringify([feeder])] },
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=6 WHERE owner_url=$1',
      { bind: [owner] },
    );
    const names = (rows: Array<{ ownerURL: string }>) =>
      rows.map((row) => row.ownerURL).sort();
    assert.deepEqual(
      names(await registry.ready(realm)),
      [feeder],
      'before the deadline the owner waits for its feeder',
    );
    assert.deepEqual(
      names(await registry.ready(realm, { overdueOnly: true })),
      [feeder],
      'first output gets a progress turn without a computed deadline; its consumer still waits',
    );
    await db.execute(
      `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args, status)
       VALUES ('incremental-index', $1, 3600, 10, $2, 'unfulfilled')`,
      { bind: ['indexing:' + realm, JSON.stringify({ realmURL: realm })] },
    );
    const [admission] = await db.execute(
      `SELECT ${latticeOverdueWorkSQL} AS allowed FROM jobs j WHERE j.concurrency_group=$1`,
      { bind: ['indexing:' + realm] },
    );
    assert.true(
      Boolean(admission.allowed),
      'the queue uses the same initial-admission rule',
    );
    const initialWork = {
      realmURL: realm,
      actor,
      claim: { id: feeder, obligation: 6, stale: true as const },
      inputGeneration: 5,
      definitionRevision: 'epoch',
    };
    await registry.assertWorkCurrent(initialWork);
    await assert.rejects(
      registry.assertWorkCurrent({
        ...initialWork,
        definitionRevision: 'obsolete',
      }),
      /module revision/,
      'initial admission never bypasses the code fence',
    );
    await db.execute('DELETE FROM jobs WHERE concurrency_group=$1', {
      bind: ['indexing:' + realm],
    });
    await recordLatticeReadDemand(db, realm, actor, [owner], 2);
    assert.deepEqual(
      (await registry.ready(realm)).map(({ ownerURL, demand }) => ({
        ownerURL,
        demand,
      })),
      [{ ownerURL: feeder, demand: 2 }],
      'an authorized wait promotes the feeder, never the blocked consumer',
    );
    await db.execute(
      "UPDATE lattice_owners SET stale_after = now() - interval '1 second' WHERE owner_url=$1",
      { bind: [owner] },
    );
    assert.deepEqual(
      names(await registry.ready(realm)),
      [feeder],
      'past it too, while the feeder has never published',
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
      { bind: [feeder] },
    );
    assert.deepEqual(
      names(await registry.ready(realm)),
      [],
      'a stub blocks even before routing marks it dirty',
    );
    await db.execute('DELETE FROM lattice_owners WHERE owner_url=$1', {
      bind: [feeder],
    });
    assert.deepEqual(
      names(await registry.ready(realm)),
      [],
      'a stub blocks even before its owner is registered',
    );
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
       VALUES($1,$2,5,4,6,'epoch',FALSE)`,
      { bind: [realm, feeder] },
    );
    // The feeder has published once: its row carries an output revision. Its
    // state may well be pending again (its card re-indexed as a source); the
    // body is what a stale attempt reads, and the body is there.
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication,outputRevision}','5') WHERE url=$1`,
      { bind: [feeder] },
    );
    assert.deepEqual(
      names(await registry.ready(realm)),
      [feeder, owner].sort(),
      'past it the owner runs over what the feeder last published, pending state or not',
    );
    assert.deepEqual(
      (await registry.pending(realm, { runnableOnly: true }))
        .filter((row) => row.ownerURL === owner)
        .map((row) => row.stale),
      [true],
      'and is scheduled as a stale attempt',
    );
    assert.deepEqual(
      names(await registry.ready(realm, { overdueOnly: true })),
      [owner],
      'a wave of stale attempts alone leaves the ordinary feeder to the backlog',
    );
    assert.true(await registry.hasOverdue(realm));
    assert.deepEqual(
      (await registry.ready(realm))
        .filter((row) => row.ownerURL === owner)
        .map((row) => row.stale),
      [true],
      'blocked by its feeder, the overdue owner runs as a stale attempt',
    );
    assert.strictEqual(
      (await registry.ready(realm)).find((row) => row.ownerURL === owner)
        ?.pendingInputCount,
      1,
      'ordering retains the unfinished dependency count even when readiness permits a stale read',
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
      { bind: [feeder] },
    );
    assert.deepEqual(
      (await registry.ready(realm))
        .filter((row) => row.ownerURL === owner)
        .map((row) => row.stale),
      [undefined],
      'with its feeder settled it runs the ordinary way and publishes clean',
    );
  });

  test('an intermediate aggregate waits for relevant input progress, then validates when inputs settle', async (assert) => {
    staleTotal();
    await (await candidate()).publish();
    const registry = publication.registry;
    const feeder = realm + 'Person/one.json';
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
       VALUES($1,$2,5,4,6,'epoch',FALSE)`,
      { bind: [realm, feeder] },
    );
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication}',
       '{"version":1,"state":"ready","definitionRevision":"epoch","outputRevision":5,"validatedThrough":4,"computedFields":[],"queryFields":[]}') WHERE url=$1`,
      { bind: [feeder] },
    );
    await db.execute(
      "UPDATE lattice_owners SET dirty_generation=6,stale_after=now()-interval '1 second' WHERE owner_url=$1",
      { bind: [owner] },
    );
    const readyOwner = async (overdueOnly = false) =>
      (await registry.ready(realm, { overdueOnly })).find(
        (row) => row.ownerURL === owner,
      );
    assert.true(
      (await readyOwner(true))?.stale,
      'a relevant input change enables the intermediate attempt',
    );
    await (
      await candidate('A', undefined, false, { stale: true, isolated: true })
    ).publish();
    assert.strictEqual(
      Number((await ownerRow()).dirty_generation),
      6,
      'waiting remains durable without becoming new work',
    );
    await db.execute(
      "UPDATE lattice_owners SET stale_after=now()-interval '1 second' WHERE owner_url=$1",
      { bind: [owner] },
    );
    assert.strictEqual(
      await readyOwner(),
      undefined,
      'the same unfinished inputs do not trigger another render',
    );
    assert.strictEqual(
      await readyOwner(true),
      undefined,
      'an expired deadline alone does not trigger a stale render',
    );
    assert.false(
      await registry.hasOverdue(realm),
      'queue admission agrees with the frontier',
    );

    // A new relevant change arrives after the captured input snapshot. Routing
    // multiple changes still leaves just one owner obligation.
    await db.execute(
      'UPDATE realm_generations SET current_generation=current_generation+1 WHERE realm_url=$1',
      { bind: [realm] },
    );
    const [{ current_generation: changedAt }] = await db.execute(
      'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
      { bind: [realm] },
    );
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      await registry.markDirty(tx!, realm, [owner, owner], Number(changedAt));
    });
    assert.true(
      (await readyOwner(true))?.stale,
      'new relevant input progress makes the same card runnable again',
    );
    const next = await candidate('A', undefined, false, {
      stale: true,
      isolated: true,
    });
    // Simulate another routed change during computation, with a publication
    // generation later still. Compare against the captured input generation,
    // never the eventual output generation, or this obligation would be lost.
    await db.execute(
      'UPDATE realm_generations SET current_generation=current_generation+1 WHERE realm_url=$1',
      { bind: [realm] },
    );
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      await registry.markDirty(tx!, realm, [owner], Number(changedAt) + 1);
    });
    await next.publish();
    assert.strictEqual(
      Number((await ownerRow()).dirty_generation),
      Number(changedAt) + 1,
      'a change during execution survives the later publication',
    );
    await db.execute(
      "UPDATE lattice_owners SET stale_after=now()-interval '1 second' WHERE owner_url=$1",
      { bind: [owner] },
    );
    assert.true(
      (await readyOwner(true))?.stale,
      'the unseen change retains one follow-up',
    );
    await (
      await candidate('A', undefined, false, { stale: true, isolated: true })
    ).publish();
    await db.execute(
      "UPDATE lattice_owners SET stale_after=now()-interval '1 second' WHERE owner_url=$1",
      { bind: [owner] },
    );
    assert.strictEqual(
      await readyOwner(),
      undefined,
      'the completed follow-up waits again without looping',
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
      { bind: [feeder] },
    );
    assert.strictEqual(
      (await readyOwner())?.ownerURL,
      owner,
      'settling unchanged dependencies releases final validation',
    );
    assert.strictEqual(
      (await readyOwner())?.stale,
      undefined,
      'final validation uses the ordinary freshness fence',
    );
    await (
      await candidate('A', undefined, false, { isolated: true })
    ).publish();
    assert.strictEqual(
      (await ownerRow()).dirty_generation,
      null,
      'the card becomes clean without inventing another change',
    );
  });

  test('a first native publication progresses during a source backlog and settles afterward', async (assert) => {
    await (await candidate('A', undefined, true)).publish();
    while (await publication.matchPending(realm, 'reader')) {
      // Register the discovery's first obligation before running its producer.
    }
    await db.execute(
      `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
       VALUES('incremental-index',$1,10,10,$2)`,
      { bind: ['indexing:' + realm, JSON.stringify({ realmURL: realm })] },
    );
    const openWork = (
      request: Parameters<typeof openLatticeNativeWork>[1],
      admission: Parameters<typeof openLatticeNativeWork>[2],
    ) => openLatticeNativeWork(db, request, admission);
    await assert.rejects(
      candidate('A', openWork),
      /new source work has priority/,
      'an ordinary attempt cannot silently promote itself',
    );
    const initial = await candidate('A', openWork, false, {
      stale: true,
      isolated: true,
    });
    await initial.publish();
    const [row] = await db.execute(
      `SELECT i.pristine_doc,o.dirty_generation FROM boxel_index i
       JOIN lattice_owners o ON o.realm_url=i.realm_url AND o.owner_url=i.url
       WHERE i.url=$1 AND i.type='instance'`,
      { bind: [owner] },
    );
    assert.strictEqual((row.pristine_doc as any).attributes.total, 5);
    assert.true((row.pristine_doc as any).meta.publication.stale);
    assert.notStrictEqual(
      row.dirty_generation,
      null,
      'the initial snapshot retains its obligation',
    );
    await db.execute(
      "UPDATE jobs SET status='resolved' WHERE concurrency_group=$1",
      {
        bind: ['indexing:' + realm],
      },
    );
    while (await publication.matchPending(realm, 'reader')) {
      // Route the first output before its final ordinary validation.
    }
    await (await candidate('A', openWork, false, { isolated: true })).publish();
    assert.deepEqual(await publication.registry.pending(realm), []);
  });

  test('pending source work and a newer obligation do not supersede a stale attempt', async (assert) => {
    staleTotal();
    await (await candidate()).publish();
    await db.execute(
      "UPDATE lattice_owners SET dirty_generation=7, stale_after = now() - interval '1 second' WHERE owner_url=$1",
      { bind: [owner] },
    );
    await db.execute(
      `INSERT INTO jobs (job_type, concurrency_group, timeout, priority, args, status)
       VALUES ('incremental-index', $1, 3600, 10, $2, 'unfulfilled')`,
      { bind: ['indexing:' + realm, JSON.stringify({ realmURL: realm })] },
    );
    const registry = new LatticeQueryRegistry(
      db,
      new IndexQueryEngine(db, lookup, network),
    );
    const work = {
      realmURL: realm,
      actor,
      claim: { id: owner, obligation: 6 },
      inputGeneration: 5,
      definitionRevision: 'epoch',
    };
    await assert.rejects(
      registry.assertWorkCurrent(work),
      /new source work has priority/,
      'an ordinary attempt yields',
    );
    await registry.assertWorkCurrent({
      ...work,
      claim: { ...work.claim, stale: true },
    });
    assert.ok(true, 'the stale attempt keeps going');
    await db.execute(
      'UPDATE lattice_owners SET stale_after = NULL WHERE owner_url=$1',
      { bind: [owner] },
    );
    await assert.rejects(
      registry.assertWorkCurrent({
        ...work,
        claim: { ...work.claim, stale: true },
      }),
      /new source work has priority/,
      'a stale claim the row no longer backs is an ordinary one',
    );
  });

  test('a stale publication keeps the obligation it could not cover', async (assert) => {
    staleTotal();
    await (await candidate()).publish();
    // Work newer than any snapshot this attempt reads has dirtied the owner.
    await db.execute(
      "UPDATE lattice_owners SET dirty_generation=7, stale_after = now() - interval '1 second' WHERE owner_url=$1",
      { bind: [owner] },
    );
    const before = await ownerRow();
    await (await candidate()).publish();
    const after = await ownerRow();
    assert.strictEqual(
      after.published_generation,
      before.published_generation,
      'an obsolete ordinary output is withheld',
    );
    assert.strictEqual(
      Number(after.dirty_generation),
      7,
      'its newer obligation is preserved',
    );
    const { result, publish } = await candidate('A', undefined, false, {
      stale: true,
    });
    assert.true(
      result.card.serialized!.data.meta.publication!.stale,
      'the receipt says so',
    );
    await publish();
    const row = await ownerRow();
    assert.notStrictEqual(row.dirty_generation, null, 'still obliged');
    assert.strictEqual(
      Number(row.dirty_generation),
      7,
      'retains the actual input change instead of manufacturing one at publication',
    );
    assert.true(
      row.deferred,
      'the next deadline is armed from this publication',
    );
  });

  // --- projection predicates: read a game's lines for one batter ---------
  test('a projection predicate keeps only the members that match, and the watch compares that slice', async (assert) => {
    const mine = { player: 'me', pa: 4 };
    const theirs = { player: 'them', pa: 3 };
    const card = { id: 'g1', lines: [mine, theirs], winner: 'NYA' };
    assert.deepEqual(
      applyLatticeProjectionWhere(card, { lines: { player: 'me' } }),
      { id: 'g1', lines: [mine], winner: 'NYA' },
      "the other batter's line never reaches the program",
    );
    assert.strictEqual(
      applyLatticeProjectionWhere(card, {
        lines: { player: 'me' },
        absent: { x: 1 },
      }).id,
      'g1',
      'a collection the card lacks is left alone',
    );
    assert.throws(
      () =>
        assertLatticeProjectionWhere({ lines: { player: { nested: true } } }),
      /predicate value/,
    );
    assert.throws(
      () => assertLatticeProjectionWhere({ __proto__: { player: 'me' } }),
      /Invalid Lattice projection/,
    );
    assert.throws(() => assertLatticeProjectionWhere({}), /predicate/);

    const doc = (lines: unknown[], extra: Record<string, unknown> = {}) =>
      ({
        url: realm + 'Game/one.json',
        search_doc: { id: realm + 'Game/one', lines, ...extra },
        types: [],
      }) as any;
    const where = { lines: { player: 'me' } };
    assert.false(
      latticeReadPathsChanged(
        ['lines.*'],
        doc([mine, theirs]),
        doc([mine, { player: 'them', pa: 5 }]),
        where,
      ),
      "another batter's line moving is not a change to this season",
    );
    assert.true(
      latticeReadPathsChanged(
        ['lines.*'],
        doc([mine, theirs]),
        doc([{ player: 'me', pa: 5 }, theirs]),
        where,
      ),
      "this batter's line moving is",
    );
    assert.true(
      latticeReadPathsChanged(
        ['lines.*'],
        doc([mine, theirs]),
        doc([theirs]),
        where,
      ),
      'and so is this batter leaving the box score',
    );
    assert.true(
      latticeReadPathsChanged(
        ['lines.*'],
        doc([mine, theirs]),
        doc([mine, { player: 'them', pa: 5 }]),
      ),
      'without a predicate a compound read stays conservative',
    );
    assert.true(
      latticeReadPathsChanged(
        ['lines.*', 'winner'],
        doc([mine], { winner: 'NYA' }),
        doc([mine], { winner: 'BOS' }),
        where,
      ),
      'a scalar the program also read is still compared',
    );
  });

  test('a watch published with a projection predicate dirties its owner only for its own slice', async (assert) => {
    await (await candidate()).publish();
    const registry = new LatticeQueryRegistry(
      db,
      new IndexQueryEngine(db, lookup, network),
    );
    // Give the members watch the predicate a season would carry.
    // Both the query watch and the identity watch carry it, as the indexer
    // publishes them when every root reading the collection agrees.
    await db.execute(
      `UPDATE lattice_query_watches SET read_paths=$2::jsonb, projection=$3::jsonb WHERE owner_url=$1`,
      {
        bind: [
          owner,
          JSON.stringify(['lines.*']),
          JSON.stringify({ lines: { player: 'me' } }),
        ],
      },
    );
    const url = realm + 'Record/one.json';
    const game = (lines: unknown[]) =>
      ({
        url,
        search_doc: {
          id: url.replace(/\.json$/, ''),
          amount: 1,
          group: 'A',
          lines,
        },
        types: [internalKeyFor(recordRef, undefined, network)],
      }) as LatticeDocument;
    const mine = { player: 'me', pa: 4 };
    assert.deepEqual(
      await registry.affected(
        realm,
        game([mine, { player: 'them', pa: 3 }]),
        game([mine, { player: 'them', pa: 4 }]),
      ),
      [],
      "a change to the other batter's line leaves the owner clean",
    );
    assert.deepEqual(
      await registry.affected(
        realm,
        game([mine, { player: 'them', pa: 3 }]),
        game([
          { player: 'me', pa: 5 },
          { player: 'them', pa: 3 },
        ]),
      ),
      [owner],
      "a change to this batter's line dirties it",
    );
  });

  async function addRecord(name: string, amount: number, group = 'A') {
    const url = new URL('Record/' + name + '.json', realm).href;
    await db.execute(
      "INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types) VALUES($1,$1,$2,'instance',5,FALSE,FALSE,$3,$4,$5)",
      {
        bind: [
          url,
          realm,
          JSON.stringify({
            id: url.replace(/\.json$/, ''),
            type: 'card',
            attributes: { amount, group },
            meta: { adoptsFrom: recordRef },
          }),
          JSON.stringify({
            id: url.replace(/\.json$/, ''),
            amount,
            group,
          }),
          JSON.stringify([internalKeyFor(recordRef, undefined, network)]),
        ],
      },
    );
    return url;
  }
  function recordDocument(url: string, amount: number, group = 'A') {
    return {
      url,
      search_doc: { id: url.replace(/\.json$/, ''), amount, group },
      types: [internalKeyFor(recordRef, undefined, network)],
    } as LatticeDocument;
  }
  function sortedTopOne() {
    root.fieldDefs.members.query = {
      filter: { eq: { group: '$this.group' } },
      sort: [{ by: 'amount', on: recordRef, direction: 'desc' }],
      page: { size: 1 },
    };
  }

  test('a sorted page publishes its key range as the watch', async (assert) => {
    sortedTopOne();
    await addRecord('three', 7);
    const { result, publish } = await candidate();
    assert.deepEqual(
      result.card.searchDoc!.chosenIds,
      [realm + 'Record/three'],
      'the owner reads only the page',
    );
    await publish();
    const [row] = await db.execute(
      'SELECT query FROM lattice_query_watches WHERE owner_url=$1 AND field_path=$2',
      { bind: [owner, 'members'] },
    );
    assert.deepEqual(
      (row.query as any).filter,
      {
        every: [
          { on: recordRef, eq: { group: 'A' } },
          { on: recordRef, range: { amount: { gte: 7 } } },
        ],
      },
      "the watch is the query's filter and the page's cutoff, inclusive of a tie",
    );
  });

  test('a row below the cutoff does not dirty the owner; one that can reach the page does', async (assert) => {
    sortedTopOne();
    const top = await addRecord('three', 7);
    await (await candidate()).publish();
    const registry = new LatticeQueryRegistry(
      db,
      new IndexQueryEngine(db, lookup, network),
    );
    const below = realm + 'Record/one.json';
    assert.deepEqual(
      await registry.affected(
        realm,
        recordDocument(below, 1),
        recordDocument(below, 2),
      ),
      [],
      'a row that stays under the cutoff cannot change the page',
    );
    assert.deepEqual(
      await registry.affected(
        realm,
        recordDocument(below, 1),
        recordDocument(below, 9),
      ),
      [owner],
      'a row that climbs past the cutoff can enter the page',
    );
    assert.deepEqual(
      await registry.affected(
        realm,
        recordDocument(top, 7),
        recordDocument(top, 3),
      ),
      [owner],
      'the page member itself invalidates however it moves',
    );
    assert.deepEqual(
      await registry.affected(realm, recordDocument(below, 1), undefined),
      [],
      'deleting a row under the cutoff leaves the page alone',
    );
  });

  test('a sorted page whose key has no value publishes an ungated watch', async (assert) => {
    // The sort key is null on the page's last row, so every other match ties
    // or beats it and no range excludes anything. The page is still the
    // owner's membership; the watch simply keeps invalidating on every match,
    // which costs recomputation and cannot miss a change.
    root.fieldDefs.members.query = {
      filter: { eq: { group: '$this.group' } },
      sort: [{ by: 'missing', on: recordRef, direction: 'desc' }],
      page: { size: 1 },
    };
    recordDefinition.fields.missing = 'missing';
    recordDefinition.fieldDefs.missing = number;
    await (await candidate()).publish();
    const [row] = await db.execute(
      'SELECT query, read_paths FROM lattice_query_watches WHERE owner_url=$1 AND field_path=$2',
      { bind: [owner, 'members'] },
    );
    assert.deepEqual((row.query as any).filter, {
      on: recordRef,
      eq: { group: 'A' },
    });
  });

  test('the sort key of a paged input counts as read', async (assert) => {
    // Read-path detection must not skip a page member whose sort key moved:
    // the fields the program looked at can all be unchanged and the page
    // still be a different set of rows.
    sortedTopOne();
    await addRecord('three', 7);
    await (await candidate()).publish();
    const [row] = await db.execute(
      'SELECT read_paths FROM lattice_query_watches WHERE owner_url=$1 AND field_path=$2',
      { bind: [owner, 'members'] },
    );
    assert.true(
      (row.read_paths as string[]).includes('amount'),
      `the sort key is in the watch's read paths: ${JSON.stringify(row.read_paths)}`,
    );
  });

  test('a foreign query realm is not silently replaced by the owner realm', async (assert) => {
    root.fieldDefs.members.query!.realms = ['https://another-realm.example/'];
    await assert.rejects(candidate(), /must stay in its authorized realm/);
  });

  test('a queued source change does not discard a valid completed publication', async (assert) => {
    const { publish } = await candidate();
    await db.execute(
      `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
      VALUES('incremental-index',$1,10,10,'{}')`,
      { bind: ['indexing:' + realm] },
    );
    await publish();
    const [row] = await db.execute(
      "SELECT pristine_doc->'attributes'->>'total' AS total FROM boxel_index WHERE url=$1",
      { bind: [owner] },
    );
    assert.strictEqual(
      Number(row.total),
      5,
      'the captured complete value publishes',
    );
    assert.strictEqual(
      (
        await db.execute(
          "SELECT id FROM jobs WHERE job_type='incremental-index' AND status='unfulfilled'",
        )
      ).length,
      1,
      'the queued source work remains to index and route its later changes',
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

  for (const queueSource of [false, true])
    test(`bounded native waves preserve completed owners with queued source=${queueSource}`, async (assert) => {
      assert.timeout(30_000);
      const owners = Array.from(
        { length: 9 },
        (_, i) => realm + `Dashboard/budget-${i}.json`,
      );
      for (const ownerURL of owners) {
        await (await candidate('A', undefined, false, { ownerURL })).publish();
      }
      while (await publication.matchPending(realm, 'reader')) {
        /* settle fixture routing */
      }
      await db.execute(
        "UPDATE jobs SET status='resolved',finished_at=now() WHERE status='unfulfilled'",
      );
      await db.execute(
        `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','6'),search_doc=jsonb_set(search_doc,'{amount}','6') WHERE url=$1`,
        { bind: [realm + 'Person/one.json'] },
      );
      await db.execute(
        'UPDATE lattice_owners SET dirty_generation=(SELECT current_generation FROM realm_generations WHERE realm_url=$1) WHERE realm_url=$1',
        { bind: [realm] },
      );
      const unexpected = async (): Promise<never> => {
        throw new Error('Unexpected Chrome/module execution');
      };
      const prerenderer: Prerenderer = {
        prerenderModule: unexpected,
        prerenderVisit: unexpected,
        runCommand: unexpected,
      };
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
      let sourceQueued = false;
      const native = createIndexer((request, admission) =>
        openLatticeNativeWork(db, request, admission),
      );
      const run = (wave: number) =>
        IndexRunner.materialize(
          new IndexRunner({
            realmURL: new URL(realm),
            indexWriter: writer,
            definitionLookup,
            virtualNetwork: network,
            nativeCardIndexer: async (request) => {
              const result = await native(request);
              if (queueSource && !sourceQueued) {
                sourceQueued = true;
                await db.execute(
                  `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
                 VALUES('incremental-index',$1,10,10,$2)`,
                  {
                    bind: [
                      'indexing:' + realm,
                      JSON.stringify({ realmURL: realm }),
                    ],
                  },
                );
              }
              return result;
            },
            prerenderer,
            auth: '',
            fetch: unexpected,
            realmOwnerUserId: actor,
            reader: {
              readFile: async (url) => ({
                content,
                path: url.pathname,
                lastModified: 1,
                created: 1,
              }),
              readStream: unexpected,
              mtimes: unexpected,
            },
          }),
          'reader',
          wave,
        );
      const first = await run(0);
      const completed = first.phaseTimings.latticeOwnersRendered;
      assert.true(completed > 0, 'the first wave made progress');
      assert.true(
        completed <= 8,
        `published ${completed} owners within the wave cap`,
      );
      const remaining = async () =>
        (await publication.registry.pending(realm)).length;
      assert.strictEqual(
        await remaining(),
        owners.length - completed,
        'unstarted owners retain their obligations',
      );
      assert.true(
        (
          await db.execute(
            "SELECT id FROM jobs WHERE status='unfulfilled' AND job_type='lattice-materialize'",
          )
        ).length > 0,
        'publication committed a durable successor',
      );
      if (queueSource) {
        assert.true(
          sourceQueued,
          'new source arrived after native computation',
        );
        assert.true(
          (await remaining()) > 0,
          'the wave stopped admitting owners',
        );
        assert.strictEqual(
          first.superseded,
          undefined,
          'completed work was not discarded',
        );
        await db.execute(
          "UPDATE jobs SET status='resolved',finished_at=now() WHERE job_type='incremental-index' AND concurrency_group=$1",
          { bind: ['indexing:' + realm] },
        );
      }
      for (let wave = 1; wave <= 20 && (await remaining()); wave++)
        await run(wave);
      assert.strictEqual(
        await remaining(),
        0,
        'successor waves settle every owner',
      );
      const rows = await db.execute(
        "SELECT pristine_doc->'attributes'->>'total' AS total FROM boxel_index WHERE url = ANY($1::text[])",
        { bind: ['{' + owners.join(',') + '}'] },
      );
      assert.deepEqual(
        rows.map((row) => Number(row.total)),
        owners.map(() => 6),
        'all outputs use the changed input; no partial value was published',
      );
      assert.strictEqual(
        (await db.execute('SELECT owner_url FROM lattice_work_failures'))
          .length,
        0,
      );
    });

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
