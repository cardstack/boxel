import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';
import {
  LatticeStride,
  type LatticeServiceState,
} from '@cardstack/runtime-common/lattice-stride';
import { LatticeQueryRegistry } from '@cardstack/runtime-common/lattice-query-registry';
import { IndexQueryEngine } from '@cardstack/runtime-common/index-query-engine';
import QUnit from 'qunit';
import { basename } from 'node:path';
import { PgAdapter } from '@cardstack/postgres';
import {
  LatticeDemandCache,
  latticeDemandFor,
  recordLatticeReadDemand,
  LATTICE_DEMAND_CHANNEL,
} from '@cardstack/runtime-common/lattice-demand';
import {
  latticePropagateDemand,
  latticeOrderWave,
  LatticeWaveBudget,
} from '@cardstack/runtime-common/lattice-scheduling';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://demand.example/';
const scope = 'a'.repeat(64);

module(basename(import.meta.filename), (hooks) => {
  let db: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
    },
  });

  test('demand expires independently by actor, realm and urgency; memory is bounded', (assert) => {
    let now = 1000;
    const cache = new LatticeDemandCache(() => now);
    const hint = {
      realm,
      scope,
      owner: realm + 'A/one.json',
      priority: 2 as const,
      expires: now + 100,
    };
    assert.true(cache.put(hint));
    assert.false(
      cache.put({ ...hint, expires: now + 50 }),
      'late replay cannot shorten a lease',
    );
    cache.put({ ...hint, priority: 1, expires: now + 1000 });
    assert.strictEqual(
      cache.priorities(realm).get(hint.owner),
      2,
      'ordinary reads do not demote a waiting read',
    );
    cache.put({ ...hint, scope: 'b'.repeat(64), expires: now + 200 });
    now += 101;
    assert.strictEqual(
      cache.priorities(realm).get(hint.owner),
      2,
      'another actor still wants it urgently',
    );
    now += 100;
    assert.strictEqual(
      cache.priorities(realm).get(hint.owner),
      1,
      'urgent interest expires without removing recent-read interest',
    );
    assert.strictEqual(cache.priorities('https://other.example/').size, 0);
    assert.false(cache.put({ ...hint, expires: now + 30_001 }));
    assert.false(
      cache.put({
        ...hint,
        owner: 'https://other.example/A.json',
        expires: now + 1,
      }),
    );
    for (let i = 0; i < 100; i++)
      cache.put({ ...hint, owner: realm + `A/${i}.json`, expires: now + 1000 });
    assert.strictEqual(
      cache.values().length,
      64,
      'one actor cannot grow the cache without bound',
    );
    for (let i = 0; i < 1000; i++)
      cache.put({
        ...hint,
        scope: i.toString(16).padStart(64, '0'),
        expires: now + 1000,
      });
    assert.strictEqual(
      cache.values().length,
      512,
      'global bound also applies across actors',
    );
    now += 1001;
    assert.strictEqual(cache.values().length, 0);
  });

  test('demand follows blocked prerequisites, terminates cycles, and ignores unknown nodes', (assert) => {
    const inputs = new Map([
      ['board', new Set(['season'])],
      ['season', new Set(['game'])],
      ['game', new Set(['source'])],
      ['source', new Set<string>()],
      ['unrelated', new Set<string>()],
    ]);
    const priorities = latticePropagateDemand(
      new Map([
        ['board', 2],
        ['unrelated', 1],
        ['missing', 2],
      ]),
      inputs,
    );
    assert.deepEqual([...priorities].sort(), [
      ['board', 2],
      ['game', 2],
      ['season', 2],
      ['source', 2],
      ['unrelated', 1],
    ]);
    inputs.get('source')!.add('board');
    assert.strictEqual(
      latticePropagateDemand(new Map([['board', 2]]), inputs).size,
      4,
      'priority traversal terminates without changing readiness',
    );
  });

  test('short waves serve demand and background work, including one-owner waves', (assert) => {
    const rows = [
      { ownerURL: realm + 'Game/background.json' },
      { ownerURL: realm + 'Season/viewed.json', demand: 1 as const },
      { ownerURL: realm + 'Game/waiter.json', demand: 2 as const },
      { ownerURL: realm + 'Team/background.json' },
    ];
    const names = (items: typeof rows) =>
      items.map((row) => row.ownerURL.split('/').at(-1));
    assert.deepEqual(names(latticeOrderWave(rows, 2)), [
      'waiter.json',
      'background.json',
      'viewed.json',
      'background.json',
    ]);
    assert.deepEqual(
      names(latticeOrderWave(rows, 2, true)).slice(0, 2),
      ['background.json', 'waiter.json'],
      'a slow single-owner wave cannot monopolize both turns',
    );
    const all = latticeOrderWave(rows, 2);
    assert.strictEqual(
      new Set(all).size,
      rows.length,
      'no owners lost or duplicated',
    );
  });

  test('a wave yields only before admitting work and always permits forward progress', (assert) => {
    let now = 0;
    const budget = new LatticeWaveBudget(8, 1000, () => now);
    assert.true(budget.take());
    now = 999;
    assert.true(budget.take());
    now = 1000;
    assert.false(
      budget.take(),
      'new work waits for the successor at the deadline',
    );
    const late = new LatticeWaveBudget(8, 1000, () => now);
    now += 2000;
    assert.true(late.take(), 'even slow setup permits one owner');
    assert.false(late.take());
    const fast = new LatticeWaveBudget(2, 1000, () => now);
    assert.true(fast.take());
    assert.true(fast.take());
    assert.false(fast.take(), 'fast work also respects the owner cap');
  });

  test('unfinished aggregates cannot crowd out the inputs needed to settle them', (assert) => {
    const refresh = Array.from({ length: 7 }, (_, i) => ({
      ownerURL: realm + `Board${i}/one.json`,
      stale: true as const,
      pendingInputCount: 500,
      demand: 1 as const,
    }));
    const progress = Array.from({ length: 40 }, (_, i) => ({
      ownerURL: realm + `PlayerSeason/${i}.json`,
      pendingInputCount: 0,
      demand: i === 0 ? (2 as const) : undefined,
    }));
    const rows = [...refresh, ...progress];
    for (const backgroundFirst of [false, true]) {
      const ordered = latticeOrderWave(rows, 4, backgroundFirst);
      const first = ordered.slice(0, 4);
      assert.strictEqual(
        first.filter((row) => row.pendingInputCount === 0).length,
        3,
      );
      assert.strictEqual(
        first.filter((row) => row.pendingInputCount > 0).length,
        1,
      );
      assert.true(
        first.includes(progress[0]),
        'a waiting reader gets prerequisite service',
      );
      assert.strictEqual(
        new Set(ordered).size,
        rows.length,
        'nothing lost or repeated',
      );
      assert.deepEqual(
        ordered.filter((row) => row.pendingInputCount > 0),
        refresh,
        'oldest refreshes keep their relative order',
      );
    }
    assert.strictEqual(latticeOrderWave(progress, 4).length, progress.length);
    assert.strictEqual(latticeOrderWave(refresh, 4).length, refresh.length);
    const bootstrap = { ...progress[0], stale: true as const };
    assert.true(
      latticeOrderWave([...refresh, bootstrap, ...progress.slice(1)], 4)
        .slice(0, 4)
        .includes(bootstrap),
      'first publications with settled inputs count as progress even in a stale wave',
    );
  });

  test('Stride pays actual service: costly refreshes cannot displace cheap input progress', (assert) => {
    const rows = [
      { ownerURL: realm + 'Input/one.json' },
      {
        ownerURL: realm + 'Board/one.json',
        stale: true as const,
        pendingInputCount: 10,
      },
    ];
    let state: LatticeServiceState | undefined;
    const spent = [0, 0];
    const counts = [0, 0];
    for (let i = 0; i < 2000; i++) {
      // Model one-owner waves on different workers; no process-local credit.
      const scheduler = new LatticeStride(rows, state);
      const work = scheduler.take()!;
      const kind = work.row.stale ? 1 : 0;
      const ms = kind ? 200 : 10;
      spent[kind] += ms;
      counts[kind]++;
      work.complete(ms);
      state = scheduler.state;
    }
    assert.true(
      Math.abs(spent[0] / spent[1] - 3) < 0.15,
      JSON.stringify(spent),
    );
    assert.true(
      counts[0] > counts[1] * 40,
      'service, not the number of jobs, is divided',
    );
    assert.true(
      counts[1] > 0,
      'refresh still receives service under sustained input load',
    );
  });

  test('urgent arrivals retain their service debt and sleepers gain no unlimited credit', (assert) => {
    const rows = [0, 1, 2].map((demand) => ({
      ownerURL: realm + `Input/${demand}.json`,
      demand: demand === 0 ? undefined : (demand as 1 | 2),
    }));
    let state: LatticeServiceState | undefined;
    const counts = [0, 0, 0];
    for (let i = 0; i < 700; i++) {
      const s = new LatticeStride(rows, state);
      const work = s.take()!;
      if (i === 0)
        assert.strictEqual(work.row.demand, 2, 'waiter wins initial tie');
      counts[work.row.demand ?? 0]++;
      work.complete(10);
      state = s.state;
    }
    assert.deepEqual(counts, [100, 200, 400]);
    for (let i = 0; i < 100; i++) {
      const s = new LatticeStride([rows[2]], state);
      s.take()!.complete(10);
      state = s.state;
    }
    const resumed = new LatticeStride(rows, state);
    assert.true(
      resumed.state.pools.progress.accounts['0'].pass >=
        state!.pools.progress.clock,
    );
    assert.true(
      resumed.state.pools.progress.accounts['1'].pass >=
        state!.pools.progress.clock,
    );
  });

  test('in-flight service is reserved; small waves rotate equally eligible owners', (assert) => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ownerURL: realm + `Input/${i}.json`,
    }));
    const mixed = new LatticeStride([
      ...rows,
      ...rows.map((row) => ({
        ...row,
        ownerURL: row.ownerURL + 'refresh',
        stale: true as const,
        pendingInputCount: 12,
      })),
    ]);
    const active = Array.from({ length: 4 }, () => mixed.take()!);
    assert.strictEqual(
      active.filter(({ row }) => 'stale' in row && row.stale).length,
      1,
    );
    for (const work of active) work.complete(10);
    assert.throws(() => active[0].complete(10), /charged twice/);
    let state: LatticeServiceState | undefined;
    const visited = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const s = new LatticeStride(rows, state);
      const work = s.take()!;
      visited.add(work.row.ownerURL);
      work.complete(100);
      state = s.state;
    }
    assert.strictEqual(
      visited.size,
      rows.length,
      'one-owner waves do not repeatedly refresh the same first owner',
    );
  });

  test('hundreds of same-type siblings cannot delay every board type behind a flat cursor', (assert) => {
    const rows = [
      ...Array.from({ length: 500 }, (_, i) => ({
        ownerURL: realm + `PlayerSeason/${i}.json`,
      })),
      ...['SeasonProgress', 'Standings', 'Quadrant'].map((type) => ({
        ownerURL: realm + `${type}/one.json`,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        ownerURL: realm + `Leaderboard/${i}.json`,
      })),
    ];
    let state: LatticeServiceState | undefined;
    const visited = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const s = new LatticeStride(rows, state);
      const work = s.take()!;
      visited.add(work.row.ownerURL);
      work.complete(100);
      state = s.state;
    }
    for (const type of ['SeasonProgress', 'Standings', 'Quadrant'])
      assert.true(visited.has(realm + `${type}/one.json`));
    assert.strictEqual(
      [...visited].filter((id) => id.includes('/PlayerSeason/')).length,
      5,
    );
    assert.strictEqual(
      [...visited].filter((id) => id.includes('/Leaderboard/')).length,
      5,
    );
  });

  test('service survives a worker change; an expired claim cannot replace the newer ledger', async (assert) => {
    const registry = new LatticeQueryRegistry(
      db,
      new IndexQueryEngine(
        db,
        {
          async lookupDefinition() {
            throw new Error('No definitions used by scheduling');
          },
        },
        new VirtualNetwork(),
      ),
    );
    const [job] = await db.execute(
      "INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args) VALUES('lattice-materialize',$1,8,600,$2) RETURNING id",
      { bind: ['lattice:' + realm, JSON.stringify({ realmURL: realm })] },
    );
    const [claim] = await db.execute(
      "INSERT INTO job_reservations(job_id,worker_id,locked_until) VALUES($1,'stride-first',clock_timestamp()+interval '10 minutes') RETURNING id",
      { bind: [job.id] },
    );
    const reservation = {
      jobId: Number(job.id),
      reservationId: Number(claim.id),
    };
    const s = new LatticeStride([{ ownerURL: realm + 'Input/one.json' }]);
    s.take()!.complete(275);
    await registry.saveSchedulingState(realm, s.state, reservation);
    const peer = new PgAdapter();
    try {
      const successor = new LatticeQueryRegistry(
        peer,
        new IndexQueryEngine(
          peer,
          {
            async lookupDefinition() {
              throw new Error('No definitions used by scheduling');
            },
          },
          new VirtualNetwork(),
        ),
      );
      assert.deepEqual(await successor.schedulingState(realm), s.state);
      assert.strictEqual(
        await successor.schedulingState(realm + 'other/'),
        undefined,
      );
      await db.execute(
        "UPDATE job_reservations SET locked_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        { bind: [claim.id] },
      );
      await assert.rejects(
        registry.saveSchedulingState(
          realm,
          { version: 1, pools: {} },
          reservation,
        ),
        /reservation no longer current/,
      );
      assert.deepEqual(
        await successor.schedulingState(realm),
        s.state,
        'fenced writer leaves measured service intact',
      );
    } finally {
      await peer.close();
    }
  });

  test('Postgres fans out bounded read hints without database rows or rebroadcast loops', async (assert) => {
    const peer = new PgAdapter();
    const receiver = latticeDemandFor(peer);
    try {
      await receiver.listen();
      await recordLatticeReadDemand(
        db,
        realm,
        '@reader:example',
        [realm + 'Game/one'],
        2,
      );
      const transport = latticeDemandFor(db);
      const firstExpiry = transport.local.values()[0].expires;
      await recordLatticeReadDemand(
        db,
        realm,
        '@reader:example',
        [realm + 'Game/one'],
        2,
      );
      assert.strictEqual(
        transport.local.values()[0].expires,
        firstExpiry,
        'frequent polling reuses the lease instead of broadcasting per request',
      );
      // NOTIFY and this barrier are delivered in commit order on one sender.
      let resolve!: () => void;
      const delivered = new Promise<void>((done) => {
        resolve = done;
      });
      const barrier = await peer.subscribe('lattice_demand_test_barrier', () =>
        resolve(),
      );
      try {
        await transport.flush();
        await db.notify('lattice_demand_test_barrier', 'done');
        await delivered;
      } finally {
        await barrier.unsubscribe();
      }
      assert.strictEqual(
        receiver.cache.priorities(realm).get(realm + 'Game/one.json'),
        2,
      );
      assert.strictEqual(
        receiver.local.values().length,
        0,
        'remote hints cannot echo into outgoing hints',
      );
      assert.false(
        JSON.stringify(transport.local.values()).includes('@reader:example'),
        'actor identities are hashed before broadcast',
      );
      await db.notify(LATTICE_DEMAND_CHANNEL, '{malformed');
      assert.strictEqual(
        receiver.cache.priorities(realm).size,
        1,
        'malformed advice cannot clear valid demand',
      );
    } finally {
      await peer.close();
    }
  });
});
