import { createHash, randomUUID } from 'node:crypto';
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
const batchSize = 64;
const batchBytes = 48 * 1024;
const maxDeliveryAttempts = 20;
class InvalidPublicationDelivery extends Error {}

export interface PublicationDelivery {
  publication_id: string;
  publication_ids?: string[];
  user_id: string;
  room_id: string;
  lease_token: string;
  realm_url: string;
  payload: LatticePublicationEvent;
  attempts: number;
  queue_age_ms: number | string;
}

type StoredDelivery = PublicationDelivery & { owner_url: string };

// The wire has one generation per envelope. Repeated revisions of one owner
// collapse to its latest notice; distinct owners combine only when their latest
// generations agree. Never assign another owner's newer revision to an old one.
function compatibleBatches(rows: StoredDelivery[]): StoredDelivery[][] {
  let owners = new Map<string, StoredDelivery[]>();
  for (let row of rows) {
    let key = row.owner_url;
    let previous = owners.get(key) ?? [];
    previous.push(row);
    owners.set(key, previous);
  }
  let generations = new Map<number, StoredDelivery[]>();
  for (let changes of owners.values()) {
    let generation = Math.max(...changes.map((r) => r.payload.generation));
    generations.set(generation, [
      ...(generations.get(generation) ?? []),
      ...changes,
    ]);
  }
  return [...generations.values()];
}

