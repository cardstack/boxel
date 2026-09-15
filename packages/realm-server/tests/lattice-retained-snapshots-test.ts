import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import type { Querier } from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import {
  LatticeRetainedSnapshots,
  type LatticeSnapshotChange,
  type LatticeSnapshotLink,
} from '@cardstack/runtime-common/lattice-retained-snapshots';
import { setupDB, waitUntil } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://retained.example/school/';
const sourceRealm = 'https://source.example/resources/';
const link: LatticeSnapshotLink = {
  realmURL: realm,
  ownerURL: realm + 'Classroom/blue',
  fieldPath: 'wall',
  source: { realmURL: sourceRealm, url: sourceRealm + 'Wall/one' },
};
const config = new LatticeRealmConfig([realm]);
const document = (title = 'Last wall') =>
  JSON.stringify({
    data: {
      id: link.source.url,
      type: 'card',
      attributes: { title, count: 7 },
      meta: { adoptsFrom: { module: sourceRealm + 'wall', name: 'Wall' } },
    },
  });
const capture = (
  version = 1,
  generation = version,
  target = link,
): Extract<LatticeSnapshotChange, { kind: 'capture' }> => ({
  kind: 'capture',
  link: target,
  consumerGeneration: generation,
  validatedThrough: version,
  definitionSeal: 'producer-fingerprint',
  document: document(),
});

