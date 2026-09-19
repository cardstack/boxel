import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  Prerenderer as Renderer,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  localBaseRealm,
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';
import {
  CLINICAL_OWNER_TYPES,
  CLINICAL_SCENARIOS,
  applyWrites,
  changedOwners,
  clinicalFixtures,
  clinicalTypeOf,
  expectedAttributes,
  expectedOwners,
  generateClinical,
  latticeClinicalSource,
  type ClinicalRecords,
  type ClinicalWrite,
} from './helpers/lattice-clinical-fixture.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4455/';
const realmURL = origin + 'lattice-clinical/';
const actor = '@lattice-clinical:localhost';
// LATTICE_CLINICAL_SCALE multiplies admitted patients per ward. Timing is
// opt-in; the correctness catalog is not a performance benchmark by default.
const scale = Number(process.env.LATTICE_CLINICAL_SCALE ?? '1');
const traceTiming = process.env.LATTICE_CLINICAL_TRACE_TIMING === 'true';
const { records: initial, ids } = generateClinical({ realmURL, scale });

// The acceptance layer. A real realm indexes the clinical workload with
// Lattice enabled, then each catalog scenario is applied through the ordinary
// HTTP write surface. After the queue settles, every owner the oracle says
// changed must serve exactly the oracle's values, every owner the scenario
// declares unrelated must not have republished, and an owner whose query page
// overflowed must not serve a complete-looking count. Scenarios run in catalog
// order on one realm; the oracle test proves that order is valid.
//
// Placement is the ordinary Chrome producer. Native Node placement has its
// own admission and parity tests; this layer is about the kernel behaviours
// (routing, invalidation, convergence, blast radius), not where code runs.
module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let render: Prerenderer;
  let restore: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  let current: ClinicalRecords = initial;
  const cutoffRepublished: string[] = [];
  const sessions = JSON.parse(
    testCreatePrerenderAuth(actor, {
      [realmURL]: ['read', 'write', 'realm-owner'],
    }),
  );
  const authorization = `Bearer ${sessions[realmURL]}`;
  const renderer: Renderer = {
    async prerenderVisit(args) {
      return (await render.prerenderVisit(args)).response;
    },
    async prerenderModule(args) {
      return (await render.prerenderModule(args)).response;
    },
    async releaseBatch(args) {
      await render.releaseBatch(args);
    },
    async runCommand() {
      throw new Error('Unexpected fixture command');
    },
  };

  hooks.before(() => {
    restore = installRealmServerAssertOwnRealmServerBypassPatch();
    render = getPrerendererForTesting({ serverURL: origin, maxPages: 2 });
  });
  hooks.after(async () => {
    await restore?.restore();
    await render?.stop();
  });
  setupPermissionedRealm(hooks, {
    latticeEnabled: true,
    mode: 'before',
    realmURL: new URL(realmURL),
    permissions: { '*': ['read'], [actor]: ['read', 'write', 'realm-owner'] },
    fileSystem: {
      'cards.gts': latticeClinicalSource,
      ...clinicalFixtures(initial),
    },
    prerenderer: renderer,
    assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
    onRealmSetup({ dbAdapter, virtualNetwork }) {
      db = dbAdapter;
      network = virtualNetwork;
      network.mount(async (request) => {
        if (!request.url.startsWith(origin + 'base/')) return null;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
          return new Response(null, { status: 405 });
        const headers = new Headers(request.headers);
        headers.delete('authorization');
        return fetch(
          request.url.replace(origin + 'base/', localBaseRealm + '/'),
          { method: request.method, headers, signal: request.signal },
        );
      });
    },
  });

  const owners = () =>
    [...current.keys()].filter((path) =>
      CLINICAL_OWNER_TYPES.includes(clinicalTypeOf(current, path)),
    );

  // On a settle failure, render the first dirty owner directly so the card
  // error the drain swallows ("incomplete Lattice materialization") is visible.
  async function probeFirstDirtyOwner() {
    const [dirty] = await db.execute(
      'SELECT owner_url FROM lattice_owners WHERE realm_url=$1 AND retired=FALSE AND (published_generation IS NULL OR dirty_generation IS NOT NULL) ORDER BY owner_url LIMIT 1',
      { bind: [realmURL] },
    );
    if (!dirty) return undefined;
    const [generation] = await db.execute(
      'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
      { bind: [realmURL] },
    );
    try {
      const { card } = await renderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: String(dirty.owner_url).replace(/\.json$/, ''),
        auth: JSON.stringify(sessions),
        visitType: 'index',
        inputSnapshot: {
          realmURL,
          generation: Number(generation?.current_generation ?? 0),
        },
        renderOptions: { clearCache: true, cardRender: true },
      });
      return {
        owner: dirty.owner_url,
        error: card?.error,
        meta: card?.serialized?.data.meta,
      };
    } catch (error) {
      return { owner: dirty.owner_url, thrown: String(error) };
    }
  }

  async function diagnostics() {
    return JSON.stringify({
      probe: await probeFirstDirtyOwner(),
      owners: await db.execute(
        'SELECT owner_url,dirty_generation,published_generation,input_generation,retired FROM lattice_owners WHERE realm_url=$1 ORDER BY owner_url',
        { bind: [realmURL] },
      ),
      jobs: await db.execute(
        'SELECT id,job_type,status,left(result::text,600) AS result FROM jobs ORDER BY id DESC LIMIT 12',
      ),
      errors: await db.execute(
        'SELECT url,left(error_doc::text,600) AS error FROM boxel_index WHERE realm_url=$1 AND has_error=TRUE',
        { bind: [realmURL] },
      ),
    });
  }

  // Owners in `allowDirty` are expected to stay pending (the system must not
  // publish them); settlement then means the queue is idle and every other
  // owner is published.
  // The drain publishes one owner per wave, so settlement time grows with
  // the number of owners; scale the deadline rather than the workload.
  async function settled(
    label: string,
    allowDirty: string[] = [],
    perOwnerMs = 5_000,
  ): Promise<void> {
    const timeout = Math.max(180_000, owners().length * perOwnerMs);
    try {
      await waitUntil(
        async () => {
          const jobs = await db.execute(
            "SELECT 1 FROM jobs WHERE status='unfulfilled' AND args->>'realmURL'=$1 LIMIT 1",
            { bind: [realmURL] },
          );
          if (jobs.length) return false;
          const dirty = await db.execute(
            'SELECT owner_url FROM lattice_owners WHERE realm_url=$1 AND retired=FALSE AND (published_generation IS NULL OR dirty_generation IS NOT NULL)',
            { bind: [realmURL] },
          );
          return dirty.every((row) =>
            allowDirty.includes(String(row.owner_url)),
          );
        },
        { timeout, interval: 250 },
      );
    } catch (error) {
      throw new Error(
        `${label}: the clinical realm did not settle (${String(error)}): ${await diagnostics()}`,
      );
    }
  }

  async function generations(): Promise<Map<string, number>> {
    const rows = await db.execute(
      'SELECT owner_url,published_generation FROM lattice_owners WHERE realm_url=$1',
      { bind: [realmURL] },
    );
    return new Map(
      rows.map((row) => [
        String(row.owner_url).slice(realmURL.length),
        Number(row.published_generation),
      ]),
    );
  }

  async function served(path: string) {
    const response = await fetch(realmURL + path.replace(/\.json$/, ''), {
      headers: {
        Accept: 'application/vnd.card+json',
        Authorization: authorization,
      },
    });
    if (!response.ok)
      throw new Error(
        `${path}: GET ${response.status} ${(await response.text()).slice(0, 300)}`,
      );
    const { data } = await response.json();
    return {
      attributes: data.attributes as Record<string, unknown>,
      relationships: data.relationships as Record<string, any>,
      state: data.meta?.publication?.state as string | undefined,
    };
  }

  function pick(
    actual: Record<string, unknown>,
    expected: Record<string, unknown>,
  ) {
    return Object.fromEntries(
      Object.keys(expected).map((key) => [key, actual[key]]),
    );
  }

  async function apply(write: ClinicalWrite): Promise<void> {
    const bare = realmURL + write.path.replace(/\.json$/, '');
    let response: Response;
    switch (write.op) {
      case 'POST':
        response = await fetch(realmURL + write.path, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.card+source',
            'Content-Type': 'application/vnd.card+source',
            Authorization: authorization,
          },
          body: JSON.stringify(write.document),
        });
        break;
      case 'PATCH': {
        const existing = current.get(write.path)!;
        response = await fetch(bare, {
          method: 'PATCH',
          headers: {
            Accept: 'application/vnd.card+json',
            'Content-Type': 'application/vnd.card+json',
            Authorization: authorization,
          },
          body: JSON.stringify({
            data: {
              type: 'card',
              attributes: write.attributes ?? {},
              ...(write.relationships
                ? { relationships: write.relationships }
                : {}),
              meta: {
                adoptsFrom: {
                  module: '../cards',
                  name: existing.data.meta.adoptsFrom.name,
                },
              },
            },
          }),
        });
        break;
      }
      case 'DELETE':
        response = await fetch(bare, {
          method: 'DELETE',
          headers: {
            Accept: 'application/vnd.card+json',
            Authorization: authorization,
          },
        });
        break;
    }
    if (!response.ok)
      throw new Error(
        `${write.op} ${write.path}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`,
      );
    await response.arrayBuffer();
  }

  test('boot indexing publishes every clinical owner equal to the raw-document oracle', async function (assert) {
    assert.timeout(1_800_000);
    const bootStart = traceTiming ? performance.now() : 0;
    await settled('boot', [], 15_000);
    if (traceTiming)
      console.log(
        `LATTICE_CLINICAL timing ${JSON.stringify({
          scale,
          scenario: 'boot',
          cards: initial.size,
          owners: owners().length,
          settleMs: Math.round(performance.now() - bootStart),
        })}`,
      );
    const expected = expectedOwners(current);
    for (const path of owners()) {
      const { attributes, state } = await served(path);
      assert.strictEqual(
        state,
        'ready',
        `${path} is served from a ready publication`,
      );
      assert.deepEqual(
        pick(attributes, expected.get(path)!),
        expected.get(path),
        `${path} serves the oracle's derived values after boot`,
      );
    }
    for (const path of [...current.keys()].filter(
      (p) => clinicalTypeOf(current, p) === 'VitalsReading',
    )) {
      const { attributes } = await served(path);
      assert.strictEqual(
        attributes.critical,
        expectedAttributes(current, path).critical,
        `${path} publishes its computed critical flag`,
      );
    }
    assert.strictEqual(
      (await generations()).size,
      owners().length,
      'every owner is registered in the registry exactly once',
    );
  });

  for (const scenario of CLINICAL_SCENARIOS) {
    test(`${scenario.key}: ${scenario.title}`, async function (assert) {
      assert.timeout(900_000);
      const writes = scenario.writes(ids, current);
      const before = expectedOwners(current);
      const generationsBefore = await generations();
      const next = applyWrites(current, writes);
      const after = expectedOwners(next);
      const affected = changedOwners(before, after);
      assert.deepEqual(
        affected,
        [...scenario.affected(ids)].sort(),
        `${scenario.key}: the catalog claim still matches the oracle at this point in the sequence`,
      );
      for (const write of writes) await apply(write);
      current = next;
      const paged = new Set(scenario.paged?.(ids) ?? []);
      const settleStart = traceTiming ? performance.now() : 0;
      await settled(scenario.key);
      const settleMs = traceTiming
        ? Math.round(performance.now() - settleStart)
        : 0;
      const generationsAfter = await generations();
      const republished = [...generationsAfter]
        .filter(
          ([path, generation]) => generation !== generationsBefore.get(path),
        )
        .map(([path]) => path)
        .sort();
      if (traceTiming)
        console.log(
          `LATTICE_CLINICAL timing ${JSON.stringify({
            scale,
            scenario: scenario.key,
            writes: writes.length,
            owners: owners().length,
            affected: affected.length,
            republished: republished.length,
            settleMs,
          })}`,
        );
      for (const path of affected) {
        const { attributes, state, relationships } = await served(path);
        if (paged.has(path)) {
          const membership = relationships.vitals;
          assert.strictEqual(
            state,
            'ready',
            `${path} publishes a complete page`,
          );
          assert.strictEqual(
            attributes.vitalsCount,
            8,
            'the formula counts its declared page',
          );
          assert.strictEqual(
            membership.data.length,
            8,
            'every member of the page is captured',
          );
          assert.deepEqual(
            membership.meta,
            {
              total: after.get(path)!.vitalsCount,
              returned: 8,
            },
            'the receipt distinguishes page membership from all matching readings',
          );
          assert.true(
            republished.includes(path),
            'the bounded owner republished',
          );
          continue;
        }
        assert.strictEqual(
          state,
          'ready',
          `${path} is ready after ${scenario.key}`,
        );
        assert.deepEqual(
          pick(attributes, after.get(path)!),
          after.get(path),
          `${path} serves the oracle's values after ${scenario.key}`,
        );
        assert.true(
          republished.includes(path),
          `${path} republished after ${scenario.key}`,
        );
      }
      for (const path of scenario.unaffected?.(ids) ?? [])
        assert.false(
          republished.includes(path),
          `${path} is unrelated to ${scenario.key} and did not republish (republished: ${JSON.stringify(republished)})`,
        );
      for (const path of scenario.cutoff?.(ids) ?? []) {
        const { attributes } = await served(path);
        assert.deepEqual(
          pick(attributes, after.get(path)!),
          after.get(path),
          `${path} still serves unchanged values after ${scenario.key}`,
        );
        if (republished.includes(path))
          cutoffRepublished.push(`${scenario.key}:${path}`);
      }
      // Any republished owner must be explained by the catalog.
      const explained = new Set([
        ...affected,
        ...(scenario.cutoff?.(ids) ?? []),
        ...writes.map((write) => write.path),
      ]);
      for (const path of republished)
        assert.true(
          explained.has(path),
          `${path} republished after ${scenario.key} and the catalog explains why`,
        );
    });
  }

  // Revalidation satisfies newer inputs without claiming a changed output.
  test('cutoff on unchanged output stops republication of the unchanged owner', function (assert) {
    assert.deepEqual(
      cutoffRepublished,
      [],
      'no owner with unchanged output republished during the catalog',
    );
  });
});
