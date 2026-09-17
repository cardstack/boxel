import type { DBAdapter } from './db.ts';
import { logger } from './log.ts';
import type { LatticeDemandPriority } from './lattice-scheduling.ts';

export const LATTICE_DEMAND_CHANNEL = 'lattice_demand';
const TTL_MS = 30_000;
const MAX_ENTRIES = 512;
const MAX_SCOPE_ENTRIES = 64;
const MAX_PAYLOAD_BYTES = 7000;
const log = logger('lattice-demand');

interface Hint {
  realm: string;
  scope: string;
  owner: string;
  priority: LatticeDemandPriority;
  expires: number;
}

// Advisory memory only. Hints never authorize a read, alter a publication, or
// establish read-your-write completion. Scope is a hash of the authorized
// actor and realm, not a token. Workers aggregate scheduling interest for a
// shared owner, but never deliver another actor's data using this cache.
export class LatticeDemandCache {
  #entries = new Map<string, Hint>();
  private now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  put(hint: Hint): boolean {
    this.prune();
    if (
      !hint ||
      typeof hint.realm !== 'string' ||
      hint.realm.length > 2048 ||
      !hint.realm.endsWith('/') ||
      typeof hint.scope !== 'string' ||
      !/^[a-f0-9]{64}$/.test(hint.scope) ||
      typeof hint.owner !== 'string' ||
      hint.owner.length > 4096 ||
      !hint.owner.startsWith(hint.realm) ||
      !hint.owner.endsWith('.json') ||
      ![1, 2].includes(hint.priority) ||
      !Number.isFinite(hint.expires) ||
      hint.expires <= this.now() ||
      hint.expires > this.now() + TTL_MS
    )
      return false;
    if (
      new TextEncoder().encode(JSON.stringify({ version: 1, hints: [hint] }))
        .length > MAX_PAYLOAD_BYTES
    )
      return false;
    const key = JSON.stringify([
      hint.realm,
      hint.scope,
      hint.owner,
      hint.priority,
    ]);
    const previous = this.#entries.get(key);
    // Separate priority leases: ordinary reads cannot demote a live waiter or
    // keep its urgent priority alive. Replay cannot shorten either lease.
    if (previous && previous.expires >= hint.expires) return false;
    const scoped = [...this.#entries].filter(
      ([, row]) => row.realm === hint.realm && row.scope === hint.scope,
    );
    if (!previous && scoped.length >= MAX_SCOPE_ENTRIES)
      this.#entries.delete(scoped[0][0]);
    this.#entries.delete(key);
    this.#entries.set(key, { ...hint });
    if (this.#entries.size > MAX_ENTRIES)
      this.#entries.delete(this.#entries.keys().next().value!);
    return true;
  }

  hasRecent(hint: Hint): boolean {
    const key = JSON.stringify([
      hint.realm,
      hint.scope,
      hint.owner,
      hint.priority,
    ]);
    return (this.#entries.get(key)?.expires ?? 0) > this.now() + TTL_MS / 2;
  }

  values(): Hint[] {
    this.prune();
    return [...this.#entries.values()];
  }

  priorities(realm: string): Map<string, LatticeDemandPriority> {
    const result = new Map<string, LatticeDemandPriority>();
    for (const row of this.values()) {
      if (row.realm === realm && row.priority > (result.get(row.owner) ?? 0))
        result.set(row.owner, row.priority);
    }
    return result;
  }

  private prune() {
    for (const [key, row] of this.#entries)
      if (row.expires <= this.now()) this.#entries.delete(key);
  }
}

// Shared per DB adapter, never across databases. Received hints are not
// rebroadcast. Local leases are refreshed in bounded NOTIFY payloads so a new
// worker can join without a durable demand table or a notification replay log.
class LatticeDemandTransport {
  readonly cache = new LatticeDemandCache();
  readonly local = new LatticeDemandCache();
  #timer?: ReturnType<typeof setTimeout>;
  #refresh?: ReturnType<typeof setInterval>;
  #subscription?: Promise<{ unsubscribe(): Promise<void> } | undefined>;
  #flushing?: Promise<void>;
  #closed = false;
  private db: DBAdapter;
  constructor(db: DBAdapter) {
    this.db = db;
  }

  async listen() {
    if (!this.db.subscribe || this.#closed) return;
    this.#subscription ??= this.db
      .subscribe(LATTICE_DEMAND_CHANNEL, ({ payload }) => {
        if (
          this.#closed ||
          !payload ||
          new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES
        )
          return;
        try {
          const message = JSON.parse(payload);
          if (
            message.version !== 1 ||
            !Array.isArray(message.hints) ||
            message.hints.length > 64
          )
            return;
          for (const hint of message.hints) this.cache.put(hint);
        } catch {
          /* Lost or malformed advisory demand is safe to ignore. */
        }
      })
      .catch((error) => {
        this.#subscription = undefined;
        log.warn('Lattice demand listener unavailable', error);
        return undefined;
      });
    await this.#subscription;
  }

  record(
    realm: string,
    scope: string,
    owner: string,
    priority: LatticeDemandPriority,
  ) {
    if (this.#closed || this.db.isClosed) return;
    const hint = {
      realm,
      scope,
      owner,
      priority,
      expires: Date.now() + TTL_MS,
    };
    if (this.local.hasRecent(hint) || !this.local.put(hint)) return;
    this.cache.put(hint);
    this.#timer ??= setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, 100);
    this.#timer.unref?.();
    this.#refresh ??= setInterval(() => {
      if (this.db.isClosed || !this.local.values().length) {
        clearInterval(this.#refresh);
        this.#refresh = undefined;
        return;
      }
      void this.flush();
    }, 10_000);
    this.#refresh.unref?.();
  }

  async flush() {
    if (this.#closed || this.db.isClosed) return;
    if (this.#flushing) return this.#flushing;
    this.#flushing = (async () => {
      let hints: Hint[] = [];
      const send = async () => {
        if (hints.length && !this.#closed && !this.db.isClosed)
          await this.db.notify(
            LATTICE_DEMAND_CHANNEL,
            JSON.stringify({ version: 1, hints }),
          );
        hints = [];
      };
      for (const hint of this.local.values()) {
        const candidate = JSON.stringify({
          version: 1,
          hints: [...hints, hint],
        });
        if (
          hints.length >= 64 ||
          new TextEncoder().encode(candidate).length > MAX_PAYLOAD_BYTES
        )
          await send();
        hints.push(hint);
      }
      await send();
    })()
      .catch((error) => log.warn('Lattice demand broadcast unavailable', error))
      .finally(() => {
        this.#flushing = undefined;
      });
    return this.#flushing;
  }

  async close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    clearInterval(this.#refresh);
    await this.#flushing;
    await (await this.#subscription)?.unsubscribe();
  }
}

const transports = new WeakMap<DBAdapter, LatticeDemandTransport>();
export function latticeDemandFor(db: DBAdapter) {
  let transport = transports.get(db);
  if (!transport)
    transports.set(db, (transport = new LatticeDemandTransport(db)));
  return transport;
}
export async function closeLatticeDemand(db: DBAdapter) {
  await transports.get(db)?.close();
  transports.delete(db);
}

// Called only after the ordinary realm read authorization and successful
// lookup. Internal input and prerender reads must never manufacture demand.
export async function recordLatticeReadDemand(
  db: DBAdapter,
  realm: string,
  actor: string,
  owners: readonly string[],
  priority: LatticeDemandPriority,
) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([realm, actor])),
  );
  const scope = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const transport = latticeDemandFor(db);
  for (const id of owners.slice(0, MAX_SCOPE_ENTRIES))
    transport.record(
      realm,
      scope,
      id.endsWith('.json') ? id : `${id}.json`,
      priority,
    );
}
