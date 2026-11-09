import { Client, type ClientConfig } from 'pg';
import { logger } from '@cardstack/runtime-common';
import { postgresConfig } from './pg-config.ts';

const log = logger('pg-session-probe');

// What the database's own session table says about work that has stopped
// making progress, as seen by the role the probe connects as.
//
// - `idleInTransaction` counts sessions that opened a transaction and are
//   waiting on their client to send the next statement; `idleInTransactionMaxMs`
//   is how long the longest of them has sat that way. A request's transaction
//   goes idle between its statements for milliseconds. One that stays idle for
//   minutes is a client that stopped driving its transaction, and whatever
//   locks the transaction took stay taken until it ends.
// - `advisoryWaiters` counts sessions blocked acquiring an advisory lock, and
//   `advisoryWaitMaxMs` is how long the longest of them has been blocked. Each
//   one is a pooled connection held by a caller that can do nothing until the
//   lock's holder commits.
export interface SessionStats {
  idleInTransaction: number;
  idleInTransactionMaxMs: number;
  advisoryWaiters: number;
  advisoryWaitMaxMs: number;
}

// Postgres reports `state`, `wait_event` and the timestamps only for sessions
// of the role asking, or to a role with `pg_read_all_stats`; any other
// session's row comes back with them null and matches neither filter. So the
// reading covers the sessions of the role the probe connects as — the
// realm-server's own role, and every process that shares it — across the
// whole database, not only this process's connections.
const SESSION_STATS_SQL = `
SELECT
  count(*) FILTER (WHERE state IN ('idle in transaction', 'idle in transaction (aborted)'))
    AS idle_in_transaction,
  coalesce(max(extract(epoch FROM now() - state_change) * 1000)
    FILTER (WHERE state IN ('idle in transaction', 'idle in transaction (aborted)')), 0)
    AS idle_in_transaction_max_ms,
  count(*) FILTER (WHERE wait_event_type = 'Lock' AND wait_event = 'advisory')
    AS advisory_waiters,
  coalesce(max(extract(epoch FROM now() - query_start) * 1000)
    FILTER (WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'), 0)
    AS advisory_wait_max_ms
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
`;

// Samples `pg_stat_activity` on a connection of its own, outside the pool.
// The states it looks for are the ones that starve a pool, so a probe that
// waited for a pooled connection would go quiet exactly when it has something
// to report.
//
// One connection, opened on the first sample and kept. A sample that fails
// ends it, and the next sample opens a fresh one. Every statement and connect
// attempt is bounded by `timeoutMs`, so a database that stops answering costs
// a failed sample rather than a probe stuck behind it.
export class SessionProbe {
  #config: ClientConfig;
  #timeoutMs: number;
  #client: Client | undefined;
  #connecting: Promise<Client> | undefined;
  #closed = false;

  constructor(opts: { config?: ClientConfig; timeoutMs?: number } = {}) {
    this.#config = opts.config ?? postgresConfig();
    this.#timeoutMs = opts.timeoutMs ?? 5000;
  }

  async sample(): Promise<SessionStats> {
    let client = await this.#connect();
    try {
      let { rows } = await client.query(SESSION_STATS_SQL);
      let row = rows[0] ?? {};
      return {
        idleInTransaction: Number(row.idle_in_transaction ?? 0),
        idleInTransactionMaxMs: Math.round(
          Number(row.idle_in_transaction_max_ms ?? 0),
        ),
        advisoryWaiters: Number(row.advisory_waiters ?? 0),
        advisoryWaitMaxMs: Math.round(Number(row.advisory_wait_max_ms ?? 0)),
      };
    } catch (e) {
      await this.#discard(client);
      throw e;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    let client =
      this.#client ?? (await this.#connecting?.catch(() => undefined));
    if (client) {
      await this.#discard(client);
    }
  }

  async #connect(): Promise<Client> {
    if (this.#closed) {
      throw new Error('session probe is closed');
    }
    if (this.#client) {
      return this.#client;
    }
    if (!this.#connecting) {
      this.#connecting = (async () => {
        let client = new Client({
          ...this.#config,
          application_name: 'boxel-session-probe',
          connectionTimeoutMillis: this.#timeoutMs,
          statement_timeout: this.#timeoutMs,
          query_timeout: this.#timeoutMs,
        });
        // An idle client's connection can drop between samples; without a
        // listener that `error` is an uncaught exception. The next sample's
        // query fails and replaces the client.
        client.on('error', (e: Error) => {
          log.debug(`session probe connection error: ${String(e)}`);
        });
        try {
          await client.connect();
        } catch (e) {
          await client.end().catch(() => undefined);
          throw e;
        }
        if (this.#closed) {
          await client.end().catch(() => undefined);
          throw new Error('session probe is closed');
        }
        this.#client = client;
        return client;
      })().finally(() => {
        this.#connecting = undefined;
      });
    }
    return await this.#connecting;
  }

  async #discard(client: Client): Promise<void> {
    if (this.#client === client) {
      this.#client = undefined;
    }
    await client.end().catch(() => undefined);
  }
}

// Samples `probe` every `intervalMs` and keeps the latest reading, for a
// periodic health line to print. `latest()` answers undefined once the newest
// reading is older than two intervals, so a probe that keeps failing drops its
// fields from the line instead of repeating a reading from before the trouble
// began. A sample still running when the next is due is not overlapped.
export function startSessionSampling(
  probe: Pick<SessionProbe, 'sample' | 'close'>,
  opts: { intervalMs?: number; now?: () => number } = {},
): { latest: () => SessionStats | undefined; stop: () => Promise<void> } {
  let intervalMs = opts.intervalMs ?? 30_000;
  let now = opts.now ?? (() => Date.now());
  let latest: { stats: SessionStats; at: number } | undefined;
  let running: Promise<void> | undefined;
  let failing = false;

  let run = () => {
    if (running) {
      return;
    }
    running = (async () => {
      try {
        latest = { stats: await probe.sample(), at: now() };
        if (failing) {
          failing = false;
          log.info(`session probe recovered`);
        }
      } catch (e) {
        // Logged once per run of failures, so a database that is down for an
        // hour adds one line, not one per sample.
        if (!failing) {
          failing = true;
          log.warn(`session probe failed: ${String(e)}`);
        }
      }
    })().finally(() => {
      running = undefined;
    });
  };

  run();
  let timer = setInterval(run, intervalMs);
  timer.unref?.();

  return {
    latest: () =>
      latest && now() - latest.at <= 2 * intervalMs ? latest.stats : undefined,
    stop: async () => {
      clearInterval(timer);
      await running;
      await probe.close();
    },
  };
}
