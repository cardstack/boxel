import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  isResolvedCodeRef,
  type CodeRef,
  type DefinitionLookup,
  type Query,
} from '@cardstack/runtime-common';
import { latticeWorkFrontier } from '@cardstack/runtime-common/lattice-kernel';
import { LatticeQueryRegistry } from '@cardstack/runtime-common/lattice-query-registry';
import { setupDB } from './helpers/index.ts';
import {
  clinicalDefinitions,
  clinicalModuleRef,
  type ClinicalType,
} from './helpers/lattice-clinical-fixture.ts';

const { module, test } = QUnit;

module('lattice-work-frontier-test.ts | portable', function () {
  const node = (id: string, pendingInputs: string[] = [], runnable = true) => ({
    id,
    pendingInputs,
    runnable,
  });
  test('readiness does not depend on identity order or speculate that queued inputs completed', (assert) => {
    assert.deepEqual(
      latticeWorkFrontier([node('a', ['b']), node('b', ['z']), node('z')]),
      { ready: ['z'], cycle: [] },
    );
    assert.deepEqual(
      latticeWorkFrontier([node('a', ['b']), node('b')]),
      { ready: ['b'], cycle: [] },
      'the adapter supplies the new graph after publication',
    );
  });
  test('unknown and code-blocked inputs stay blocked without being called cycles', (assert) => {
    assert.deepEqual(
      latticeWorkFrontier([
        node('a', ['missing']),
        node('b', ['c']),
        node('c', [], false),
      ]),
      { ready: [], cycle: [] },
    );
    assert.deepEqual(
      latticeWorkFrontier([node('a', ['b']), node('b', ['a'], false)]),
      { ready: [], cycle: [] },
      'dirty code can replace its old dependencies',
    );
  });
  test('independent work progresses before a cycle is reported, including a self-cycle', (assert) => {
    assert.deepEqual(
      latticeWorkFrontier([node('a', ['b']), node('b', ['a']), node('z')]),
      { ready: ['z'], cycle: [] },
    );
    assert.deepEqual(
      latticeWorkFrontier([node('a', ['b']), node('b', ['a'])]),
      { ready: [], cycle: ['a', 'b', 'a'] },
    );
    assert.deepEqual(latticeWorkFrontier([node('a', ['a'])]), {
      ready: [],
      cycle: ['a', 'a'],
    });
  });

  test('a deep blocked graph is diagnosed without recursion', (assert) => {
    const work = Array.from({ length: 12_000 }, (_, i) =>
      node(String(i), [String((i + 1) % 12_000)]),
    );
    const result = latticeWorkFrontier(work);
    assert.deepEqual(result.ready, []);
    assert.strictEqual(result.cycle.length, 12_001);
    assert.strictEqual(result.cycle[0], result.cycle.at(-1));
  });
});