function envelope(rows: StoredDelivery[]): LatticePublicationEvent {
  let ids = rows.map((r) => r.publication_id).sort();
  return {
    ...rows[0].payload,
    generation: Math.max(...rows.map((r) => r.payload.generation)),
    invalidations: [
      ...new Set(rows.flatMap((r) => r.payload.invalidations)),
    ].sort(),
    // Membership is immutable for a given ID. A retry with new membership gets
    // a different transaction ID, never different content under a prior ID.
    publicationId:
      ids.length === 1
        ? ids[0]
        : 'lattice-' +
          createHash('sha256').update(JSON.stringify(ids)).digest('hex'),
  };
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
  // This short claim-only lock serializes selection against other dispatchers.
  // No network I/O, publication transaction or source worker holds it. Existing
  // row leases then exclude an in-flight recipient/realm/kind across replicas.
  // Oldest due realm first; a busy realm's claim lock cannot block selection
  // in unrelated realms. The same short per-realm lock is shared by replicas.
  const dueRealms = await query(db, [
    `SELECT e.realm_url FROM lattice_publication_deliveries d
     JOIN lattice_publication_events e ON e.id=d.publication_id
     WHERE e.realm_url=ANY(`,
    textArrayParam([...realms]),
    `) AND d.delivered_at IS NULL AND d.terminal_reason IS NULL
       AND d.next_attempt_at <= now() AND (d.lease_until IS NULL OR d.lease_until <= now())
     GROUP BY e.realm_url ORDER BY MIN(d.next_attempt_at),e.realm_url`,
  ]);
  const allClaims: PublicationDelivery[] = [];
  for (const { realm_url: realmURL } of dueRealms) {
    if (allClaims.length === limit) break;
    const realmClaims = await db.withWriteLock(
      `lattice:publication-claims:${realmURL}`,
      async (tx) => {
        if (!tx)
          throw new Error(
            'Publication claims require a PostgreSQL transaction',
          );
        let candidates = (await tx([
          `SELECT d.publication_id,d.user_id,d.room_id,d.attempts,e.realm_url,e.owner_url,e.payload,
        EXTRACT(EPOCH FROM (now()-e.created_at))*1000 AS queue_age_ms
       FROM lattice_publication_deliveries d JOIN lattice_publication_events e ON e.id=d.publication_id
       WHERE e.realm_url =`,
          param(realmURL),
          `AND d.delivered_at IS NULL AND d.terminal_reason IS NULL
        AND d.next_attempt_at <= now() AND (d.lease_until IS NULL OR d.lease_until <= now())
        AND NOT EXISTS (
          SELECT 1 FROM lattice_publication_deliveries busy
          JOIN lattice_publication_events be ON be.id=busy.publication_id
          WHERE busy.user_id=d.user_id AND be.realm_url=e.realm_url
            AND be.payload->>'eventName' IS NOT DISTINCT FROM e.payload->>'eventName'
            AND be.payload->>'indexType' IS NOT DISTINCT FROM e.payload->>'indexType'
            AND busy.delivered_at IS NULL AND busy.terminal_reason IS NULL AND busy.lease_until>now())
       ORDER BY d.next_attempt_at,d.publication_id,d.user_id LIMIT`,
          param(concurrency * batchSize),
          'FOR UPDATE OF d SKIP LOCKED',
        ])) as unknown as StoredDelivery[];
        let groups = new Map<string, StoredDelivery[]>();
        for (let row of candidates) {
          let key = JSON.stringify([
            row.user_id,
            row.realm_url,
            row.payload.eventName,
            row.payload.indexType,
          ]);
          let group = groups.get(key) ?? [];
          if (group.length < batchSize) group.push(row);
          groups.set(key, group);
        }
        let claims: PublicationDelivery[] = [];
        for (let group of groups.values()) {
          if (claims.length === limit - allClaims.length) break;
          let members = compatibleBatches(group)[0];
          while (
            members.length > 1 &&
            Buffer.byteLength(JSON.stringify(envelope(members))) > batchBytes
          ) {
            members = compatibleBatches(members.slice(0, -1))[0];
          }
          let payload = envelope(members);
          let ids = members.map((r) => r.publication_id).sort();
          let lease = randomUUID();
          await tx([
            'UPDATE lattice_publication_deliveries SET lease_token=',
            param(lease),
            ', lease_until=now()+',
            param(leaseMs),
            `*interval '1 millisecond',attempts=attempts+1 WHERE user_id=`,
            param(members[0].user_id),
            'AND publication_id=ANY(',
            textArrayParam(ids),
            '::uuid[])',
          ]);
          claims.push({
            ...members[0],
            publication_id: payload.publicationId,
            publication_ids: ids,
            payload,
            lease_token: lease,
            attempts: Math.max(...members.map((r) => r.attempts)) + 1,
            queue_age_ms: Math.max(
              ...members.map((r) => Number(r.queue_age_ms)),
            ),
          });
        }
        return claims;
      },
    );
    allClaims.push(...realmClaims);
  }
  return allClaims;
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
      // Bound completed and terminal fan-out. Retryable obligations remain
      // durable until acknowledged or explicitly exhausted below.
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
      let ids = claim.publication_ids ?? [claim.publication_id];
      let recipients = await query(this.#db, [
        `SELECT e.realm_url,e.owner_url,e.payload,d.publication_id,u.matrix_user_id,u.session_room_id,
          (EXISTS (SELECT 1 FROM realm_user_permissions p WHERE p.realm_url=e.realm_url
             AND p.username=u.matrix_user_id AND (p.read=TRUE OR p.write=TRUE))
           OR EXISTS (SELECT 1 FROM realm_user_permissions p WHERE p.realm_url=e.realm_url
             AND p.username='*' AND p.read=TRUE)) AS allowed
         FROM lattice_publication_deliveries d JOIN lattice_publication_events e ON e.id=d.publication_id
         LEFT JOIN users u ON u.matrix_user_id=d.user_id
         WHERE d.publication_id=ANY(`,
        textArrayParam(ids),
        '::uuid[]) AND d.user_id=',
        param(claim.user_id),
        'AND d.lease_token=',
        param(claim.lease_token),
        'AND e.realm_url=',
        param(claim.realm_url),
        'AND d.lease_until>now() AND d.delivered_at IS NULL AND d.terminal_reason IS NULL ORDER BY d.publication_id',
      ]);
      if (recipients.length !== ids.length) return;
      let recipient = recipients[0];
      let realmURL = recipient.realm_url as string;
      let stored = recipients as unknown as StoredDelivery[];
      for (let row of stored) {
        if (
          row.payload.realmURL !== realmURL ||
          row.payload.publicationId !== row.publication_id ||
          row.payload.eventName !== stored[0].payload.eventName ||
          row.payload.indexType !== stored[0].payload.indexType ||
          !Number.isSafeInteger(row.payload.generation) ||
          row.payload.generation < 1 ||
          !Array.isArray(row.payload.invalidations) ||
          !row.payload.invalidations.length ||
          row.payload.invalidations.some((id) => typeof id !== 'string')
        ) {
          throw new InvalidPublicationDelivery(
            'Stored publication identity does not match its event row',
          );
        }
      }
      if (compatibleBatches(stored).length !== 1)
        throw new InvalidPublicationDelivery(
          'Incompatible publication generations',
        );
      let event = envelope(stored);
      if (
        event.publicationId !== claim.publication_id ||
        Buffer.byteLength(JSON.stringify(event)) > batchBytes
      ) {
        throw new InvalidPublicationDelivery(
          'Invalid publication batch identity or size',
        );
      }
      generation = event.generation;
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
      if (
        error instanceof InvalidPublicationDelivery ||
        claim.attempts >= maxDeliveryAttempts
      ) {
        const reason =
          error instanceof InvalidPublicationDelivery
            ? 'invalid publication payload'
            : 'delivery retry budget exhausted';
        await this.#finish(claim, null, reason);
        outcome = reason;
        // A terminal failure is never acknowledged as delivered. It remains
        // inspectable for the retention window; clients repair from current
        // card revisions on reconnect/reload, not by replaying old notices.
        log.error(
          `Publication ${claim.publication_id}: ${reason}; client revalidation required`,
        );
        return;
      }
      outcome = 'retry pending';
      let delayMs =
        Math.min(30_000, 250 * 2 ** Math.min(claim.attempts - 1, 7)) +
        Math.random() * 250;
      await query(this.#db, [
        `UPDATE lattice_publication_deliveries SET lease_token = NULL, lease_until = NULL,
          last_error =`,
        param(String(error).slice(0, 500)),
        `, next_attempt_at = now() +`,
        param(delayMs),
        `* interval '1 millisecond'
         WHERE publication_id = ANY(`,
        textArrayParam(claim.publication_ids ?? [claim.publication_id]),
        '::uuid[])',
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
        coalescedPublications: claim.publication_ids?.length ?? 1,
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
       WHERE publication_id = ANY(`,
      textArrayParam(claim.publication_ids ?? [claim.publication_id]),
      '::uuid[])',
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
