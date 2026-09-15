import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  baseRealmRRI,
  isResolvedCodeRef,
  type CodeRef,
  type DefinitionLookup,
  type PgPrimitive,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  LatticeQueryRegistry,
  type LatticeDocument,
} from '@cardstack/runtime-common/lattice-query-registry';
import { setupDB } from './helpers/index.ts';
import {
  adversarialDefinitions,
  adversarialModuleRef,
  adversarialSearchDoc,
  adversarialTypeOf,
  adversarialWatches,
  applyAdversarialWrites,
  expectedOwner,
  generateAdversarial,
  type AdversarialRecords,
} from './helpers/lattice-adversarial-fixture.ts';

const { module, test } = QUnit;
const realmURL = 'https://adversarial-routing.example/';
const DEPTH = 6;
const definitions = adversarialDefinitions(realmURL, DEPTH);
const typeKey = (ref: ResolvedCodeRef) => `${ref.module}/${ref.name}`;

// Registry layer: the real Postgres reverse-query registry under adversarial
// load and shape, with no browser. Fan-out to hundreds of owners, a chain six
// tiers deep, a cycle between owners, filters that have no routing key, a
// feeder that flaps hundreds of times, cross-realm watches, and keys that
// differ only in Unicode normalisation. Every claim is a routing set or a
// refusal; timings are logged as LATTICE_ADVERSARIAL lines for the catalog.
module('Lattice | adversarial reverse-query routing', function (hooks) {
  let db: PgAdapter;
  let engine: IndexQueryEngine;
  let registry: LatticeQueryRegistry;
  const lookup = {
    forRealm() {
      return this;
    },
    async lookupDefinition(ref: CodeRef) {
      if (!isResolvedCodeRef(ref))
        throw new Error('The adversarial fixture only resolves exported types');
      const definition = definitions.get(ref.name);
      if (!definition)
        throw new Error(`No adversarial definition for ${ref.name}`);
      return definition;
    },
  } as unknown as DefinitionLookup;

  setupDB(hooks, {
    templateDatabase: process.env.LATTICE_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
      const network = new VirtualNetwork();
      network.addRealmMapping(baseRealmRRI, 'https://cardstack.com/base/');
      engine = new IndexQueryEngine(db, lookup, network);
      registry = new LatticeQueryRegistry(db, engine);
    },
  });

  async function register(
    records: AdversarialRecords,
    paths: string[],
  ): Promise<void> {
    await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
      for (const path of paths) {
        const watches = await registry.prepare(
          adversarialWatches(realmURL, records, path),
        );
        await registry.publish(tx!, {
          realmURL,
          ownerURL: realmURL + path,
          generation: 1,
          inputGeneration: 1,
          definitionRevision: 'adversarial-v1',
          watches,
        });
      }
    });
  }

  function documentFor(
    records: AdversarialRecords,
    path: string,
  ): LatticeDocument | undefined {
    if (!records.has(path)) return undefined;
    return {
      url: realmURL + path,
      types: [
        typeKey(
          adversarialModuleRef(realmURL, adversarialTypeOf(records, path)),
        ),
      ],
      search_doc: adversarialSearchDoc(realmURL, records, path) as Record<
        string,
        PgPrimitive
      >,
    };
  }

  const strip = (urls: string[]) =>
    urls.map((url) => url.slice(realmURL.length)).sort();

  test('a notice to one audience routes to every subscriber exactly once and to nobody else', async function (assert) {
    const subscribers = 400;
    const { records, ids } = generateAdversarial({ realmURL, subscribers });
    const others = generateAdversarial({
      realmURL,
      subscribers: 5,
      seed: 99,
    });
    // Five subscribers to a different audience share the registry.
    const otherRecords: AdversarialRecords = new Map(
      [...others.records]
        .filter(([path]) => path.startsWith('Own/seat-'))
        .map(([path, doc]) => {
          const copy = structuredClone(doc);
          copy.data.attributes.audience = 'staff';
          return [path.replace('Own/seat-', 'Own/staff-'), copy];
        }),
    );
    const all: AdversarialRecords = new Map([...records, ...otherRecords]);
    const started = performance.now();
    await register(all, [...ids.subscribers, ...otherRecords.keys()]);
    const registerMs = Math.round(performance.now() - started);
    const notice = {
      op: 'POST' as const,
      path: 'Notice/n-00002.json',
      document: {
        data: {
          type: 'card' as const,
          attributes: { audience: ids.audience, body: 'assembly moved' },
          meta: { adoptsFrom: adversarialModuleRef(realmURL, 'Notice') },
        },
      },
    };
    const after = applyAdversarialWrites(all, [notice]);
    const routeStart = performance.now();
    const routed = strip(
      await registry.affected(
        realmURL,
        undefined,
        documentFor(after, notice.path),
      ),
    );
    const routeMs = Math.round(performance.now() - routeStart);
    console.log(
      `LATTICE_ADVERSARIAL fan-out: ${subscribers + 5} owners registered in ${registerMs} ms; one notice routed to ${routed.length} in ${routeMs} ms`,
    );
    assert.deepEqual(
      routed,
      strip(ids.subscribers.map((path) => realmURL + path)),
      `all ${subscribers} subscribers route exactly once and the five staff seats do not`,
    );
    const staffNotice = structuredClone(notice);
    staffNotice.path = 'Notice/n-00003.json';
    staffNotice.document.data.attributes.audience = 'staff';
    const staffAfter = applyAdversarialWrites(all, [staffNotice]);
    assert.strictEqual(
      (
        await registry.affected(
          realmURL,
          undefined,
          documentFor(staffAfter, staffNotice.path),
        )
      ).length,
      5,
      'a staff notice routes to the five staff seats only',
    );
  });

  test('a leaf change climbs a six-tier chain one tier per wave and never crosses chains', async function (assert) {
    const { records, ids } = generateAdversarial({
      realmURL,
      depth: DEPTH,
      chains: 3,
      subscribers: 1,
    });
    const tierPaths = ids.chains.flatMap((chain) => ids.tiers[chain]);
    await register(records, tierPaths);
    const leaf = ids.leaves[ids.chains[1]][0];
    const after = applyAdversarialWrites(records, [
      { op: 'PATCH', path: leaf, attributes: { value: 5000 } },
    ]);
    const before = new Map(
      tierPaths.map((path) => [
        path,
        JSON.stringify(expectedOwner(records, path)),
      ]),
    );
    const changed = (path: string) =>
      before.get(path) !== JSON.stringify(expectedOwner(after, path));
    const waves: string[][] = [];
    const routed = new Set<string>();
    let frontier = [leaf];
    const visited = new Set<string>();
    while (frontier.length) {
      const next: string[] = [];
      for (const path of frontier) {
        if (visited.has(path)) continue;
        visited.add(path);
        const owners = strip(
          await registry.affected(
            realmURL,
            documentFor(records, path),
            documentFor(after, path),
          ),
        );
        for (const owner of owners) {
          routed.add(owner);
          if (changed(owner)) next.push(owner);
        }
      }
      waves.push(next.sort());
      frontier = next;
    }
    assert.strictEqual(
      waves.filter((wave) => wave.length).length,
      DEPTH,
      `the change climbs exactly ${DEPTH} waves`,
    );
    assert.deepEqual(
      [...routed].sort(),
      strip(ids.tiers[ids.chains[1]].map((path) => realmURL + path)),
      'every tier of the written chain is routed and no tier of another chain is',
    );
    assert.deepEqual(
      waves.slice(0, DEPTH).map((wave) => wave.length),
      Array(DEPTH).fill(1),
      'each wave carries exactly one owner: the next tier up',
    );
  });

  test('a cycle between two owners routes each to the other, so the kernel must break it, not the registry', async function (assert) {
    const { records, ids } = generateAdversarial({ realmURL, subscribers: 1 });
    await register(records, [ids.cycleA, ids.cycleB]);
    const fromA = strip(
      await registry.affected(realmURL, documentFor(records, ids.cycleA), {
        ...documentFor(records, ids.cycleA)!,
        search_doc: {
          ...documentFor(records, ids.cycleA)!.search_doc,
          count: 2,
        },
      }),
    );
    const fromB = strip(
      await registry.affected(realmURL, documentFor(records, ids.cycleB), {
        ...documentFor(records, ids.cycleB)!,
        search_doc: {
          ...documentFor(records, ids.cycleB)!.search_doc,
          count: 2,
        },
      }),
    );
    assert.deepEqual(fromA, [ids.cycleB], 'a republished A routes to B');
    assert.deepEqual(fromB, [ids.cycleA], 'a republished B routes to A');
    // A replay with a visited set terminates; the registry alone cannot tell
    // the drain that this pair will never settle. That detection is S2's.
    const visited = new Set<string>();
    let frontier = [ids.cycleA];
    let hops = 0;
    while (frontier.length && hops < 10) {
      const next: string[] = [];
      for (const path of frontier) {
        if (visited.has(path)) continue;
        visited.add(path);
        next.push(
          ...strip(
            await registry.affected(
              realmURL,
              documentFor(records, path),
              documentFor(records, path),
            ),
          ),
        );
      }
      frontier = next;
      hops++;
    }
    assert.true(
      hops < 10,
      `a visited set terminates the cycle in ${hops} hops`,
    );
  });

  test('a filter with no routing key falls back to a type scan and still verifies exactly', async function (assert) {
    const { records, ids } = generateAdversarial({
      realmURL,
      subscribers: 1,
      manyEntries: 30,
    });
    const entry = adversarialModuleRef(realmURL, 'Entry');
    const noKey = await engine.reverseRoutingTerms({
      on: entry,
      contains: { text: 'text 3' },
    });
    console.log(
      `LATTICE_ADVERSARIAL routing terms for contains: ${JSON.stringify(noKey)}`,
    );
    const typeOnly = await engine.reverseRoutingTerms({ type: entry });
    console.log(
      `LATTICE_ADVERSARIAL routing terms for a bare type filter: ${JSON.stringify(typeOnly)}`,
    );
    // Register an owner whose query is the inefficient one, then route every
    // entry through it and compare with the oracle predicate.
    const inefficient: AdversarialRecords = new Map(records);
    const ownerPath = 'Own/contains.json';
    inefficient.set(ownerPath, {
      data: {
        type: 'card',
        attributes: { bucket: ids.manyBucket },
        meta: { adoptsFrom: adversarialModuleRef(realmURL, 'BucketCount') },
      },
    });
    await db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
      const watches = await registry.prepare([
        {
          fieldPath: 'entries',
          query: {
            filter: { on: entry, contains: { text: 'text 3' } },
            page: { size: 50 },
          },
        },
      ]);
      await registry.publish(tx!, {
        realmURL,
        ownerURL: realmURL + ownerPath,
        generation: 1,
        inputGeneration: 1,
        definitionRevision: 'adversarial-v1',
        watches,
      });
    });
    let matched = 0;
    let unmatched = 0;
    const started = performance.now();
    for (const path of ids.manyEntries) {
      const doc = documentFor(records, path)!;
      const routed = await registry.affected(realmURL, undefined, doc);
      const shouldMatch = String(doc.search_doc!.text).includes('text 3');
      if (shouldMatch) matched++;
      else unmatched++;
      assert.strictEqual(
        routed.length,
        shouldMatch ? 1 : 0,
        `${path} (${doc.search_doc!.text}) ${shouldMatch ? 'routes to' : 'does not route to'} the contains owner`,
      );
    }
    console.log(
      `LATTICE_ADVERSARIAL contains routing: ${matched} matched, ${unmatched} not, ${Math.round(performance.now() - started)} ms for ${ids.manyEntries.length} documents`,
    );
  });

  test('a feeder that flaps five hundred times routes every time and never routes to the wrong group', async function (assert) {
    const { records, ids } = generateAdversarial({ realmURL, subscribers: 1 });
    const other: AdversarialRecords = new Map(records);
    other.set('Own/on-other.json', {
      data: {
        type: 'card',
        attributes: { group: 'other' },
        meta: { adoptsFrom: adversarialModuleRef(realmURL, 'GroupOn') },
      },
    });
    await register(other, [ids.groupOn, 'Own/on-other.json']);
    const flapper = ids.flapperCards[0];
    let current = records;
    let routedCount = 0;
    const started = performance.now();
    for (let i = 0; i < 500; i++) {
      const next = applyAdversarialWrites(current, [
        { op: 'PATCH', path: flapper, attributes: { on: i % 2 === 0 } },
      ]);
      const routed = strip(
        await registry.affected(
          realmURL,
          documentFor(current, flapper),
          documentFor(next, flapper),
        ),
      );
      if (routed.length !== 1 || routed[0] !== ids.groupOn)
        assert.deepEqual(
          routed,
          [ids.groupOn],
          `flap ${i} routes to the group`,
        );
      routedCount += routed.length;
      current = next;
    }
    const ms = Math.round(performance.now() - started);
    console.log(
      `LATTICE_ADVERSARIAL flap: 500 toggles routed in ${ms} ms (${(ms / 500).toFixed(2)} ms each)`,
    );
    assert.strictEqual(
      routedCount,
      500,
      'every toggle routed to exactly one owner',
    );
  });

  test('a watch on another realm is refused at registration', async function (assert) {
    const { records, ids } = generateAdversarial({ realmURL, subscribers: 1 });
    const [watch] = adversarialWatches(realmURL, records, ids.groupOn);
    const foreign = {
      ...watch,
      query: {
        ...watch.query,
        realms: ['https://elsewhere.example/'],
      } as Query,
    };
    await assert.rejects(
      db.withWriteLock(`lattice:index:${realmURL}`, async (tx) => {
        const watches = await registry.prepare([foreign]);
        await registry.publish(tx!, {
          realmURL,
          ownerURL: realmURL + ids.groupOn,
          generation: 1,
          inputGeneration: 1,
          definitionRevision: 'adversarial-v1',
          watches,
        });
      }),
      /require the owner realm/,
      'the registry refuses a cross-realm watch with a reason',
    );
  });

  test('keys that differ only in Unicode normalisation are different keys', async function (assert) {
    const { records, ids } = generateAdversarial({ realmURL, subscribers: 1 });
    const nfc = 'café'.normalize('NFC');
    const nfd = 'café'.normalize('NFD');
    assert.notStrictEqual(nfc, nfd, 'the two spellings differ as strings');
    const withOwner: AdversarialRecords = new Map(records);
    withOwner.set('Own/count-cafe.json', {
      data: {
        type: 'card',
        attributes: { bucket: nfc },
        meta: { adoptsFrom: adversarialModuleRef(realmURL, 'BucketCount') },
      },
    });
    await register(withOwner, ['Own/count-cafe.json']);
    const entryDoc = (bucket: string, path: string): LatticeDocument => ({
      url: realmURL + path,
      types: [typeKey(adversarialModuleRef(realmURL, 'Entry'))],
      search_doc: { id: realmURL + path, bucket, n: 1, text: 't' },
    });
    assert.strictEqual(
      (await registry.affected(realmURL, undefined, entryDoc(nfc, 'Entry/c1')))
        .length,
      1,
      'an NFC entry routes to the NFC owner',
    );
    assert.strictEqual(
      (await registry.affected(realmURL, undefined, entryDoc(nfd, 'Entry/c2')))
        .length,
      0,
      'an NFD entry does not route to the NFC owner: normalisation is the writer’s job, not the registry’s',
    );
    void ids;
  });
});