const realm = 'https://lattice-frontier.example/';
module('lattice-work-frontier-test.ts | postgres', function (hooks) {
  let db: PgAdapter;
  let registry: LatticeQueryRegistry;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      const definitions = clinicalDefinitions(realm);
      const lookup = {
        async lookupDefinition(ref: CodeRef) {
          if (!isResolvedCodeRef(ref)) throw new Error('Exported types only');
          return definitions.get(ref.name);
        },
      } as unknown as DefinitionLookup;
      registry = new LatticeQueryRegistry(
        db,
        new IndexQueryEngine(db, lookup, new VirtualNetwork()),
      );
    },
  });

  async function owner(
    name: string,
    type: ClinicalType,
    opts: {
      deps?: string[];
      query?: Query;
      realmURL?: string;
      fieldPath?: string;
    } = {},
  ) {
    const realmURL = opts.realmURL ?? realm;
    const url = realmURL + name + '.json';
    await db.execute(
      `INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,types,deps,search_doc)
       VALUES($1,$2,$3,'instance',1,$4,$5,$6)`,
      {
        bind: [
          url,
          url.slice(0, -5),
          realmURL,
          JSON.stringify([`${realmURL}cards/${type}`]),
          JSON.stringify(opts.deps ?? []),
          JSON.stringify({ critical: false }),
        ],
      },
    );
    await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
      await registry.publish(tx!, {
        realmURL,
        ownerURL: url,
        generation: 2,
        inputGeneration: 1,
        definitionRevision: 'test',
        pending: true,
        watches: opts.query
          ? [
              {
                fieldPath: opts.fieldPath ?? 'inputs',
                query: opts.query,
                terms: [],
              },
            ]
          : [],
      });
    });
    return url;
  }

  test('query type readiness includes stale nonmatches; concrete aliases order the next level', async (assert) => {
    const census = await owner('A-census', 'FacilityCensus', {
      deps: [realm + 'B-board'],
    });
    const board = await owner('B-board', 'WardBoard', {
      query: {
        filter: {
          on: clinicalModuleRef(realm, 'PatientDaySummary'),
          eq: { critical: true },
        },
      },
    });
    const summary = await owner('Z-summary', 'PatientDaySummary');
    assert.deepEqual(await registry.ready(realm), [
      { ownerURL: summary, generation: 2 },
    ]);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
      { bind: [summary] },
    );
    assert.deepEqual(await registry.ready(realm), [
      { ownerURL: board, generation: 2 },
    ]);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
      { bind: [board] },
    );
    assert.deepEqual(await registry.ready(realm), [
      { ownerURL: census, generation: 2 },
    ]);
  });

  test('code-blocked owners retain downstream obligations without hiding independent work', async (assert) => {
    const input = await owner('Z-input', 'PatientDaySummary');
    await owner('A-parent', 'WardBoard', { deps: [input] });
    const independent = await owner('B-independent', 'FacilityCensus');
    const fileURL = realm + 'cards.gts';
    await db.execute(
      `INSERT INTO lattice_code_artifacts(realm_url,file_url,realm_username) VALUES($1,$2,'test')`,
      { bind: [realm, fileURL] },
    );
    await db.execute(
      `INSERT INTO lattice_owner_code(realm_url,owner_url,generation,reference) VALUES($1,$2,2,$3)`,
      { bind: [realm, input, JSON.stringify({ fileURL })] },
    );
    assert.deepEqual(await registry.ready(realm), [
      { ownerURL: independent, generation: 2 },
    ]);
    assert.strictEqual(
      (await registry.pending(realm)).length,
      3,
      'planning never clears durable work',
    );
    await db.execute('UPDATE lattice_code_artifacts SET dirty=FALSE');
    assert.deepEqual(
      (await registry.ready(realm)).map((row) => row.ownerURL),
      [independent, input],
    );
  });

  test('a missing type blocks query readiness, and another realm cannot block local work', async (assert) => {
    const parent = await owner('A-parent', 'WardBoard', {
      query: {
        filter: { type: clinicalModuleRef(realm, 'PatientDaySummary') },
      },
    });
    const unknown = await owner('Z-unknown', 'PatientDaySummary');
    await db.execute('DELETE FROM boxel_index WHERE url=$1', {
      bind: [unknown],
    });
    const foreign = await owner('Z-foreign', 'PatientDaySummary', {
      realmURL: 'https://other.example/',
    });
    await db.execute('UPDATE boxel_index SET types=$1 WHERE url=$2', {
      bind: [JSON.stringify([`${realm}cards/PatientDaySummary`]), foreign],
    });
    assert.deepEqual(await registry.ready(realm), [
      { ownerURL: unknown, generation: 2 },
    ]);
    await db.execute(
      'UPDATE lattice_owners SET retired=TRUE WHERE owner_url=$1',
      { bind: [unknown] },
    );
    assert.deepEqual(await registry.ready(realm), [
      { ownerURL: parent, generation: 2 },
    ]);
  });

  test('cycles fail explicitly without discarding obligations', async (assert) => {
    const a = await owner('A', 'WardBoard', { deps: [realm + 'B.json'] });
    const b = await owner('B', 'FacilityCensus', { deps: [a] });
    await assert.rejects(
      registry.ready(realm),
      /Lattice work dependency cycle/,
    );
    assert.deepEqual(await registry.pending(realm), [
      { ownerURL: a, generation: 2 },
      { ownerURL: b, generation: 2 },
    ]);
  });

  test('query-backed cycles are diagnosed before allocating a producer', async (assert) => {
    await owner('A', 'WardBoard', {
      query: { filter: { type: clinicalModuleRef(realm, 'FacilityCensus') } },
    });
    await owner('B', 'FacilityCensus', {
      query: { filter: { type: clinicalModuleRef(realm, 'WardBoard') } },
    });
    await assert.rejects(
      registry.ready(realm),
      /Lattice work dependency cycle/,
    );
    assert.strictEqual((await registry.pending(realm)).length, 2);
  });

  test('a native concrete-input watch waits for its actual identities without inventing a self-cycle', async (assert) => {
    const input = await owner('Z-input', 'PatientDaySummary');
    const parent = await owner('A-parent', 'WardBoard', {
      fieldPath: '@lattice/inputs',
      query: { filter: { in: { id: [input.slice(0, -5)] } } },
    });
    assert.deepEqual(await registry.ready(realm), [
      { ownerURL: input, generation: 2 },
    ]);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
      { bind: [input] },
    );
    assert.deepEqual(await registry.ready(realm), [
      { ownerURL: parent, generation: 2 },
    ]);
  });
});
