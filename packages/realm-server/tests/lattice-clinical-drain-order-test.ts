import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  Prerenderer as Renderer,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import type { Prerenderer } from '../prerender/prerenderer.ts';
import {
  getPrerendererForTesting,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
  waitUntil,
} from './helpers/index.ts';
import { installRealmServerAssertOwnRealmServerBypassPatch } from './helpers/prerender-page-patches.ts';
import {
  NATURAL_DIRECTORIES,
  CLINICAL_SCENARIOS,
  applyWrites,
  clinicalFixtures,
  expectedOwners,
  generateClinical,
  latticeClinicalSource,
} from './helpers/lattice-clinical-fixture.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4457/';
const realmURL = origin + 'lattice-clinical-order/';
const actor = '@lattice-clinical-order:localhost';
// The same clinical workload with its owners in their natural directories:
// `FacilityCensus/` sorts before `PatientDaySummary/` and `WardBoard/`.
const { records, ids } = generateClinical({
  realmURL,
  ownerDirectories: NATURAL_DIRECTORIES,
});
const sessions = JSON.parse(
  testCreatePrerenderAuth(actor, {
    [realmURL]: ['read', 'write', 'realm-owner'],
  }),
);

// Real Chrome producers, with the census sorting before its pending inputs.
// Exercise both initial stabilization and the same three-level chain after
// an HTTP source edit. Never rename cards to make URL order imply readiness.
module('Lattice | clinical drain ordering', function (hooks) {
  let db: PgAdapter;
  let current = records;
  const computed: string[] = [];
  const otherVisits: string[] = [];
  let render: Prerenderer;
  let restore: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  const renderer: Renderer = {
    async prerenderVisit(args) {
      if (args.inputSnapshot) computed.push(args.url);
      else otherVisits.push(args.url);
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
      ...clinicalFixtures(records),
    },
    prerenderer: renderer,
    assetsURL: new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
    onRealmSetup({ dbAdapter, virtualNetwork }) {
      db = dbAdapter;
      (virtualNetwork as VirtualNetwork).mount(async (request) => {
        if (!request.url.startsWith(origin + 'base/')) return null;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
          return new Response(null, { status: 405 });
        const headers = new Headers(request.headers);
        headers.delete('authorization');
        return fetch(
          request.url.replace(origin + 'base/', 'http://localhost:4201/base/'),
          { method: request.method, headers, signal: request.signal },
        );
      });
    },
  });

  async function idle() {
    await waitUntil(
      async () =>
        (
          await db.execute(
            "SELECT 1 FROM jobs WHERE status='unfulfilled' LIMIT 1",
          )
        ).length === 0,
      { timeout: 240_000, interval: 500 },
    );
  }

  async function served(path: string) {
    const response = await fetch(realmURL + path.replace(/\.json$/, ''), {
      headers: {
        Accept: 'application/vnd.card+json',
        Authorization: `Bearer ${sessions[realmURL]}`,
      },
    });
    const body = await response.json();
    return { status: response.status, data: body.data };
  }

  async function assertOutputs(
    assert: Assert,
    expected = expectedOwners(records),
  ) {
    for (const [path, attributes] of expected) {
      const { status, data } = await served(path);
      assert.strictEqual(status, 200, `${path} read succeeded`);
      assert.strictEqual(
        data?.meta?.publication?.state,
        'ready',
        `${path} is current`,
      );
      assert.deepEqual(
        Object.fromEntries(
          Object.keys(attributes).map((key) => [key, data?.attributes?.[key]]),
        ),
        attributes,
        `${path} matches the independent raw-document oracle`,
      );
    }
  }

  test('a chain whose top sorts first still converges at boot', async function (assert) {
    assert.timeout(600_000);
    let settledInTime = true;
    try {
      await idle();
      const dirty = await db.execute(
        'SELECT 1 FROM lattice_owners WHERE realm_url=$1 AND retired=FALSE AND (published_generation IS NULL OR dirty_generation > published_generation) LIMIT 1',
        { bind: [realmURL] },
      );
      settledInTime = dirty.length === 0;
    } catch {
      settledInTime = false;
    }
    const owners = await db.execute(
      'SELECT owner_url,dirty_generation,published_generation FROM lattice_owners WHERE realm_url=$1 ORDER BY owner_url',
      { bind: [realmURL] },
    );
    const failures = await db.execute(
      "SELECT id,left(result::text,300) AS result FROM jobs WHERE job_type='lattice-materialize' AND status<>'resolved' ORDER BY id",
    );
    // Registry rows alone do not say whether a publication exists; the
    // served document's Lattice state does.
    const states: Record<string, string> = {};
    for (const row of owners) {
      const url = String(row.owner_url).replace(/\.json$/, '');
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.card+json',
          Authorization: `Bearer ${sessions[realmURL]}`,
        },
      });
      const body = await response.json();
      states[url.slice(realmURL.length)] = String(
        body.data?.meta?.publication?.state ?? `http ${response.status}`,
      );
    }
    console.log(
      `LATTICE_CLINICAL drain order: settledInTime=${settledInTime} states=${JSON.stringify(states)} failedMaterializeJobs=${failures.length}`,
    );
    const firstByURL = String(owners[0]?.owner_url ?? '').slice(
      realmURL.length,
    );
    assert.true(
      firstByURL.startsWith(NATURAL_DIRECTORIES.census + '/'),
      `the census sorts first among the owners (${firstByURL})`,
    );
    assert.true(settledInTime, 'the realm settled within the deadline');
    assert.deepEqual(
      Object.values(states).filter((state) => state !== 'ready'),
      [],
      `every owner is served from a ready publication (states: ${JSON.stringify(states)}; failed materialize jobs: ${JSON.stringify(failures)})`,
    );
    await assertOutputs(assert);
  });

  test('a source correction updates summary, board and census with complete output parity', async function (assert) {
    assert.timeout(600_000);
    const scenario = CLINICAL_SCENARIOS.find(
      (item) => item.key === 'vitals-turn-critical',
    )!;
    const writes = scenario.writes(ids, records);
    const before = expectedOwners(records);
    const after = expectedOwners(applyWrites(records, writes));
    for (const path of scenario.affected(ids))
      assert.notDeepEqual(
        before.get(path),
        after.get(path),
        `${path} must change`,
      );
    for (const write of writes) {
      const response = await fetch(
        realmURL + write.path.replace(/\.json$/, ''),
        {
          method: 'PATCH',
          headers: {
            Accept: 'application/vnd.card+json',
            'Content-Type': 'application/vnd.card+json',
            Authorization: `Bearer ${sessions[realmURL]}`,
          },
          body: JSON.stringify({
            data: {
              type: 'card',
              attributes: write.attributes,
              meta: records.get(write.path)!.data.meta,
            },
          }),
        },
      );
      assert.true(
        response.ok,
        `source correction accepted: ${response.status}`,
      );
      await response.arrayBuffer();
    }
    await idle();
    await assertOutputs(assert, after);
    current = applyWrites(records, writes);
    assert.deepEqual(
      await db.execute(
        'SELECT owner_url FROM lattice_owners WHERE realm_url=$1 AND retired=FALSE AND dirty_generation IS NOT NULL',
        { bind: [realmURL] },
      ),
      [],
      'no downstream obligation was left behind',
    );
  });

  test('a note-only input change validates equal output without rebuilding its downstream owners', async function (assert) {
    assert.timeout(600_000);
    await idle();
    const scenario = CLINICAL_SCENARIOS.find(
      (item) => item.key === 'vitals-note-only',
    )!;
    const writes = scenario.writes(ids, current);
    const after = applyWrites(current, writes);
    assert.deepEqual(
      expectedOwners(after),
      expectedOwners(current),
      'the independent oracle confirms all computed outputs are equal',
    );
    const revisions = () =>
      db.execute(
        'SELECT owner_url,published_generation,input_generation FROM lattice_owners WHERE realm_url=$1 ORDER BY owner_url',
        { bind: [realmURL] },
      );
    const before = await revisions();
    const visitsBefore = computed.length;
    const otherVisitsBefore = otherVisits.length;
    for (const write of writes) {
      const response = await fetch(
        realmURL + write.path.replace(/\.json$/, ''),
        {
          method: 'PATCH',
          headers: {
            Accept: 'application/vnd.card+json',
            'Content-Type': 'application/vnd.card+json',
            Authorization: `Bearer ${sessions[realmURL]}`,
          },
          body: JSON.stringify({
            data: {
              type: 'card',
              attributes: write.attributes,
              meta: current.get(write.path)!.data.meta,
            },
          }),
        },
      );
      assert.true(response.ok, `note accepted: ${response.status}`);
      await response.arrayBuffer();
    }
    await idle();
    current = after;
    await assertOutputs(assert, expectedOwners(after));
    const actual = await revisions();
    const visits = computed.slice(visitsBefore);
    console.log(
      `LATTICE_CUTOFF ${JSON.stringify({ visits, before, after: actual })}`,
    );
    assert.deepEqual(
      actual.map((row) => [row.owner_url, Number(row.published_generation)]),
      before.map((row) => [row.owner_url, Number(row.published_generation)]),
      'equal output keeps every output revision',
    );
    const cutoff = realmURL + scenario.cutoff!(ids)[0];
    assert.deepEqual(
      visits,
      [cutoff],
      'only the directly affected producer recomputes',
    );
    const ownerURLs = new Set(
      before.map((row) => String(row.owner_url).replace(/\.json$/, '')),
    );
    assert.deepEqual(
      otherVisits
        .slice(otherVisitsBefore)
        .filter((url) => ownerURLs.has(url.replace(/\.json$/, ''))),
      [],
      'equal owner outputs require no new HTML or discovery visits',
    );
    assert.true(
      Number(actual.find((row) => row.owner_url === cutoff)!.input_generation) >
        Number(
          before.find((row) => row.owner_url === cutoff)!.input_generation,
        ),
      'the owner records that newer inputs were validated',
    );
  });
});
