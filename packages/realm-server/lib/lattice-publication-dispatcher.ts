import { randomUUID } from 'node:crypto';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';
import {
  logger,
  param,
  query,
  textArrayParam,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import type { LatticeDelivery } from '@cardstack/runtime-common/lattice-adapters';
import {
  LATTICE_PUBLICATION_CHANNEL,
  type LatticePublicationEvent,
} from '@cardstack/runtime-common/lattice-publication-outbox';

const log = logger('lattice-publication-delivery');
const leaseMs = 30_000;
const sendTimeoutMs = 10_000;
const concurrency = 4;

export interface PublicationDelivery {
  publication_id: string;
  user_id: string;
  room_id: string;
  lease_token: string;
  realm_url: string;
  payload: LatticePublicationEvent;
  attempts: number;
  queue_age_ms: number | string;
}

export async function claimPublicationDeliveries(
  db: PgAdapter,
  limit = concurrency,
  lattice?: LatticeRealmConfig,
): Promise<PublicationDelivery[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > concurrency) {
    throw new Error('Invalid publication claim capacity');
  }
  const realms = lattice?.enabledRealms;
  if (!realms?.length) return [];
  return (await query(db, [
    `WITH due AS (
       SELECT d.publication_id, d.user_id FROM lattice_publication_deliveries d
       JOIN lattice_publication_events e ON e.id = d.publication_id
       WHERE e.realm_url = ANY(`,
    textArrayParam([...realms]),
    `) AND d.delivered_at IS NULL AND d.terminal_reason IS NULL
         AND d.next_attempt_at <= now()
         AND (d.lease_until IS NULL OR d.lease_until <= now())
       ORDER BY d.next_attempt_at, d.publication_id, d.user_id
       LIMIT`,
    param(limit),
    `FOR UPDATE OF d SKIP LOCKED
     ), claimed AS (
       UPDATE lattice_publication_deliveries d SET
         lease_token =`,
    param(randomUUID()),
    `, lease_until = now() +`,
    param(leaseMs),
    `* interval '1 millisecond',
         attempts = attempts + 1
       FROM due WHERE d.publication_id = due.publication_id AND d.user_id = due.user_id
       RETURNING d.publication_id, d.user_id, d.room_id, d.lease_token, d.attempts
     ) SELECT c.publication_id, c.user_id, c.room_id, c.lease_token, c.attempts,
         e.realm_url, e.payload, EXTRACT(EPOCH FROM (now() - e.created_at)) * 1000 AS queue_age_ms
       FROM claimed c JOIN lattice_publication_events e ON e.id = c.publication_id`,
  ])) as unknown as PublicationDelivery[];
}

type Send = LatticeDelivery<LatticePublicationEvent>['send'];

// Network I/O is outside the publication transaction and outside render/source
// workers. SKIP LOCKED and an expiring fenced claim allow multiple server replicas.
export class LatticePublicationDispatcher {
  #db: PgAdapter;
  #send: Send;
  #lattice: LatticeRealmConfig;
  #realms: string[];
  #subscription?: NotificationSubscription;
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<void>;
  #starting?: Promise<void>;
  #stopped = true;
  #wakeRequested = false;
  #sends = new Set<AbortController>();
  #deliveries = new Set<Promise<void>>();
  #nextPruneAt = 0;

  constructor({
    dbAdapter,
    send,
    lattice = new LatticeRealmConfig(),
  }: {
    dbAdapter: PgAdapter;
    send: Send;
    lattice?: LatticeRealmConfig;
  }) {
    this.#db = dbAdapter;
    this.#send = send;
    this.#lattice = lattice;
    this.#realms = [...lattice.enabledRealms];
  }

