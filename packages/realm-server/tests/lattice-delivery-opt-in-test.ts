import { randomUUID } from 'node:crypto';
import QUnit from 'qunit';
import { PgAdapter } from '@cardstack/postgres';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import {
  recordLatticePublication,
  type LatticePublicationEvent,
} from '@cardstack/runtime-common/lattice-publication-outbox';
import {
  claimPublicationDeliveries,
  LatticePublicationDispatcher,
  type PublicationDelivery,
} from '../lib/lattice-publication-dispatcher.ts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const enabled = 'https://lattice-delivery-gate.example/enabled/';
const ordinary = 'https://lattice-delivery-gate.example/ordinary/';
const child = enabled + 'child/';
const actor = '@reader:example';
const lattice = new LatticeRealmConfig([enabled]);

class ObservedAdapter extends PgAdapter {
  statements: string[] = [];
  subscriptions: string[] = [];
  failNextAuthorization = false;

  override async execute(...args: Parameters<PgAdapter['execute']>) {
    this.statements.push(args[0]);
    if (this.failNextAuthorization && args[0].includes('LEFT JOIN users')) {
      this.failNextAuthorization = false;
      throw new Error('Injected authorization read failure');
    }
    return super.execute(...args);
  }

  override async subscribe(...args: Parameters<PgAdapter['subscribe']>) {
    this.subscriptions.push(args[0]);
    return super.subscribe(...args);
  }
}

