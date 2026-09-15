import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  baseRealmRRI,
  isResolvedCodeRef,
  type CodeRef,
  type DefinitionLookup,
  type Filter,
  type PgPrimitive,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  LatticeQueryRegistry,
  type LatticeDocument,
} from '@cardstack/runtime-common/lattice-query-registry';
import { setupDB } from './helpers/index.ts';
import {
  CLINICAL_OWNER_TYPES,
  CLINICAL_SCENARIOS,
  applyWrites,
  changedOwners,
  clinicalDefinitions,
  clinicalDependencies,
  clinicalModuleRef,
  clinicalSearchDoc,
  clinicalTypeOf,
  clinicalWatches,
  expectedOwners,
  generateClinical,
  type ClinicalRecords,
  type ClinicalScenario,
} from './helpers/lattice-clinical-fixture.ts';

const { module, test } = QUnit;
const realmURL = 'https://clinical-routing.example/';
const definitions = clinicalDefinitions(realmURL);
const typeKey = (ref: ResolvedCodeRef) => `${ref.module}/${ref.name}`;

// This layer drives the real Postgres reverse-query registry with the clinical
// catalog and no browser. For each scenario it replays the invalidation the
// kernel would perform: every changed document is routed through the
// registered watches, an owner whose oracle output changes becomes a changed
// document for the next wave, and an owner whose output is unchanged is cut
// off. The resulting routed set must cover every owner the oracle says
// changes, must never include an owner the scenario declares unrelated, and
// may exceed the changed set only by the owners the scenario declares as
// cutoff cases. Routing precision is what keeps a ward write from refreshing
// every board in the facility.
module('Lattice | clinical reverse-query routing', function (hooks) {
  let db: PgAdapter;
  let engine: IndexQueryEngine;
  let registry: LatticeQueryRegistry;
  let network: VirtualNetwork;
  const lookup = {
    forRealm() {
      return this;
    },
    async lookupDefinition(ref: CodeRef) {
      if (!isResolvedCodeRef(ref))
        throw new Error('The clinical fixture only resolves exported types');
      const definition = definitions.get(ref.name);
      if (!definition)
        throw new Error(
          `The clinical fixture has no definition for ${ref.name}`,
        );
      return definition;
    },
  } as unknown as DefinitionLookup;

  setupDB(hooks, {
    templateDatabase: process.env.LATTICE_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
      network = new VirtualNetwork();
      network.addRealmMapping(baseRealmRRI, 'https://cardstack.com/base/');
      engine = new IndexQueryEngine(db, lookup, network);
      registry = new LatticeQueryRegistry(db, engine);
    },
  });

  function ownersOf(records: ClinicalRecords): string[] {
    return [...records.keys()].filter((path) =>
      CLINICAL_OWNER_TYPES.includes(clinicalTypeOf(records, path)),
    );
  }

  async function registerOwners(records: ClinicalRecords): Promise<void> {
    await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
      for (const path of ownersOf(records)) {
        const watches = await registry.prepare(
          clinicalWatches(realmURL, records, path),
        );
        await registry.publish(tx!, {
          realmURL,
          ownerURL: realmURL + path,
          generation: 1,
          inputGeneration: 1,
          definitionRevision: 'clinical-v1',
          watches,
        });
      }
    });
  }

  function documentFor(
    records: ClinicalRecords,
    path: string,
  ): LatticeDocument | undefined {
    if (!records.has(path)) return undefined;
    return {
      url: realmURL + path,
      types: [
        typeKey(clinicalModuleRef(realmURL, clinicalTypeOf(records, path))),
      ],
      search_doc: clinicalSearchDoc(realmURL, records, path) as Record<
        string,
        PgPrimitive
      >,
    };
  }

  interface Replay {
    routed: Set<string>;
    waves: string[][];
  }

  // Replays kernel invalidation for one scenario against the live registry.
  async function replay(
    before: ClinicalRecords,
    after: ClinicalRecords,
    written: string[],
  ): Promise<Replay> {
    const beforeOwners = expectedOwners(before);
    const afterOwners = expectedOwners(after);
    const changedOutput = (path: string) =>
      JSON.stringify(beforeOwners.get(path)) !==
      JSON.stringify(afterOwners.get(path));
    const routed = new Set<string>();
    const waves: string[][] = [];
    const visited = new Set<string>();
    // A written owner recomputes because its own source changed, not because
    // a watch routed to it. Seed the replay with it as a changed document.
    let frontier = [...written];
    for (const path of written)
      if (afterOwners.has(path) || beforeOwners.has(path)) routed.add(path);
    while (frontier.length) {
      const next: string[] = [];
      for (const path of frontier) {
        if (visited.has(path)) continue;
        visited.add(path);
        const owners = (
          await registry.affected(
            realmURL,
            documentFor(before, path),
            documentFor(after, path),
          )
        ).map((ownerURL) => ownerURL.slice(realmURL.length));
        // Concrete dependencies: the writer invalidates an owner whose deps
        // name the changed URL. The registry covers membership only.
        for (const ownerPath of ownersOf(after))
          if (clinicalDependencies(after, ownerPath).includes(path))
            owners.push(ownerPath);
        for (const ownerPath of owners) {
          routed.add(ownerPath);
          if (changedOutput(ownerPath)) next.push(ownerPath);
        }
      }
      waves.push(next.sort());
      frontier = next;
    }
    return { routed, waves };
  }

  test('every clinical watch yields exact routing terms rather than a broad type scan', async function (assert) {
    const { records } = generateClinical({ realmURL });
    const seen = new Set<string>();
    for (const path of ownersOf(records)) {
      for (const watch of clinicalWatches(realmURL, records, path)) {
        const label = `${clinicalTypeOf(records, path)}.${watch.fieldPath}`;
        if (seen.has(label)) continue;
        seen.add(label);
        const terms = await engine.reverseRoutingTerms(watch.query.filter);
        const hasTerms = terms !== undefined && terms.length > 0;
        assert.true(
          hasTerms,
          `${label} routes on typed equality terms: ${JSON.stringify(terms)}`,
        );
      }
    }
    assert.strictEqual(
      seen.size,
      7,
      'the clinical schema declares seven distinct query fields',
    );
  });

  test('exact verification agrees with the oracle membership predicate for every scenario document', async function (assert) {
    const { records, ids } = generateClinical({ realmURL });
    let checks = 0;
    for (const scenario of CLINICAL_SCENARIOS) {
      const after = applyWrites(records, scenario.writes(ids, records));
      for (const write of scenario.writes(ids, records)) {
        for (const state of [records, after]) {
          const document = documentFor(state, write.path);
          if (!document) continue;
          for (const ownerPath of ownersOf(state)) {
            for (const watch of clinicalWatches(realmURL, state, ownerPath)) {
              const filter = watch.query.filter as Filter & {
                on: ResolvedCodeRef;
                eq: Record<string, unknown>;
              };
              if (typeKey(filter.on) !== document.types?.[0]) continue;
              const expected = Object.entries(filter.eq).every(
                ([field, value]) =>
                  (document.search_doc as any)[field] === value,
              );
              const actual = await engine.reverseMatchesDocument(
                filter,
                document,
              );
              checks++;
              if (actual !== expected)
                assert.strictEqual(
                  actual,
                  expected,
                  `${scenario.key}: ${write.path} against ${ownerPath}.${watch.fieldPath} ${JSON.stringify(filter.eq)}`,
                );
            }
          }
        }
      }
    }
    assert.true(
      checks > 100,
      `SQL verification agreed with the oracle on ${checks} document/watch pairs`,
    );
  });

  for (const scenario of CLINICAL_SCENARIOS) {
    test(`${scenario.key}: ${scenario.title}`, async function (assert) {
      const { records, ids } = generateClinical({ realmURL });
      await registerOwners(records);
      const writes = scenario.writes(ids, records);
      const after = applyWrites(records, writes);
      const affected = changedOwners(
        expectedOwners(records),
        expectedOwners(after),
      );
      const { routed, waves } = await replay(
        records,
        after,
        writes.map((write) => write.path),
      );
      for (const path of affected)
        assert.true(
          routed.has(path),
          `${path} changes in the oracle and is reached by routing (waves: ${JSON.stringify(waves)})`,
        );
      for (const path of scenario.unaffected?.(ids) ?? [])
        assert.false(
          routed.has(path),
          `${path} is declared unrelated and is never routed`,
        );
      const cutoff = new Set(scenario.cutoff?.(ids) ?? []);
      const affectedSet = new Set(affected);
      for (const path of routed) {
        const explained = affectedSet.has(path) || cutoff.has(path);
        assert.true(
          explained,
          `${path} was routed; it either changes or is a declared cutoff case`,
        );
      }
      for (const path of cutoff)
        assert.true(
          routed.has(path),
          `${path} is declared a cutoff case, so routing must reach it even though its output is unchanged`,
        );
      assert.true(
        waves.length <= 4,
        `propagation settled in ${waves.length} waves through the three-level chain`,
      );
    });
  }

  test('a scenario replayed twice in sequence keeps the registry consistent with the oracle', async function (assert) {
    const { records, ids } = generateClinical({ realmURL });
    await registerOwners(records);
    const [first, second] = [
      CLINICAL_SCENARIOS.find((s) => s.key === 'vitals-turn-critical')!,
      CLINICAL_SCENARIOS.find((s) => s.key === 'discharge')!,
    ] as ClinicalScenario[];
    const afterFirst = applyWrites(records, first.writes(ids, records));
    const afterSecond = applyWrites(afterFirst, second.writes(ids, afterFirst));
    const { routed } = await replay(
      afterFirst,
      afterSecond,
      second.writes(ids, afterFirst).map((write) => write.path),
    );
    for (const path of changedOwners(
      expectedOwners(afterFirst),
      expectedOwners(afterSecond),
    ))
      assert.true(
        routed.has(path),
        `${path} is reached after an earlier unrelated change`,
      );
    assert.false(
      routed.has(ids.board('cardiology', ids.dates[0]) + '.json'),
      'the cardiology board is untouched by an ICU discharge',
    );
  });
});
