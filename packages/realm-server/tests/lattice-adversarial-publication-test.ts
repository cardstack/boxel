import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import { latticeMaterializationReadySQL } from '@cardstack/runtime-common/jobs/lattice';
import { latticeCodeReadySQL } from '@cardstack/runtime-common/jobs/lattice-code';
import { latticeRenderRetryReadySQL } from '@cardstack/runtime-common/jobs/lattice-render';
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
  BAD_TYPES,
  adversarialBadSource,
  adversarialBrokenSource,
  adversarialFixtures,
  adversarialModuleRef,
  adversarialSource,
  applyAdversarialWrites,
  expectedOwner,
  generateAdversarial,
  newEntry,
  owners as ownersOf,
  type AdversarialRecords,
  type AdversarialWrite,
} from './helpers/lattice-adversarial-fixture.ts';

const { module, test, todo } = QUnit;
const origin = 'http://127.0.0.1:4458/';
const realmURL = origin + 'lattice-adversarial/';
const actor = '@lattice-adversarial:localhost';
// Sized to boot inside the realm helper's five-minute first-index budget
// while keeping every pathology: 55 entries still overflow a page of 50, and
// 24 subscribers still make fan-out the largest single republish. The stats
// bucket stays under 50: a second truncated owner that sorted first under
// `Own/` starved the whole drain (catalog finding 8).
const depth = Number(process.env.LATTICE_ADVERSARIAL_DEPTH ?? '4');
const { records: initial, ids } = generateAdversarial({
  realmURL,
  depth,
  chains: 2,
  leavesPerChain: 2,
  manyEntries: 55,
  statsEntries: 40,
  subscribers: 24,
  flappers: 6,
  bulkChars: 64 * 1024,
  bulks: 3,
});

