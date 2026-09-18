import QUnit from 'qunit';
import { basename } from 'node:path';
import { createServer } from 'node:http';
import { PgAdapter } from '@cardstack/postgres';
import {
  Deferred,
  param,
  query,
  type Querier,
} from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  recordLatticePublication,
  LATTICE_PUBLICATION_CHANNEL,
  type LatticePublicationEvent,
} from '@cardstack/runtime-common/lattice-publication-outbox';
import {
  claimPublicationDeliveries,
  LatticePublicationDispatcher,
} from '../lib/lattice-publication-dispatcher.ts';
import { setupDB } from './helpers/index.ts';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';

const { module, test } = QUnit;
const realmURL = 'http://lattice-delivery.example/';
const lattice = new LatticeRealmConfig([realmURL]);
const ownerURL = realmURL + 'Day/one.json';
const authority = {
  version: 1 as const,
  realmURL,
  ownerURL,
  realmGeneration: 2,
  indexedGeneration: 2,
  publishedGeneration: 2,
  definitionRevision: 'code-1',
};

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      for (let name of ['a', 'b', 'outsider']) {
        await query(db, [
          'INSERT INTO users (matrix_user_id, session_room_id) VALUES (',
          param('@' + name + ':example'),
          ',',
          param('!' + name + ':example'),
          ')',
        ]);
      }
      for (let name of ['a', 'b']) {
        await query(db, [
          'INSERT INTO realm_user_permissions (realm_url, username, read, write) VALUES (',
          param(realmURL),
          ',',
          param('@' + name + ':example'),
          ', TRUE, FALSE)',
        ]);
      }
    },
  });

  async function publish(extra?: (tx: Querier) => Promise<void>) {
    return db.withWriteLock('lattice:index:' + realmURL, async (tx) => {
      if (!tx) throw new Error('Expected pinned PG transaction');
      let id = await recordLatticePublication(tx, authority);
      await extra?.(tx);
      return id;
    });
  }
  async function change(
    owner: string,
    generation: number,
    kind: LatticePublicationEvent['eventName'] = 'index',
  ) {
    return db.withWriteLock('lattice:index:' + realmURL, async (tx) => {
      if (!tx) throw new Error('Expected pinned PG transaction');
      return recordLatticePublication(
        tx,
        {
          ...authority,
          ownerURL: realmURL + owner,
          realmGeneration: generation,
        },
        kind,
      );
    });
  }

  test('pending revisions coalesce without losing distinct owners or inventing their generations', async function (assert) {
    await change('Day/one.json', 2);
    await change('Day/one.json', 3);
    await change('Day/two.json', 3);
    await change('Day/three.json', 2);
    let sent: { room: string; event: LatticePublicationEvent }[] = [];
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async (_realm, room, event) => {
        sent.push({ room, event });
        return '$ack';
      },
    });
    while (await dispatcher.drain()) {
      /* drain bounded batches */
    }
    assert.strictEqual(
      sent.length,
      4,
      'two generation-accurate envelopes per recipient instead of four',
    );
    for (let room of ['!a:example', '!b:example']) {
      let events = sent.filter((s) => s.room === room).map((s) => s.event);
      assert.deepEqual(
        events
          .map((e) => ({
            generation: e.generation,
            ids: e.invalidations.slice().sort(),
          }))
          .sort((a, b) => a.generation - b.generation),
        [
          { generation: 2, ids: [realmURL + 'Day/three.json'] },
          {
            generation: 3,
            ids: [realmURL + 'Day/one.json', realmURL + 'Day/two.json'],
          },
        ],
      );
    }
    assert.true((await rows()).every((r) => !!r.delivered_at));
  });

  test('a failed coalesced send retries the identical envelope and acknowledges every covered row only on success', async function (assert) {
    await change('Day/one.json', 2);
    await change('Day/two.json', 2);
    let fail = true;
    let sent: { room: string; event: LatticePublicationEvent }[] = [];
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async (_realm, room, event) => {
        sent.push({ room, event });
        if (room === '!b:example' && fail)
          throw new Error('lost acknowledgement');
        return '$ack';
      },
    });
    await dispatcher.drain();
    assert.strictEqual(sent.length, 2, 'one envelope per recipient');
    assert.true(
      (await rows())
        .filter((r) => r.user_id === '@a:example')
        .every((r) => !!r.delivered_at),
    );
    assert.true(
      (await rows())
        .filter((r) => r.user_id === '@b:example')
        .every((r) => r.delivered_at === null),
    );
    fail = false;
    await due();
    await dispatcher.drain();
    assert.deepEqual(
      sent.filter((s) => s.room === '!b:example').map((s) => s.event),
      [
        sent.find((s) => s.room === '!b:example')!.event,
        sent.find((s) => s.room === '!b:example')!.event,
      ],
    );
    assert.strictEqual(sent.length, 3);
    assert.true((await rows()).every((r) => !!r.delivered_at));
  });

  test('new changes accumulate behind an in-flight recipient without a lost ID', async function (assert) {
    await change('Day/one.json', 2);
    let first = await claimPublicationDeliveries(db, undefined, lattice);
    await change('Day/two.json', 3);
    await change('Day/three.json', 3);
    assert.deepEqual(
      await claimPublicationDeliveries(db, undefined, lattice),
      [],
      'leased recipients do not get a second concurrent batch',
    );
    let sent: LatticePublicationEvent[] = [];
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async (_realm, _room, event) => {
        sent.push(event);
        return '$ack';
      },
    });
    for (let claim of first) await dispatcher.deliver(claim);
    await dispatcher.drain();
    assert.strictEqual(
      sent.length,
      4,
      'one initial and one follow-up per recipient',
    );
    assert.true(
      sent
        .filter((e) => e.generation === 3)
        .every((e) => e.invalidations.length === 2),
    );
    assert.true((await rows()).every((r) => !!r.delivered_at));
  });

  test('coalescing keeps HTML readiness separate and spills a large burst without losing identities', async function (assert) {
    for (let i = 0; i < 70; i++) await change('Day/' + i + '.json', 2);
    await change('Day/0.json', 2, 'prerender_html');
    let sent: LatticePublicationEvent[] = [];
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async (_realm, _room, event) => {
        sent.push(event);
        return '$ack';
      },
    });
    let passes = 0;
    while (await dispatcher.drain()) {
      if (++passes > 20) throw new Error('Unbounded drain');
    }
    let data = sent.filter((e) => e.eventName === 'index');
    assert.true(data.length < 20, 'bounded envelopes replace per-card sends');
    assert.true(
      data.every((e) => e.invalidations.length <= 64),
      'bounded identities',
    );
    assert.strictEqual(new Set(data.flatMap((e) => e.invalidations)).size, 70);
    assert.strictEqual(
      sent.filter((e) => e.eventName === 'prerender_html').length,
      2,
    );
    assert.true((await rows()).every((r) => !!r.delivered_at));
  });

  test('large identities split below the wire budget without losing a card', async function (assert) {
    for (let i = 0; i < 30; i++)
      await change('Day/' + i + 'x'.repeat(2000) + '.json', 2);
    let sent: LatticePublicationEvent[] = [];
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async (_realm, _room, event) => {
        sent.push(event);
        return '$ack';
      },
    });
    let passes = 0;
    while (await dispatcher.drain()) {
      if (++passes > 10) throw new Error('Unbounded drain');
    }
    assert.true(
      sent.every(
        (event) => Buffer.byteLength(JSON.stringify(event)) <= 48 * 1024,
      ),
    );
    assert.strictEqual(new Set(sent.flatMap((e) => e.invalidations)).size, 30);
    assert.true((await rows()).every((r) => !!r.delivered_at));
  });

  test('a new publication joining a failed batch gets a new transaction ID with complete coverage', async function (assert) {
    await change('Day/one.json', 2);
    await change('Day/two.json', 2);
    let attempts: LatticePublicationEvent[] = [];
    let fail = true;
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async (_realm, room, event) => {
        if (room === '!b:example') {
          attempts.push(event);
          if (fail) throw new Error('ambiguous response');
        }
        return '$ack';
      },
    });
    await dispatcher.drain();
    await change('Day/three.json', 2);
    fail = false;
    await due();
    await dispatcher.drain();
    assert.strictEqual(attempts.length, 2);
    assert.notStrictEqual(attempts[0].publicationId, attempts[1].publicationId);
    assert.deepEqual(
      attempts[1].invalidations.slice().sort(),
      ['one', 'three', 'two'].map((n) => realmURL + 'Day/' + n + '.json'),
    );
    assert.true((await rows()).every((r) => !!r.delivered_at));
  });

  test('one slow recipient does not hold the other delivery slots', async function (assert) {
    for (let i = 0; i < 4; i++) await publish();
    let started = new Deferred<void>(),
      release = new Deferred<void>(),
      others = new Deferred<void>();
    let waiting = false,
      completed = 0;
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async () => {
        if (!waiting) {
          waiting = true;
          started.fulfill();
          await release.promise;
        } else if (++completed === 1) {
          others.fulfill();
        }
        return '$ack';
      },
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await dispatcher.start();
      await started.promise;
      await Promise.race([
        others.promise,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new Error('Independent delivery slots stalled')),
            2000,
          );
        }),
      ]);
      assert.strictEqual(
        completed,
        1,
        'the other recipient gets all four publications in one send before the held send completes',
      );
    } finally {
      clearTimeout(deadline);
      release.fulfill();
      await dispatcher.shutDown();
    }
  });

  async function rows() {
    return query(db, [
      `SELECT publication_id, user_id, room_id, attempts, delivered_at, event_id,
        terminal_reason, last_error FROM lattice_publication_deliveries ORDER BY user_id`,
    ]);
  }
  async function due() {
    await query(db, [
      `UPDATE lattice_publication_deliveries SET next_attempt_at = now() - interval '1 second'`,
    ]);
  }

  test('publication rollback also rolls back recipient obligations and wakeup; committed audience excludes unauthorized sessions', async function (assert) {
    let notices: string[] = [];
    let sub = await db.subscribe(LATTICE_PUBLICATION_CHANNEL, () =>
      notices.push('notice'),
    );
    try {
      await assert.rejects(
        publish(async () => {
          throw new Error('publication rollback');
        }),
        /publication rollback/,
      );
      assert.deepEqual(await rows(), []);
      assert.deepEqual(
        await query(db, ['SELECT id FROM lattice_publication_events']),
        [],
      );
      await publish();
      assert.deepEqual(
        (await rows()).map((r) => r.user_id),
        ['@a:example', '@b:example'],
      );
      // A barrier NOTIFY on the same connection confirms the earlier commit
      // was consumed; rollback cannot have emitted the publication wakeup.
      let barrier = new Deferred<void>();
      let barrierSub = await db.subscribe('lattice_test_barrier', () =>
        barrier.fulfill(),
      );
      try {
        await db.notify('lattice_test_barrier', 'done');
        await barrier.promise;
        assert.strictEqual(notices.length, 1);
      } finally {
        await barrierSub.unsubscribe();
      }
    } finally {
      await sub.unsubscribe();
    }
  });

  test('exhausted delivery becomes an explicit terminal failure and releases retention', async (assert) => {
    await publish();
    await db.execute('UPDATE lattice_publication_deliveries SET attempts=19');
    await db.execute(
      "UPDATE lattice_publication_events SET created_at=now()-interval '2 days'",
    );
    let sent = 0;
    const dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async () => {
        sent++;
        throw new Error('transport unavailable');
      },
    });
    const claims = await claimPublicationDeliveries(db, 4, lattice);
    for (const claim of claims) await dispatcher.deliver(claim);
    assert.strictEqual(sent, 2, 'each recipient gets the final attempt');
    const terminal = await rows();
    assert.strictEqual(terminal.length, 2);
    assert.true(
      terminal.every(
        (row) => row.terminal_reason === 'delivery retry budget exhausted',
      ),
    );
    assert.true(
      terminal.every((row) => row.delivered_at == null),
      'failure is not an acknowledgement',
    );
    assert.strictEqual(await dispatcher.drain(), 0);
    assert.deepEqual(
      await rows(),
      [],
      'terminal deliveries no longer pin expired events',
    );
  });

  test('recipient failure does not acknowledge it or resend the successful recipient; retry uses the same publication ID', async function (assert) {
    let id = await publish();
    let fail = true;
    let attempts: string[] = [];
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async (_realm, room, event) => {
        attempts.push(room + '/' + event.publicationId);
        if (room === '!b:example' && fail) throw new Error('lost Matrix reply');
        return '$' + room;
      },
    });
    await dispatcher.drain();
    let [a, b] = await rows();
    assert.ok(a.delivered_at);
    assert.strictEqual(b.delivered_at, null);
    assert.true(String(b.last_error).includes('lost Matrix reply'));
    fail = false;
    await due();
    await dispatcher.drain();
    assert.deepEqual(
      attempts.sort(),
      ['!a:example/' + id, '!b:example/' + id, '!b:example/' + id].sort(),
    );
    assert.true((await rows()).every((r) => !!r.delivered_at));
  });

  test('parallel dispatchers cannot claim the same obligation and an expired sender cannot acknowledge its replacement', async function (assert) {
    await publish();
    await publish();
    await publish();
    let other = new PgAdapter();
    try {
      let [one, two] = await Promise.all([
        claimPublicationDeliveries(db, undefined, lattice),
        claimPublicationDeliveries(other, undefined, lattice),
      ]);
      assert.strictEqual(one.length + two.length, 2);
      assert.strictEqual(
        new Set([...one, ...two].map((c) => c.user_id)).size,
        2,
      );
      let old = [...one, ...two][0];
      let entered = new Deferred<void>(),
        release = new Deferred<void>();
      let stale = new LatticePublicationDispatcher({
        lattice,
        dbAdapter: db,
        send: async () => {
          entered.fulfill();
          await release.promise;
          return '$old';
        },
      });
      let sending = stale.deliver(old);
      await entered.promise;
      try {
        await query(db, [
          `UPDATE lattice_publication_deliveries SET lease_until = now() - interval '1 second'`,
        ]);
        let replacement = new LatticePublicationDispatcher({
          lattice,
          dbAdapter: other,
          send: async () => '$replacement',
        });
        await replacement.drain();
      } finally {
        release.fulfill();
      }
      await sending;
      assert.true((await rows()).every((r) => r.event_id === '$replacement'));
    } finally {
      await other.close();
    }
  });

  test('delivery rechecks access and session rotation; missing room waits for repair', async function (assert) {
    await publish();
    await query(db, [
      `UPDATE realm_user_permissions SET read = FALSE WHERE username = '@a:example'`,
    ]);
    await query(db, [
      `UPDATE users SET session_room_id = NULL WHERE matrix_user_id = '@b:example'`,
    ]);
    let sent: string[] = [];
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async (_realm, room) => {
        sent.push(room);
        return '$ack';
      },
    });
    await dispatcher.drain();
    let [a, b] = await rows();
    assert.deepEqual(sent, []);
    assert.ok(a.terminal_reason);
    assert.strictEqual(a.delivered_at, null, 'revocation is not delivery');
    assert.strictEqual(b.terminal_reason, null);
    assert.true(String(b.last_error).includes('no current session'));
    await query(db, [
      `UPDATE users SET session_room_id = '!replacement:example' WHERE matrix_user_id = '@b:example'`,
    ]);
    await due();
    await dispatcher.drain();
    assert.deepEqual(sent, ['!replacement:example']);
    assert.strictEqual((await rows())[1].room_id, '!replacement:example');
  });

  test('restart drains a committed publication even when its notification was missed', async function (assert) {
    await publish();
    let received = new Deferred<void>();
    let count = 0;
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async () => {
        if (++count === 2) received.fulfill();
        return '$received';
      },
    });
    try {
      await dispatcher.start();
      await received.promise;
    } finally {
      await dispatcher.shutDown();
    }
    assert.true((await rows()).every((r) => !!r.delivered_at));
    assert.strictEqual(count, 2);
  });

  test('NOTIFY wakes the independent dispatcher after publication; completed retention never removes pending recipients', async function (assert) {
    let received = new Deferred<void>(),
      count = 0;
    let dispatcher = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async () => {
        if (++count === 2) received.fulfill();
        return '$received';
      },
    });
    try {
      await dispatcher.start();
      await publish();
      await received.promise;
    } finally {
      await dispatcher.shutDown();
    }
    await query(db, [
      `UPDATE lattice_publication_events SET created_at = now() - interval '2 days'`,
    ]);
    let pendingId = await publish();
    await query(db, [
      `UPDATE lattice_publication_events SET created_at = now() - interval '2 days' WHERE id =`,
      param(pendingId),
    ]);
    let unavailable = new LatticePublicationDispatcher({
      lattice,
      dbAdapter: db,
      send: async () => {
        throw new Error('offline');
      },
    });
    await unavailable.drain();
    assert.deepEqual(
      (await query(db, ['SELECT id FROM lattice_publication_events'])).map(
        (r) => r.id,
      ),
      [pendingId],
    );
  });

  test('Matrix wire retries reuse the same transaction path and require an event acknowledgement', async function (assert) {
    let puts: string[] = [],
      paths = new Map<string, string>();
    let server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      req.resume();
      if (req.url?.endsWith('/login')) {
        res.end(
          JSON.stringify({
            access_token: 'synthetic-token',
            device_id: 'synthetic-device',
            user_id: '@realm:example',
          }),
        );
        return;
      }
      puts.push(req.url!);
      if (!paths.has(req.url!)) paths.set(req.url!, '$' + paths.size);
      res.end(JSON.stringify({ event_id: paths.get(req.url!) }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      let address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('No test address');
      let client = new MatrixClient({
        matrixURL: new URL('http://127.0.0.1:' + address.port + '/'),
        username: 'synthetic',
        password: 'synthetic',
      });
      await client.login();
      let first = await client.sendEvent(
        '!room:example',
        'app.boxel.realm-event',
        { publicationId: 'one' },
        { transactionId: 'publication/one' },
      );
      let again = await client.sendEvent(
        '!room:example',
        'app.boxel.realm-event',
        { publicationId: 'one' },
        { transactionId: 'publication/one' },
      );
      assert.strictEqual(first, again);
      assert.strictEqual(puts[0], puts[1]);
      assert.true(puts[0].endsWith('/publication%2Fone'));
      await client.sendEvent('!room:example', 'app.boxel.realm-event', {});
      assert.notStrictEqual(
        puts[2],
        puts[1],
        'ordinary callers still get their own transaction IDs',
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