module('Lattice | publication delivery opt-in', function (hooks) {
  let db: PgAdapter;
  let observed: ObservedAdapter;
  let dispatchers: LatticePublicationDispatcher[];
  let sent: { realm: string; event: LatticePublicationEvent }[];
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      observed = new ObservedAdapter();
      dispatchers = [];
      sent = [];
      await db.execute(
        'INSERT INTO users(matrix_user_id,session_room_id) VALUES ($1,$2)',
        { bind: [actor, '!reader:example'] },
      );
    },
    afterEach: async () => {
      for (const dispatcher of dispatchers) await dispatcher.shutDown();
      await observed.close();
    },
  });

  function dispatcher(config?: LatticeRealmConfig) {
    const opts = {
      dbAdapter: observed,
      lattice: config,
      send: async (
        realm: string,
        _room: string,
        event: LatticePublicationEvent,
      ) => {
        sent.push({ realm, event });
        return '$ack-' + event.publicationId;
      },
    };
    const result = new LatticePublicationDispatcher(opts);
    dispatchers.push(result);
    return result;
  }

  async function publish(realmURL: string) {
    await db.execute(
      `INSERT INTO realm_user_permissions(realm_url,username,read,write)
       VALUES ($1,$2,TRUE,FALSE) ON CONFLICT DO NOTHING`,
      { bind: [realmURL, actor] },
    );
    return db.withWriteLock('lattice:index:' + realmURL, async (tx) => {
      if (!tx) throw new Error('Expected pinned publication transaction');
      return recordLatticePublication(tx, {
        realmURL,
        ownerURL: realmURL + 'Day/one.json',
        realmGeneration: 2,
      });
    });
  }

  const rows = () =>
    db.execute(`SELECT e.realm_url,d.publication_id,d.attempts,d.lease_token,
      d.delivered_at,d.terminal_reason FROM lattice_publication_deliveries d
      JOIN lattice_publication_events e ON e.id=d.publication_id ORDER BY e.realm_url`);

  for (const [label, config] of [
    ['absent', undefined],
    ['empty', new LatticeRealmConfig()],
  ] as const) {
    test(`${label} policy leaves startup and direct entry points free of publication work`, async (assert) => {
      const id = await publish(enabled);
      const instance = dispatcher(config);
      const fake: PublicationDelivery = {
        publication_id: id,
        user_id: actor,
        room_id: '!reader:example',
        lease_token: randomUUID(),
        realm_url: enabled,
        payload: {
          eventName: 'index',
          realmURL: enabled,
          invalidations: [enabled + 'Day/one.json'],
          generation: 2,
          publicationId: id,
        },
        attempts: 1,
        queue_age_ms: 0,
      };
      await instance.start();
      instance.wake();
      await instance.shutDown();
      assert.strictEqual(await instance.drain(), 0);
      await instance.deliver(fake);
      assert.deepEqual(
        await claimPublicationDeliveries(observed, 1, config),
        [],
      );
      assert.deepEqual(observed.subscriptions, [], 'no LISTEN subscription');
      assert.deepEqual(
        observed.statements,
        [],
        'no claims, authorization reads or pruning',
      );
      assert.deepEqual(sent, [], 'no mounting/sending callback');
      const [row] = await rows();
      assert.strictEqual(row.attempts, 0);
      assert.strictEqual(row.lease_token, null);
      assert.strictEqual(row.delivered_at, null);
    });
  }

  test('mixed claims filter exact realm roots before capacity and leave other obligations for enabled workers', async (assert) => {
    const ordinaryId = await publish(ordinary);
    await publish(child);
    const enabledId = await publish(enabled);
    await db.execute(
      `UPDATE lattice_publication_deliveries SET next_attempt_at=now()-interval '1 day'
       WHERE publication_id<>$1`,
      { bind: [enabledId] },
    );
    // The event's database realm, not authored payload data, selects capacity.
    await db.execute(
      `UPDATE lattice_publication_events SET payload=jsonb_set(payload,'{realmURL}',to_jsonb($1::text))
       WHERE id=$2`,
      { bind: [enabled, ordinaryId] },
    );
    const claims = await claimPublicationDeliveries(observed, 1, lattice);
    assert.deepEqual(
      claims.map((c) => c.publication_id),
      [enabledId],
    );
    const instance = dispatcher(lattice);
    for (const claim of claims) await instance.deliver(claim);
    assert.strictEqual(
      await instance.drain(),
      0,
      'disabled backlog consumes no further slot',
    );
    assert.deepEqual(
      sent.map((s) => s.realm),
      [enabled],
    );
    assert.true(
      (await rows())
        .filter((r) => r.realm_url !== enabled)
        .every(
          (r) =>
            r.attempts === 0 &&
            r.lease_token === null &&
            r.delivered_at === null,
        ),
    );

    await db.execute(
      `UPDATE lattice_publication_events SET payload=jsonb_set(payload,'{realmURL}',to_jsonb(realm_url))
       WHERE id=$1`,
      { bind: [ordinaryId] },
    );
    const replacement = dispatcher(new LatticeRealmConfig([ordinary, child]));
    assert.strictEqual(await replacement.drain(), 2);
    assert.strictEqual(await replacement.drain(), 0);
    assert.deepEqual(
      sent.map((s) => s.realm).sort(),
      [enabled, ordinary, child].sort(),
    );
    assert.true(
      (await rows()).every((r) => r.attempts === 1 && !!r.delivered_at),
    );
  });

  test('retention prunes only completed enabled events and preserves pending work', async (assert) => {
    const enabledDone = await publish(enabled);
    const ordinaryDone = await publish(ordinary);
    const enabledPending = await publish(enabled);
    const ordinaryPending = await publish(ordinary);
    await db.execute(
      `UPDATE lattice_publication_deliveries SET delivered_at=now() WHERE publication_id IN ($1,$2)`,
      { bind: [enabledDone, ordinaryDone] },
    );
    await db.execute(
      `UPDATE lattice_publication_events SET created_at=now()-interval '2 days'`,
    );
    await db.execute(
      `UPDATE lattice_publication_deliveries SET next_attempt_at=now()+interval '1 hour'`,
    );
    assert.strictEqual(await dispatcher(lattice).drain(), 0);
    assert.deepEqual(
      (await db.execute('SELECT id FROM lattice_publication_events'))
        .map((r) => r.id)
        .sort(),
      [ordinaryDone, enabledPending, ordinaryPending].sort(),
    );
    assert.deepEqual(sent, []);
  });

  test('a supplied enabled realm cannot authorize a claim from a disabled stored event', async (assert) => {
    await publish(ordinary);
    const [claim] = await claimPublicationDeliveries(
      db,
      1,
      new LatticeRealmConfig([ordinary]),
    );
    const instance = dispatcher(lattice);
    await instance.deliver({
      ...claim,
      realm_url: enabled,
      payload: { ...claim.payload, realmURL: enabled },
    });
    assert.deepEqual(sent, []);
    const [untouched] = await rows();
    assert.strictEqual(untouched.lease_token, claim.lease_token);
    assert.strictEqual(untouched.delivered_at, null);
    assert.strictEqual(untouched.terminal_reason, null);
    observed.failNextAuthorization = true;
    await instance.deliver({
      ...claim,
      realm_url: enabled,
      payload: { ...claim.payload, realmURL: enabled },
    });
    assert.deepEqual(
      await rows(),
      [untouched],
      'a failed lookup cannot release or mutate another realm’s lease',
    );
    assert.deepEqual(sent, []);
    await dispatcher(new LatticeRealmConfig([ordinary])).deliver(claim);
    assert.deepEqual(
      sent.map((s) => s.realm),
      [ordinary],
    );
  });

  test('delivery uses the authorized stored event, not a supplied replacement payload', async (assert) => {
    await publish(enabled);
    const [claim] = await claimPublicationDeliveries(db, 1, lattice);
    await dispatcher(lattice).deliver({
      ...claim,
      payload: { ...claim.payload, realmURL: ordinary, generation: 999 },
    });
    assert.deepEqual(sent, [{ realm: enabled, event: claim.payload }]);
    assert.ok((await rows())[0].delivered_at);
  });

  test('a mismatched stored identity waits for repair without sending or acknowledging', async (assert) => {
    const id = await publish(enabled);
    const instance = dispatcher(lattice);
    for (const [field, value] of [
      ['realmURL', ordinary],
      ['publicationId', randomUUID()],
    ]) {
      await db.execute(
        `UPDATE lattice_publication_events SET payload=jsonb_set(
          jsonb_set(payload,'{realmURL}',to_jsonb(realm_url)),ARRAY[$1],to_jsonb($2::text)) WHERE id=$3`,
        { bind: [field, value, id] },
      );
      await db.execute(
        `UPDATE lattice_publication_deliveries SET next_attempt_at=now()-interval '1 second'`,
      );
      assert.strictEqual(await instance.drain(), 1);
      assert.deepEqual(sent, []);
      const [row] = await rows();
      assert.strictEqual(row.delivered_at, null);
      assert.strictEqual(row.terminal_reason, null);
      assert.strictEqual(row.lease_token, null, 'failed send is retryable');
    }
    await db.execute(
      `UPDATE lattice_publication_events SET payload=jsonb_set(payload,'{publicationId}',to_jsonb(id::text)) WHERE id=$1`,
      { bind: [id] },
    );
    await db.execute(
      `UPDATE lattice_publication_deliveries SET next_attempt_at=now()-interval '1 second'`,
    );
    assert.strictEqual(await instance.drain(), 1);
    assert.deepEqual(
      sent.map((s) => s.realm),
      [enabled],
    );
    assert.strictEqual(sent[0].event.publicationId, id);
    assert.ok((await rows())[0].delivered_at);
  });
});