  async start(): Promise<void> {
    if (!this.#realms.length) return;
    if (!this.#stopped || this.#starting) {
      await this.#starting;
      return;
    }
    this.#stopped = false;
    this.#starting = (async () => {
      try {
        this.#subscription = await this.#db.subscribe(
          LATTICE_PUBLICATION_CHANNEL,
          () => this.wake(),
        );
      } catch (error) {
        // The committed rows, not NOTIFY, are the obligation.
        log.warn(
          'Publication LISTEN unavailable; recovery poll remains active',
          error,
        );
      }
      if (!this.#stopped) this.wake();
    })();
    try {
      await this.#starting;
    } finally {
      this.#starting = undefined;
    }
  }

  wake(): void {
    if (this.#stopped) return;
    this.#wakeRequested = true;
    clearTimeout(this.#timer);
    if (this.#running) return;
    let capacity = concurrency - this.#deliveries.size;
    if (!capacity) return;
    this.#wakeRequested = false;
    this.#running = claimPublicationDeliveries(
      this.#db,
      capacity,
      this.#lattice,
    )
      .then(async (claims) => {
        for (let claim of claims) {
          let delivery = this.deliver(claim)
            .catch((error) => {
              log.error(
                'Publication delivery failed; its claim will expire',
                error,
              );
            })
            .finally(() => {
              this.#deliveries.delete(delivery);
              this.wake();
            });
          this.#deliveries.add(delivery);
        }
        await this.#prune();
      })
      .catch((error) => {
        log.error(
          'Publication delivery pass failed; durable rows remain pending',
          error,
        );
      })
      .finally(() => {
        this.#running = undefined;
        if (!this.#stopped) {
          this.#timer = setTimeout(
            () => this.wake(),
            this.#wakeRequested ? 0 : 1000,
          );
          this.#timer.unref();
        }
      });
  }

  async shutDown(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    await this.#starting;
    // Finish claiming before aborting: a concurrent claim must not install
    // another live send after the shutdown's abort pass.
    await this.#running;
    for (let controller of this.#sends) controller.abort();
    await Promise.all(this.#deliveries);
    await this.#subscription?.unsubscribe();
    this.#subscription = undefined;
  }

  async drain(): Promise<number> {
    if (!this.#realms.length) return 0;
    let claims = await claimPublicationDeliveries(
      this.#db,
      concurrency,
      this.#lattice,
    );
    await Promise.all(claims.map((claim) => this.deliver(claim)));
    await this.#prune();
    return claims.length;
  }

  async #prune(): Promise<void> {
    if (Date.now() >= this.#nextPruneAt) {
      this.#nextPruneAt = Date.now() + 60_000;
      // Bound retention of completed fan-out. Failed obligations never age out.
      await query(this.#db, [
        `DELETE FROM lattice_publication_events WHERE id IN (
          SELECT e.id FROM lattice_publication_events e
          WHERE e.realm_url = ANY(`,
        textArrayParam(this.#realms),
        `) AND created_at < now() - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM lattice_publication_deliveries d
              WHERE d.publication_id = e.id AND d.delivered_at IS NULL AND d.terminal_reason IS NULL)
          ORDER BY created_at LIMIT 1000)`,
      ]);
    }
  }

  async deliver(claim: PublicationDelivery): Promise<void> {
    if (!this.#lattice.isEnabled(claim.realm_url)) return;
    let started = performance.now();
    let outcome = 'obsolete claim';
    let generation: number | undefined;
    let controller = new AbortController();
    this.#sends.add(controller);
    let timer = setTimeout(() => controller.abort(), sendTimeoutMs);
    try {
      // Re-read authorization and the current session immediately before I/O.
      // A rotated room is retargeted; a missing room remains retryable.
      let [recipient] = await query(this.#db, [
        `SELECT e.realm_url, e.payload, u.matrix_user_id, u.session_room_id,
          (EXISTS (SELECT 1 FROM realm_user_permissions p WHERE p.realm_url = e.realm_url
            AND p.username = u.matrix_user_id AND (p.read = TRUE OR p.write = TRUE))
           OR EXISTS (SELECT 1 FROM realm_user_permissions p WHERE p.realm_url = e.realm_url
            AND p.username = '*' AND p.read = TRUE)) AS allowed
         FROM lattice_publication_deliveries d
         JOIN lattice_publication_events e ON e.id = d.publication_id
         LEFT JOIN users u ON u.matrix_user_id = d.user_id
         WHERE d.publication_id =`,
        param(claim.publication_id),
        'AND d.user_id =',
        param(claim.user_id),
        'AND d.lease_token =',
        param(claim.lease_token),
        // A supplied enabled root cannot authorize another stored realm.
        'AND e.realm_url =',
        param(claim.realm_url),
        'AND d.lease_until > now() AND d.delivered_at IS NULL AND d.terminal_reason IS NULL',
      ]);
      if (!recipient) return;
      const realmURL = recipient.realm_url as string;
      const event = recipient.payload as unknown as LatticePublicationEvent;
      generation = event.generation;
      if (
        event.realmURL !== realmURL ||
        event.publicationId !== claim.publication_id
      ) {
        throw new Error(
          'Stored publication identity does not match its event row',
        );
      }
      if (!recipient.matrix_user_id || !recipient.allowed) {
        await this.#finish(claim, null, 'recipient removed or access revoked');
        outcome = 'recipient no longer authorized';
        return;
      }
      let roomId = recipient.session_room_id as string | null;
      if (!roomId) throw new Error('Recipient has no current session room');
      controller.signal.throwIfAborted();
      // A bounded local wait also covers login/mount implementations that do
      // not consume the signal. send() must check it before beginning the PUT.
      let abort = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('Publication delivery aborted')),
          { once: true },
        );
      });
      let eventId = await Promise.race([
        this.#send(realmURL, roomId, event, controller.signal),
        abort,
      ]);
      if (!eventId) throw new Error('Matrix did not acknowledge an event ID');
      await this.#finish(claim, eventId, null, roomId);
      outcome = 'Matrix acknowledged';
    } catch (error) {
      outcome = 'retry pending';
      await query(this.#db, [
        `UPDATE lattice_publication_deliveries SET lease_token = NULL, lease_until = NULL,
          last_error =`,
        param(String(error).slice(0, 500)),
        `, next_attempt_at = now() + (LEAST(30000, 250 * power(2, LEAST(attempts - 1, 7))) + random() * 250) * interval '1 millisecond'
         WHERE publication_id =`,
        param(claim.publication_id),
        'AND user_id =',
        param(claim.user_id),
        'AND lease_token =',
        param(claim.lease_token),
        'AND delivered_at IS NULL AND terminal_reason IS NULL',
        `AND EXISTS (SELECT 1 FROM lattice_publication_events e
          WHERE e.id = lattice_publication_deliveries.publication_id AND e.realm_url =`,
        param(claim.realm_url),
        ')',
      ]);
      log.warn(
        `Publication ${claim.publication_id} delivery attempt failed; retained for retry`,
      );
    } finally {
      clearTimeout(timer);
      this.#sends.delete(controller);
      log.debug('Publication delivery attempt', {
        publicationId: claim.publication_id,
        generation,
        attempt: claim.attempts,
        queueAgeMs: Number(claim.queue_age_ms),
        deliveryMs: performance.now() - started,
        outcome,
      });
    }
  }

  async #finish(
    claim: PublicationDelivery,
    eventId: string | null,
    reason: string | null,
    roomId = claim.room_id,
  ) {
    await query(this.#db, [
      `UPDATE lattice_publication_deliveries SET
        delivered_at = CASE WHEN`,
      param(eventId),
      `::text IS NOT NULL THEN now() ELSE NULL END,
        event_id =`,
      param(eventId),
      ', terminal_reason =',
      param(reason),
      ', room_id =',
      param(roomId),
      `, lease_token = NULL, lease_until = NULL, last_error = NULL
       WHERE publication_id =`,
      param(claim.publication_id),
      'AND user_id =',
      param(claim.user_id),
      'AND lease_token =',
      param(claim.lease_token),
      'AND lease_until > now() AND delivered_at IS NULL AND terminal_reason IS NULL',
      `AND EXISTS (SELECT 1 FROM lattice_publication_events e
        WHERE e.id = lattice_publication_deliveries.publication_id AND e.realm_url =`,
      param(claim.realm_url),
      ')',
    ]);
  }
}