module('Lattice | retained snapshots', function (hooks) {
  let db: PgAdapter;
  let snapshots: LatticeRetainedSnapshots;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      snapshots = new LatticeRetainedSnapshots(config, (expression) =>
        db.withConnection((tx) => tx(expression)),
      );
    },
  });

  async function transaction(work: (tx: Querier) => Promise<void>) {
    await db.withConnection(async (tx) => {
      await tx(['BEGIN']);
      try {
        await work(tx);
        await tx(['COMMIT']);
      } catch (error) {
        await tx(['ROLLBACK']);
        throw error;
      }
    });
  }
  const change = (event: LatticeSnapshotChange) =>
    transaction((tx) => snapshots.recordChange(tx, event));

  test('complete durable bytes survive source index removal and availability transitions', async (assert) => {
    await change(capture());
    let initial = (await snapshots.read({ link }))!;
    assert.deepEqual(JSON.parse(initial.document), JSON.parse(document()));
    assert.strictEqual(initial.snapshot.kind, 'data');
    assert.strictEqual(initial.snapshot.by, 'consumer');
    assert.deepEqual(initial.snapshot.source, link.source);
    assert.true(initial.snapshot.digest.startsWith('sha256:'));
    assert.strictEqual(initial.snapshot.status, 'live');
    assert.strictEqual(initial.snapshot.since, undefined);
    let persistence = await db.execute(
      "SELECT relpersistence FROM pg_class WHERE relname IN ('lattice_retained_bodies','lattice_retained_snapshots')",
    );
    assert.true(
      persistence.every((row) => row.relpersistence === 'p'),
      'copies are logged, not a rebuildable cache',
    );
    await db.execute('DELETE FROM boxel_index');
    for (let [index, status] of [
      'unavailable',
      'forbidden',
      'incompatible',
      'live',
    ].entries()) {
      await change({
        kind: 'availability',
        link,
        consumerGeneration: index + 2,
        expected: initial.snapshot,
        status: status as 'unavailable' | 'forbidden' | 'incompatible' | 'live',
      });
      let result = (await snapshots.read({ link }))!;
      assert.strictEqual(
        result.document,
        initial.document,
        'status never changes captured bytes',
      );
      assert.strictEqual(result.snapshot.status, status);
      assert.strictEqual(
        result.snapshot.capturedAt,
        initial.snapshot.capturedAt,
      );
      assert.strictEqual(
        typeof result.snapshot.since,
        status === 'live' ? 'undefined' : 'string',
      );
    }
  });

  test('source versions order captures and equal-version conflicts cannot corrupt history', async (assert) => {
    await change(capture(5, 8));
    let first = (await snapshots.read({ link }))!;
    await change({ ...capture(4, 9), document: document('older source') });
    assert.deepEqual(await snapshots.read({ link }), first);
    await change({
      ...capture(6, 7),
      document: document('obsolete consumer job'),
    });
    assert.deepEqual(await snapshots.read({ link }), first);
    await assert.rejects(
      change({ ...capture(5, 10), document: document('conflict') }),
      /Conflicting snapshot/,
    );
    assert.deepEqual(await snapshots.read({ link }), first);
    await change(capture(6, 11));
    let next = (await snapshots.read({ link }))!;
    assert.strictEqual(next.snapshot.validatedThrough, 6);
    assert.strictEqual(
      next.snapshot.digest,
      first.snapshot.digest,
      'equal bytes may have a newer validated-through',
    );
    assert.strictEqual(
      (await db.execute('SELECT digest FROM lattice_retained_bodies')).length,
      1,
    );
    assert.strictEqual(
      (await db.execute('SELECT digest FROM lattice_retained_snapshots'))
        .length,
      1,
    );
  });

  test('delayed failures are fenced by consumer generation and expected source receipt', async (assert) => {
    await change(capture(1, 4));
    let first = (await snapshots.read({ link }))!;
    await change({
      kind: 'availability',
      link,
      consumerGeneration: 5,
      expected: first.snapshot,
      status: 'unavailable',
    });
    let unavailable = (await snapshots.read({ link }))!;
    await change({
      kind: 'availability',
      link,
      consumerGeneration: 6,
      expected: first.snapshot,
      status: 'unavailable',
    });
    assert.strictEqual(
      (await snapshots.read({ link }))!.snapshot.since,
      unavailable.snapshot.since,
      'same outage retains its start',
    );
    await change(capture(2, 7));
    await change({
      kind: 'availability',
      link,
      consumerGeneration: 8,
      expected: first.snapshot,
      status: 'forbidden',
    });
    let current = (await snapshots.read({ link }))!;
    assert.strictEqual(
      current.snapshot.status,
      'live',
      'old source receipt cannot mark a newer body',
    );
    await change({
      kind: 'availability',
      link,
      consumerGeneration: 6,
      expected: current.snapshot,
      status: 'unavailable',
    });
    assert.deepEqual(
      await snapshots.read({ link }),
      current,
      'older consumer result cannot mark the current copy',
    );
  });

  test('newest plus pinned copies survive pruning; bodies are shared and collected in bounded maintenance', async (assert) => {
    await change(capture());
    let pinned = (await snapshots.read({ link }))!;
    await change({
      kind: 'pin',
      link,
      consumerGeneration: 2,
      expected: pinned.snapshot,
      pinned: true,
      note: 'Sent with invoice',
    });
    await change({ ...capture(2, 3), document: document('second') });
    await change({ ...capture(3, 4), document: document('third') });
    let old = (await snapshots.read({ link, revision: 1 }))!;
    assert.true(old.snapshot.pinned);
    assert.strictEqual(old.snapshot.note, 'Sent with invoice');
    assert.strictEqual(await snapshots.read({ link, revision: 2 }), undefined);
    let other = { ...link, ownerURL: realm + 'Classroom/red' };
    await change({ ...capture(1, 4, other), document: document() });
    await change({
      kind: 'pin',
      link,
      consumerGeneration: 5,
      expected: pinned.snapshot,
      pinned: false,
    });
    assert.strictEqual(await snapshots.read({ link, revision: 1 }), undefined);
    await transaction((tx) => snapshots.collectUnreferenced(tx, realm));
    assert.strictEqual(
      (await db.execute('SELECT digest FROM lattice_retained_bodies')).length,
      2,
    );
    assert.ok(
      await snapshots.read({ link: other }),
      'another consumer keeps its copy of the shared bytes',
    );
    assert.strictEqual(
      (await snapshots.read({ link }))!.snapshot.validatedThrough,
      3,
    );
  });

  test('orphan-body collection is bounded and cannot remove referenced data', async (assert) => {
    await change(capture());
    await db.execute(
      `INSERT INTO lattice_retained_bodies (realm_url,digest,kind,document)
      SELECT $1, 'orphan-' || n, 'data', '{}'::jsonb FROM generate_series(1,300) n`,
      { bind: [realm] },
    );
    await transaction((tx) => snapshots.collectUnreferenced(tx, realm));
    let [first] = await db.execute(
      'SELECT count(*) AS count FROM lattice_retained_bodies',
    );
    assert.strictEqual(
      Number(first.count),
      45,
      'one maintenance transaction collects at most 256 bodies',
    );
    assert.ok(await snapshots.read({ link }));
    await transaction((tx) => snapshots.collectUnreferenced(tx, realm));
    let [second] = await db.execute(
      'SELECT count(*) AS count FROM lattice_retained_bodies',
    );
    assert.strictEqual(Number(second.count), 1);
    assert.ok(await snapshots.read({ link }));
  });

  test('disabled realms and field opt-out perform zero SQL and read no retained copy', async (assert) => {
    let sql = 0;
    let query: Querier = async () => {
      sql++;
      throw new Error('Unexpected SQL');
    };
    let disabled = new LatticeRetainedSnapshots(
      new LatticeRealmConfig(),
      query,
    );
    let enabled = new LatticeRetainedSnapshots(config, query);
    await disabled.recordChange(query, capture());
    assert.strictEqual(await disabled.read({ link }), undefined);
    await enabled.recordChange(
      query,
      capture(1, 1, { ...link, snapshot: false }),
    );
    assert.strictEqual(
      await enabled.read({ link: { ...link, snapshot: false } }),
      undefined,
    );
    await disabled.collectUnreferenced(query, realm);
    assert.strictEqual(sql, 0);
  });

  test('link and realm identity isolate copies even for the same source', async (assert) => {
    await change(capture());
    assert.strictEqual(
      await snapshots.read({ link: { ...link, fieldPath: 'otherWall' } }),
      undefined,
    );
    assert.strictEqual(
      await snapshots.read({
        link: { ...link, ownerURL: realm + 'Classroom/red' },
      }),
      undefined,
    );
    let otherRealm = realm + 'nested/';
    let other = {
      ...link,
      realmURL: otherRealm,
      ownerURL: otherRealm + 'Classroom/blue',
    };
    let otherReader = new LatticeRetainedSnapshots(
      new LatticeRealmConfig([otherRealm]),
      (expression) => db.withConnection((tx) => tx(expression)),
    );
    assert.strictEqual(await otherReader.read({ link: other }), undefined);
    await assert.rejects(
      change(
        capture(1, 1, { ...link, ownerURL: 'https://elsewhere.example/card' }),
      ),
      /outside its realm/,
    );
    await assert.rejects(
      change({ ...capture(), document: '{}' }),
      /source card document/,
    );
  });

  test('caller rollback removes bodies and metadata together', async (assert) => {
    await assert.rejects(
      transaction(async (tx) => {
        await snapshots.recordChange(tx, capture());
        throw new Error('synthetic publication failure');
      }),
      /synthetic publication failure/,
    );
    assert.strictEqual(await snapshots.read({ link }), undefined);
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
  });

  test('concurrent transactions for one link cannot let the older capture win', async (assert) => {
    let entered!: () => void;
    let release!: () => void;
    let ready = new Promise<void>((resolve) => (entered = resolve));
    let wait = new Promise<void>((resolve) => (release = resolve));
    let first = transaction(async (tx) => {
      await snapshots.recordChange(tx, capture(3, 3));
      entered();
      await wait;
    });
    await ready;
    let pid: number | undefined;
    let second = transaction(async (tx) => {
      let [backend] = await tx(['SELECT pg_backend_pid() AS pid']);
      pid = Number(backend.pid);
      await snapshots.recordChange(tx, {
        ...capture(2, 4),
        document: document('late older'),
      });
    });
    try {
      await waitUntil(
        async () => {
          if (pid === undefined) return false;
          let [activity] = await db.execute(
            'SELECT wait_event FROM pg_stat_activity WHERE pid=$1',
            { bind: [pid] },
          );
          return activity?.wait_event === 'advisory';
        },
        {
          timeout: 5000,
          timeoutMessage: 'Second capture did not wait on the link transaction',
        },
      );
      assert.true(
        true,
        'second process actually waits before inspecting the uncommitted link',
      );
    } finally {
      release();
      await Promise.all([first, second]);
    }
    assert.strictEqual(
      (await snapshots.read({ link }))!.snapshot.validatedThrough,
      3,
    );
    let [count] = await db.execute(
      'SELECT count(*) AS count FROM lattice_retained_snapshots WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.strictEqual(Number(count.count), 1);
  });
});