// Acceptance layer under adversarial load: a real realm indexes the workload
// with Lattice enabled and the ordinary Chrome producer, then each scenario
// is applied through the HTTP write surface. The contract is not "every
// owner publishes"; it is: every owner that can be right is right and equal
// to the oracle, every owner that cannot be right is withheld rather than
// wrong, and no bad owner takes a healthy one down. Owners the fixture
// expects to stay withheld today sit under `Zz/` so the URL-ordered drain
// meets the healthy owners first. Timing lines are logged as
// LATTICE_ADVERSARIAL for the catalog.
module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let render: Prerenderer;
  let restore: ReturnType<
    typeof installRealmServerAssertOwnRealmServerBypassPatch
  >;
  let current: AdversarialRecords = initial;
  // When set, visits to the Slow owner are made to exceed their render
  // deadline, standing in for a computed that times out.
  const slowVisit = { timeout: false, hits: 0 };
  const sessions = JSON.parse(
    testCreatePrerenderAuth(actor, {
      [realmURL]: ['read', 'write', 'realm-owner'],
    }),
  );
  const authorization = `Bearer ${sessions[realmURL]}`;
  const renderer: Renderer = {
    async prerenderVisit(args) {
      let visit: Parameters<Prerenderer['prerenderVisit']>[0] = args;
      if (slowVisit.timeout && args.url.includes('/Own/slow')) {
        slowVisit.hits++;
        visit = {
          ...args,
          opts: { timeoutMs: 1_000, simulateTimeoutMs: 4_000 },
        };
      }
      return (await render.prerenderVisit(visit)).response;
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

  // The realm's first index of this workload takes longer than the harness's
  // sixty-second test timeout; the setup hooks share the first test's clock.
  hooks.before(function (assert) {
    assert.timeout(3_600_000);
  });
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
      'cards.gts': adversarialSource({ depth }),
      'bad.gts': adversarialBadSource,
      'broken.gts': adversarialBrokenSource,
      ...adversarialFixtures(initial),
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
          request.url.replace(origin + 'base/', localBaseRealm + '/'),
          { method: request.method, headers, signal: request.signal },
        );
      });
    },
  });

  // Owners the fixture expects to stay withheld on today's branch, with the
  // reason the catalog records for each.
  const withheldToday = () => [
    ids.cycleA,
    ids.cycleB, // each waits for the other
    ids.bad.BadType, // string + number errors
    ids.bad.BadShape, // an object where a number is declared
    ids.brokenModule, // its module fails to load
  ];
  // Wrong formulas that BXL evaluates without error, so the owner publishes a
  // plausible wrong value: division by zero is null, iterating a null is
  // empty. Pinned here; the catalog argues they should be refused instead.
  const publishesWrongValue: Record<string, Record<string, unknown>> = {
    [ids.bad.BadRuntime]: { ratio: null },
    [ids.bad.BadNull]: { iterated: 0 },
  };

  async function probeOwner(path: string) {
    const [generation] = await db.execute(
      'SELECT current_generation FROM realm_generations WHERE realm_url=$1',
      { bind: [realmURL] },
    );
    try {
      const { card } = await renderer.prerenderVisit({
        affinityType: 'realm',
        affinityValue: realmURL,
        realm: realmURL,
        url: realmURL + path.replace(/\.json$/, ''),
        auth: JSON.stringify(sessions),
        visitType: 'index',
        inputSnapshot: {
          realmURL,
          generation: Number(generation?.current_generation ?? 0),
        },
        renderOptions: { clearCache: true, cardRender: true },
      });
      return {
        owner: path,
        error: card?.error
          ? JSON.stringify(card.error).slice(0, 300)
          : undefined,
      };
    } catch (error) {
      return { owner: path, thrown: String(error).slice(0, 300) };
    }
  }

  async function dirtyOwners(): Promise<string[]> {
    const rows = await db.execute(
      'SELECT owner_url FROM lattice_owners WHERE realm_url=$1 AND retired=FALSE AND (published_generation IS NULL OR dirty_generation IS NOT NULL) ORDER BY owner_url',
      { bind: [realmURL] },
    );
    return rows.map((row) => String(row.owner_url).slice(realmURL.length));
  }

  async function diagnostics() {
    const dirty = await dirtyOwners();
    return JSON.stringify({
      dirty,
      probe: dirty.length ? await probeOwner(dirty[0]) : undefined,
      jobs: await db.execute(
        'SELECT id,job_type,status,left(result::text,300) AS result FROM jobs ORDER BY id DESC LIMIT 8',
      ),
      waiting: await db.execute(
        `SELECT id,job_type,args,
          ${latticeMaterializationReadySQL} AS materialization_ready,
          ${latticeRenderRetryReadySQL} AS render_ready,
          ${latticeCodeReadySQL} AS code_ready
          FROM jobs j WHERE status='unfulfilled' AND args->>'realmURL'=$1
          ORDER BY id`,
        { bind: [realmURL] },
      ),
      errors: await db.execute(
        'SELECT url,left(error_doc::text,300) AS error FROM boxel_index WHERE realm_url=$1 AND has_error=TRUE',
        { bind: [realmURL] },
      ),
    });
  }

  async function settled(
    label: string,
    allowDirty: string[] = [],
    perOwnerMs = 6_000,
  ): Promise<number> {
    const started = performance.now();
    const timeout = Math.max(240_000, ownersOf(current).length * perOwnerMs);
    try {
      await waitUntil(
        async () => {
          // Parked obligations are intentionally unfulfilled. Wait for this
          // realm's runnable work, then require all healthy owners to be clean.
          // HTML retries for deliberately invalid owners are parked too.
          const jobs = await db.execute(
            `SELECT 1 FROM jobs j WHERE status='unfulfilled'
              AND args->>'realmURL'=$1 AND ${latticeMaterializationReadySQL}
              AND ${latticeRenderRetryReadySQL} AND ${latticeCodeReadySQL} LIMIT 1`,
            { bind: [realmURL] },
          );
          if (jobs.length) return false;
          const dirty = await dirtyOwners();
          return dirty.every((path) => allowDirty.includes(path));
        },
        { timeout, interval: 300 },
      );
    } catch (error) {
      throw new Error(
        `${label}: the adversarial realm did not settle (${String(error)}): ${await diagnostics()}`,
      );
    }
    return Math.round(performance.now() - started);
  }

  async function generations(): Promise<Map<string, number | null>> {
    const rows = await db.execute(
      'SELECT owner_url,published_generation FROM lattice_owners WHERE realm_url=$1',
      { bind: [realmURL] },
    );
    return new Map(
      rows.map((row) => [
        String(row.owner_url).slice(realmURL.length),
        row.published_generation === null
          ? null
          : Number(row.published_generation),
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
    const text = await response.text();
    if (!response.ok)
      return {
        status: response.status,
        attributes: {} as Record<string, unknown>,
        relationships: {} as Record<string, any>,
        state: undefined as string | undefined,
        body: text.slice(0, 300),
      };
    const { data } = JSON.parse(text);
    return {
      status: response.status,
      attributes: data.attributes as Record<string, unknown>,
      relationships: data.relationships as Record<string, any>,
      state: data.meta?.publication?.state as string | undefined,
      body: '',
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

  async function apply(write: AdversarialWrite): Promise<Response> {
    const bare = realmURL + write.path.replace(/\.json$/, '');
    switch (write.op) {
      case 'POST':
        return fetch(realmURL + write.path, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.card+source',
            'Content-Type': 'application/vnd.card+source',
            Authorization: authorization,
          },
          body: JSON.stringify(write.document),
        });
      case 'PATCH': {
        const existing = current.get(write.path)!;
        return fetch(bare, {
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
                  module:
                    '../' +
                    existing.data.meta.adoptsFrom.module.split('/').pop(),
                  name: existing.data.meta.adoptsFrom.name,
                },
              },
            },
          }),
        });
      }
      case 'DELETE':
        return fetch(bare, {
          method: 'DELETE',
          headers: {
            Accept: 'application/vnd.card+json',
            Authorization: authorization,
          },
        });
    }
  }

  async function applyAll(writes: AdversarialWrite[]): Promise<void> {
    for (const write of writes) {
      const response = await apply(write);
      if (!response.ok)
        throw new Error(
          `${write.op} ${write.path}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`,
        );
      await response.arrayBuffer();
    }
    current = applyAdversarialWrites(current, writes);
  }

  async function assertOracle(
    assert: Assert,
    path: string,
    label: string,
  ): Promise<void> {
    const expected = expectedOwner(current, path);
    if (!expected) throw new Error(`${path} has no oracle value`);
    const { attributes, state, status, body } = await served(path);
    assert.strictEqual(status, 200, `${path} is served (${body})`);
    assert.strictEqual(state, 'ready', `${path} is ready after ${label}`);
    assert.deepEqual(
      pick(attributes, expected),
      expected,
      `${path} equals the oracle after ${label}`,
    );
  }

  test('boot publishes every owner that can be right and withholds every owner that cannot', async function (assert) {
    assert.timeout(3_600_000);
    const withheld = withheldToday();
    const ms = await settled('boot', withheld, 8_000);
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'boot', depth, owners: ownersOf(current).length, withheld: withheld.length, settleMs: ms })}`,
    );
    for (const path of ownersOf(current)) {
      if (
        withheld.includes(path) ||
        publishesWrongValue[path] ||
        path === ids.bucketCount[ids.manyBucket]
      )
        continue;
      await assertOracle(assert, path, 'boot');
    }
    const page = await served(ids.bucketCount[ids.manyBucket]);
    assert.strictEqual(page.status, 200, 'the bounded owner is served');
    assert.strictEqual(page.state, 'ready', 'the complete page is ready');
    assert.strictEqual(
      page.attributes.count,
      50,
      'the formula counts its page',
    );
    const members = page.relationships.entries.data as Array<{ id: string }>;
    assert.strictEqual(members.length, 50);
    assert.strictEqual(new Set(members.map(({ id }) => id)).size, 50);
    const pageEntries = members.map(({ id }) => {
      const path = id.slice(realmURL.length).replace(/\.json$/, '') + '.json';
      assert.true(
        ids.manyEntries.includes(path),
        'each member matches the query',
      );
      return current.get(path)!.data.attributes;
    });
    assert.strictEqual(
      page.attributes.sum,
      pageEntries.reduce((sum, entry) => sum + Number(entry.n), 0),
      'the sum covers exactly the captured page',
    );
    assert.deepEqual(
      page.relationships.entries.meta,
      { total: ids.manyEntries.length, returned: 50 },
      'the receipt distinguishes all matches from the captured page',
    );
    // Every withheld owner is withheld for a reason the system can name, and
    // never serves a ready publication.
    for (const path of withheld) {
      const { state, status } = await served(path);
      const reason = await probeOwner(path);
      console.log(
        `LATTICE_ADVERSARIAL withheld ${path}: http ${status} state ${state} reason ${JSON.stringify(reason).slice(0, 240)}`,
      );
      assert.notStrictEqual(
        state,
        'ready',
        `${path} is not served as a ready publication`,
      );
    }
    for (const [path, value] of Object.entries(publishesWrongValue)) {
      const { state, attributes } = await served(path);
      console.log(
        `LATTICE_ADVERSARIAL wrong-but-published ${path}: state ${state} ${JSON.stringify(pick(attributes, value))}`,
      );
      // Whether these two reach publication depends on whether a
      // permanently failing owner sorts before them in the drain (catalog
      // finding 8): run five served both ready, run six left both pending.
      // When they publish, the value is the lenient one.
      if (state === 'ready')
        assert.deepEqual(
          pick(attributes, value),
          value,
          `${path} publishes the lenient value BXL produced`,
        );
      else
        assert.strictEqual(
          state,
          'pending',
          `${path} is pending, starved behind a failing owner`,
        );
    }
    // Blast radius: the bad owners share a bucket with a healthy one.
    await assertOracle(
      assert,
      ids.bucketCount[ids.smallBucket],
      'boot, beside four bad formulas and a broken module',
    );
  });

  test('deep-climb: a leaf change climbs every tier of its chain and no tier of another', async function (assert) {
    assert.timeout(1_800_000);
    const chain = ids.chains[0];
    const other = ids.chains[1];
    const before = await generations();
    await applyAll([
      { op: 'PATCH', path: ids.leaves[chain][0], attributes: { value: 7777 } },
    ]);
    const ms = await settled('deep-climb', withheldToday());
    const after = await generations();
    const republished = [...after]
      .filter(([path, generation]) => generation !== before.get(path))
      .map(([path]) => path)
      .sort();
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'deep-climb', depth, republished: republished.length, settleMs: ms })}`,
    );
    for (const path of ids.tiers[chain])
      await assertOracle(assert, path, 'deep-climb');
    assert.deepEqual(
      republished,
      [...ids.tiers[chain]].sort(),
      'exactly the tiers of the written chain republished',
    );
    for (const path of ids.tiers[other])
      assert.false(republished.includes(path), `${path} did not republish`);
  });

  test('fan-out: one notice republishes every subscriber exactly once', async function (assert) {
    assert.timeout(1_800_000);
    const before = await generations();
    await applyAll([
      {
        op: 'POST',
        path: 'Notice/n-00002.json',
        document: {
          data: {
            type: 'card',
            attributes: { audience: ids.audience, body: 'zebra day' },
            meta: { adoptsFrom: adversarialModuleRef(realmURL, 'Notice') },
          },
        },
      },
    ]);
    const ms = await settled('fan-out', withheldToday());
    const after = await generations();
    const republished = [...after]
      .filter(([path, generation]) => generation !== before.get(path))
      .map(([path]) => path)
      .sort();
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'fan-out', subscribers: ids.subscribers.length, republished: republished.length, settleMs: ms })}`,
    );
    assert.deepEqual(
      republished,
      [...ids.subscribers].sort(),
      'exactly the subscribers republished',
    );
    for (const path of ids.subscribers.slice(0, 3))
      await assertOracle(assert, path, 'fan-out');
  });

  test('flap-burst: forty-eight back-to-back toggles converge to the oracle', async function (assert) {
    assert.timeout(1_800_000);
    const [{ count: jobsBefore }] = await db.execute(
      "SELECT COUNT(*)::int AS count FROM jobs WHERE job_type='lattice-materialize'",
    );
    const writes: AdversarialWrite[] = [];
    for (let round = 0; round < 8; round++)
      for (const [i, path] of ids.flapperCards.entries())
        writes.push({
          op: 'PATCH',
          path,
          attributes: { on: (round + i) % 2 === 0 },
        });
    // Back to back, without waiting for the queue between writes. The
    // concurrent variant is the last test in this file: it can wedge the
    // server, and nothing after it would be measurable.
    await applyAll(writes);
    const ms = await settled('flap-burst', withheldToday());
    const [{ count: jobsAfter }] = await db.execute(
      "SELECT COUNT(*)::int AS count FROM jobs WHERE job_type='lattice-materialize'",
    );
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'flap-burst', writes: writes.length, materializeJobs: Number(jobsAfter) - Number(jobsBefore), settleMs: ms })}`,
    );
    await assertOracle(assert, ids.groupOn, 'flap-burst');
  });

  test('big-data: an oversized card is refused at the write with a reason, and the largest allowed one rolls up exactly', async function (assert) {
    assert.timeout(1_800_000);
    const bulk = (chars: number, index: number): AdversarialWrite => ({
      op: 'POST',
      path: `Bulk/${ids.bulkChain}-${index}.json`,
      document: {
        data: {
          type: 'card',
          attributes: {
            chain: ids.bulkChain,
            blob: 'huge-'.repeat(Math.ceil(chars / 5)).slice(0, chars),
          },
          meta: { adoptsFrom: adversarialModuleRef(realmURL, 'Bulk') },
        },
      },
    });
    const tooBig = await apply(bulk(1_536 * 1024, 99999));
    const refusal = (await tooBig.text()).slice(0, 200);
    console.log(
      `LATTICE_ADVERSARIAL big-data: 1.5 MB card -> HTTP ${tooBig.status} ${refusal}`,
    );
    assert.strictEqual(
      tooBig.status,
      413,
      `a card over the realm's size bound is refused at the write with a reason (${refusal})`,
    );
    // Just under the bound (512 KiB including the envelope).
    const chars = 500 * 1024;
    await applyAll([bulk(chars, 99998)]);
    const ms = await settled('big-data', withheldToday());
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'big-data', chars, settleMs: ms })}`,
    );
    await assertOracle(assert, ids.bulkRollup, 'big-data');
  });

  test('many-relief: deleting entries below the page bound updates the page to the full count', async function (assert) {
    assert.timeout(1_800_000);
    await applyAll(
      ids.manyEntries
        .slice(0, 12)
        .map((path) => ({ op: 'DELETE' as const, path })),
    );
    const ms = await settled('many-relief', withheldToday());
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'many-relief', remaining: ids.manyEntries.length - 12, settleMs: ms })}`,
    );
    await assertOracle(assert, ids.bucketCount[ids.manyBucket], 'many-relief');
  });

  test('slow-timeout: a computed that times out never publishes a partial value and recovers when it can', async function (assert) {
    assert.timeout(1_800_000);
    const beforeSlow = await served(ids.slow);
    slowVisit.timeout = true;
    slowVisit.hits = 0;
    let ms = 0;
    try {
      await applyAll([newEntry(realmURL, ids.smallBucket, 5, 50)]);
      // The failing slow owner sorts before the two wrong-value owners over
      // the same bucket, so the drain starves them too (catalog finding 8).
      ms = await settled('slow-timeout', [
        ...withheldToday(),
        ids.slow,
        ...Object.keys(publishesWrongValue),
      ]);
    } finally {
      slowVisit.timeout = false;
    }
    const during = await served(ids.slow);
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'slow-timeout', timedOutVisits: slowVisit.hits, settleMs: ms, state: during.state, count: during.attributes.count })}`,
    );
    assert.true(slowVisit.hits > 0, 'the slow owner was visited and timed out');
    const oracle = expectedOwner(current, ids.slow)!;
    const lastGoodOrWithheld =
      during.state !== 'ready' || during.attributes.count === oracle.count;
    assert.true(
      lastGoodOrWithheld,
      `while timing out the slow owner serves its last good value or nothing ready (state ${during.state}, count ${during.attributes.count}, previous ${beforeSlow.attributes.count})`,
    );
    await assertOracle(
      assert,
      ids.bucketCount[ids.smallBucket],
      'slow-timeout (healthy sibling)',
    );
    // Touch the owner so it is scheduled again now that its render can finish.
    await applyAll([
      { op: 'PATCH', path: ids.slow, attributes: { bucket: ids.smallBucket } },
    ]);
    const recovered = await settled('slow-recovery', withheldToday());
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'slow-recovery', settleMs: recovered })}`,
    );
    await assertOracle(assert, ids.slow, 'slow-recovery');
  });

  test('delete-recreate: a card deleted and recreated at the same URL counts once with its new content', async function (assert) {
    assert.timeout(1_800_000);
    const path = ids.smallEntries[0];
    const [bucket, index] = ['small', 1];
    await applyAll([{ op: 'DELETE', path }]);
    await applyAll([newEntry(realmURL, bucket, index, 999)]);
    const ms = await settled('delete-recreate', withheldToday());
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'delete-recreate', settleMs: ms })}`,
    );
    await assertOracle(
      assert,
      ids.bucketCount[ids.smallBucket],
      'delete-recreate',
    );
    await assertOracle(
      assert,
      ids.jsOwner,
      'delete-recreate (JavaScript getter owner)',
    );
  });

  test('nul-byte: a NUL byte is refused or sanitized in the index, never a poisoned batch', async function (assert) {
    assert.timeout(1_800_000);
    const write = newEntry(realmURL, ids.smallBucket, 7, 7, 'a\u0000b');
    const response = await apply(write);
    const status = response.status;
    await response.arrayBuffer();
    console.log(`LATTICE_ADVERSARIAL nul-byte write: HTTP ${status}`);
    if (response.ok) {
      // Main's index writer replaces JSONB-illegal NUL with U+FFFD. The
      // owner consumes this indexed value, rather than the raw source bytes.
      current = applyAdversarialWrites(current, [
        newEntry(realmURL, ids.smallBucket, 7, 7, 'a\uFFFDb'),
      ]);
    }
    const ms = await settled('nul-byte', withheldToday());
    console.log(
      `LATTICE_ADVERSARIAL timing ${JSON.stringify({ scenario: 'nul-byte', status, settleMs: ms })}`,
    );
    if (response.ok) {
      const { attributes } = await served(write.path);
      assert.strictEqual(
        attributes.text,
        'a\uFFFDb',
        'indexed text replaces NUL',
      );
    }
    // Whether the write was accepted or refused, the healthy owner over the
    // same bucket is still ready and right.
    await assertOracle(assert, ids.bucketCount[ids.smallBucket], 'nul-byte');
    await assertOracle(assert, ids.stats, 'nul-byte (unrelated bucket)');
  });

  todo(
    'cycle: two owners that query each other converge instead of waiting forever',
    async function (assert) {
      assert.timeout(600_000);
      const a = await served(ids.cycleA);
      const b = await served(ids.cycleB);
      assert.strictEqual(a.state, 'ready', 'cycle A is ready');
      assert.strictEqual(b.state, 'ready', 'cycle B is ready');
    },
  );

  test('weird-template: a throwing isolated template does not withhold the data publication', async function (assert) {
    assert.timeout(600_000);
    const { state, attributes } = await served(ids.weird);
    assert.strictEqual(state, 'ready', 'the weird owner is ready');
    assert.deepEqual(
      pick(attributes, expectedOwner(current, ids.weird)!),
      expectedOwner(current, ids.weird),
      'its data equals the oracle even though its template throws',
    );
  });

  test('remote-blank: a declared link off the realm publishes with a blank slot', async function (assert) {
    assert.timeout(600_000);
    const { state, attributes } = await served(ids.remote);
    assert.strictEqual(state, 'ready', 'the remote owner is ready');
    assert.strictEqual(
      attributes.partnerLabel,
      'blank',
      'the missing partner reads as blank',
    );
  });

  test('after everything, every healthy owner still equals the oracle and every bad one is still withheld', async function (assert) {
    assert.timeout(1_800_000);
    await settled(
      'final',
      [...withheldToday(), ...Object.keys(publishesWrongValue)],
      6_000,
    );
    for (const path of ownersOf(current)) {
      if (withheldToday().includes(path) || publishesWrongValue[path]) continue;
      await assertOracle(assert, path, 'final');
    }
    for (const name of BAD_TYPES) {
      const { state } = await served(ids.bad[name]);
      if (publishesWrongValue[ids.bad[name]]) continue;
      assert.notStrictEqual(state, 'ready', `${name} is still withheld`);
    }
  });

  // Last on purpose: the first run of this file showed 48 concurrent PATCHes
  // to one realm being received and never answered, after which every request
  // to the server failed for the rest of the run. Anything after this test
  // would be unmeasurable, so it runs after the final oracle check.
  test('concurrent-burst: forty-eight concurrent writes to one realm are all answered and the server keeps serving', async function (assert) {
    assert.timeout(600_000);
    const writes: AdversarialWrite[] = ids.flapperCards.flatMap((path, i) =>
      [0, 1, 2, 3, 4, 5, 6, 7].map((round) => ({
        op: 'PATCH' as const,
        path,
        attributes: { on: (round + i) % 2 === 1 },
      })),
    );
    const outcomes = await Promise.allSettled(
      writes.map((write) =>
        Promise.race([
          apply(write).then((response) => response.status),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('timeout'), 60_000),
          ),
        ]),
      ),
    );
    const statuses = outcomes.map((outcome) =>
      outcome.status === 'fulfilled' ? String(outcome.value) : 'fetch failed',
    );
    const tally = statuses.reduce<Record<string, number>>((acc, status) => {
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `LATTICE_ADVERSARIAL concurrent-burst: ${JSON.stringify(tally)}`,
    );
    const alive = await fetch(realmURL + 'Own/constant', {
      headers: {
        Accept: 'application/vnd.card+json',
        Authorization: authorization,
      },
    })
      .then((response) => response.status)
      .catch(() => 'fetch failed');
    console.log(`LATTICE_ADVERSARIAL server after burst: ${alive}`);
    assert.deepEqual(
      Object.keys(tally),
      ['200'],
      `every concurrent write is answered 200 (${JSON.stringify(tally)})`,
    );
    assert.strictEqual(
      alive,
      200,
      'the server still serves a card after the burst',
    );
  });
});
