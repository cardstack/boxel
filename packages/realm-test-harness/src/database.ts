import { Client as PgClient } from 'pg';

import {
  baseRealmURLFor,
  builderDatabaseNameForCacheKey,
  DEFAULT_BASE_REALM_PERMISSIONS,
  DEFAULT_MIGRATED_TEMPLATE_DB,
  DEFAULT_PERMISSIONS,
  findAndHoldAvailablePort,
  logTimed,
  pgAdminConnectionConfig,
  quotePgIdentifier,
  realmURLWithinServer,
  templateLog,
  waitUntil,
  type FactorySupportContext,
  type PortReservation,
  type RealmConfig,
  type RealmPermissions,
} from './shared.ts';
import {
  startIsolatedRealmStack,
  stopIsolatedRealmStack,
} from './isolated-realm-stack.ts';

export async function canConnectToPg(): Promise<boolean> {
  let client = new PgClient({
    ...pgAdminConnectionConfig(),
    connectionTimeoutMillis: 1000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // best effort cleanup
    }
  }
}

export async function databaseExists(databaseName: string): Promise<boolean> {
  let client = new PgClient({
    ...pgAdminConnectionConfig(),
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    let result = await client.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [databaseName],
    );
    return Boolean(result.rows[0]?.exists);
  } catch {
    // Postgres may not be running yet (e.g. fresh worktree with no services).
    // Treat as "database does not exist" so the caller proceeds to start services.
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // best effort cleanup
    }
  }
}

export async function dropDatabase(databaseName: string): Promise<void> {
  await logTimed(templateLog, `dropDatabase ${databaseName}`, async () => {
    let client = new PgClient(pgAdminConnectionConfig());
    try {
      await client.connect();
      let result = await client.query<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
        [databaseName],
      );
      if (!result.rows[0]?.exists) {
        return;
      }
      await client.query(
        `ALTER DATABASE ${quotePgIdentifier(databaseName)} WITH IS_TEMPLATE false`,
      );
      await client.query(
        `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await client.query(
        `DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)}`,
      );
    } finally {
      await client.end();
    }
  });
}

export async function cloneDatabaseFromTemplate(
  templateDatabaseName: string,
  databaseName: string,
): Promise<void> {
  await logTimed(
    templateLog,
    `cloneDatabaseFromTemplate ${templateDatabaseName} -> ${databaseName}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig());
      try {
        await client.connect();
        await client.query(
          `CREATE DATABASE ${quotePgIdentifier(databaseName)} TEMPLATE ${quotePgIdentifier(
            templateDatabaseName,
          )}`,
        );
      } finally {
        await client.end();
      }
    },
  );
}

export async function createTemplateSnapshot(
  sourceDatabaseName: string,
  templateDatabaseName: string,
): Promise<void> {
  await logTimed(
    templateLog,
    `createTemplateSnapshot ${sourceDatabaseName} -> ${templateDatabaseName}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig());
      try {
        await client.connect();
        await client.query(
          `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [templateDatabaseName],
        );
        await client.query(
          `DROP DATABASE IF EXISTS ${quotePgIdentifier(templateDatabaseName)}`,
        );
        await client.query(
          `CREATE DATABASE ${quotePgIdentifier(templateDatabaseName)} TEMPLATE ${quotePgIdentifier(
            sourceDatabaseName,
          )}`,
        );
        await client.query(
          `ALTER DATABASE ${quotePgIdentifier(templateDatabaseName)} WITH IS_TEMPLATE true`,
        );
      } finally {
        await client.end();
      }
    },
  );
}

export async function seedRealmPermissions(
  databaseName: string,
  realmURL: URL,
  permissions: RealmPermissions,
): Promise<void> {
  await logTimed(
    templateLog,
    `seedRealmPermissions ${databaseName} ${realmURL.href}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig(databaseName));
      try {
        await client.connect();
        await client.query('BEGIN');

        for (let [username, actions] of Object.entries(permissions)) {
          if (!actions || actions.length === 0) {
            await client.query(
              `DELETE FROM realm_user_permissions
           WHERE realm_url = $1 AND username = $2`,
              [realmURL.href, username],
            );
            continue;
          }

          if (username !== '*') {
            await client.query(
              `INSERT INTO users (matrix_user_id)
           VALUES ($1)
           ON CONFLICT (matrix_user_id) DO NOTHING`,
              [username],
            );
          }

          await client.query(
            `INSERT INTO realm_user_permissions (
          realm_url,
          username,
          read,
          write,
          realm_owner
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (realm_url, username) DO UPDATE
        SET read = EXCLUDED.read,
            write = EXCLUDED.write,
            realm_owner = EXCLUDED.realm_owner`,
            [
              realmURL.href,
              username,
              actions.includes('read'),
              actions.includes('write'),
              actions.includes('realm-owner'),
            ],
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // best effort cleanup
        }
        throw error;
      } finally {
        await client.end();
      }
    },
  );
}

export async function clearRealmPermissions(
  databaseName: string,
  realmURL: URL,
): Promise<void> {
  await logTimed(
    templateLog,
    `clearRealmPermissions ${databaseName} ${realmURL.href}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig(databaseName));
      try {
        await client.connect();
        await client.query(
          `DELETE FROM realm_user_permissions WHERE realm_url = $1`,
          [realmURL.href],
        );
      } finally {
        await client.end();
      }
    },
  );
}

export async function resetRealmState(
  databaseName: string,
  realmURL: URL,
): Promise<void> {
  await logTimed(
    templateLog,
    `resetRealmState ${databaseName} ${realmURL.href}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig(databaseName));
      try {
        await client.connect();
        await client.query('BEGIN');

        await client.query(
          `DELETE FROM modules WHERE resolved_realm_url = $1`,
          [realmURL.href],
        );
        await client.query(`DELETE FROM boxel_index WHERE realm_url = $1`, [
          realmURL.href,
        ]);
        await client.query(
          `DELETE FROM boxel_index_working WHERE realm_url = $1`,
          [realmURL.href],
        );
        await client.query(
          `DELETE FROM prerendered_html WHERE realm_url = $1`,
          [realmURL.href],
        );
        await client.query(
          `DELETE FROM prerendered_html_working WHERE realm_url = $1`,
          [realmURL.href],
        );
        await client.query(
          `DELETE FROM realm_generations WHERE realm_url = $1`,
          [realmURL.href],
        );
        await client.query(`DELETE FROM realm_file_meta WHERE realm_url = $1`, [
          realmURL.href,
        ]);
        await client.query(
          `DELETE FROM realm_registry
       WHERE source_url = $1 OR url = $1`,
          [realmURL.href],
        );

        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // best effort cleanup
        }
        throw error;
      } finally {
        await client.end();
      }
    },
  );
}

export async function resetMountedRealmState(
  databaseName: string,
  realmURLs: URL[],
): Promise<void> {
  await logTimed(
    templateLog,
    `resetMountedRealmState ${databaseName} (${realmURLs.length} realms)`,
    async () => {
      for (let realmURL of realmURLs) {
        await resetRealmState(databaseName, realmURL);
      }
    },
  );
}

export async function resetQueueState(databaseName: string): Promise<void> {
  await logTimed(templateLog, `resetQueueState ${databaseName}`, async () => {
    let client = new PgClient(pgAdminConnectionConfig(databaseName));
    try {
      await client.connect();
      await client.query('BEGIN');
      await client.query(`DELETE FROM job_reservations`);
      await client.query(`DELETE FROM jobs`);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // best effort cleanup
      }
      throw error;
    } finally {
      await client.end();
    }
  });
}

export async function clearModuleCache(databaseName: string): Promise<void> {
  await logTimed(templateLog, `clearModuleCache ${databaseName}`, async () => {
    let client = new PgClient(pgAdminConnectionConfig(databaseName));
    try {
      await client.connect();
      await client.query(`DELETE FROM modules`);
    } finally {
      await client.end();
    }
  });
}

// When schema changes add new persisted URL-bearing columns or tables, this
// rewrite pass needs to be updated as well. If that coverage drifts, cloned
// harness databases quietly fall back toward cold indexing instead of reusing
// the prepared snapshot.
export async function rewriteClonedRealmServerUrls(
  databaseName: string,
  fromRealmServerURL: URL,
  toRealmServerURL: URL,
): Promise<void> {
  if (fromRealmServerURL.href === toRealmServerURL.href) {
    return;
  }

  await logTimed(
    templateLog,
    `rewriteClonedRealmServerUrls ${databaseName} ${fromRealmServerURL.href} -> ${toRealmServerURL.href}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig(databaseName));
      let fromURL = fromRealmServerURL.href;
      let toURL = toRealmServerURL.href;
      try {
        await client.connect();
        await client.query('BEGIN');

        await client.query(
          `UPDATE boxel_index
           SET url = replace(url, $1, $2),
               file_alias = replace(file_alias, $1, $2),
               realm_url = replace(realm_url, $1, $2),
               pristine_doc = replace(pristine_doc::text, $1, $2)::jsonb,
               search_doc = replace(search_doc::text, $1, $2)::jsonb,
               error_doc = replace(error_doc::text, $1, $2)::jsonb,
               deps = replace(deps::text, $1, $2)::jsonb,
               types = replace(types::text, $1, $2)::jsonb,
               display_names = replace(display_names::text, $1, $2)::jsonb,
               icon_html = replace(icon_html, $1, $2),
               last_known_good_deps = replace(last_known_good_deps::text, $1, $2)::jsonb`,
          [fromURL, toURL],
        );

        // prerendered_html holds the URL-bearing HTML/deps columns; rewrite
        // them so a cloned harness DB stays consistent with the rewritten
        // realm-server URL.
        for (let table of ['prerendered_html', 'prerendered_html_working']) {
          await client.query(
            `UPDATE ${table}
             SET url = replace(url, $1, $2),
                 file_alias = replace(file_alias, $1, $2),
                 realm_url = replace(realm_url, $1, $2),
                 isolated_html = replace(isolated_html, $1, $2),
                 atom_html = replace(atom_html, $1, $2),
                 head_html = replace(head_html, $1, $2),
                 embedded_html = replace(embedded_html::text, $1, $2)::jsonb,
                 fitted_html = replace(fitted_html::text, $1, $2)::jsonb,
                 deps = replace(deps::text, $1, $2)::jsonb,
                 last_known_good_deps = replace(last_known_good_deps::text, $1, $2)::jsonb,
                 error_doc = replace(error_doc::text, $1, $2)::jsonb`,
            [fromURL, toURL],
          );
        }

        await client.query(
          `UPDATE realm_generations
           SET realm_url = replace(realm_url, $1, $2)`,
          [fromURL, toURL],
        );
        await client.query(
          `UPDATE realm_file_meta
           SET realm_url = replace(realm_url, $1, $2)`,
          [fromURL, toURL],
        );
        await client.query(
          `UPDATE realm_user_permissions
           SET realm_url = replace(realm_url, $1, $2)`,
          [fromURL, toURL],
        );
        await client.query(
          `UPDATE realm_meta
           SET realm_url = replace(realm_url, $1, $2),
               value = replace(value::text, $1, $2)::jsonb`,
          [fromURL, toURL],
        );
        // Without this, lookupDefinition misses every cached module on the
        // first request after clone and pays a full prerender (~45s for a
        // module with deep transitive imports), which can blow past the
        // 60s realm-search tool timeout.
        await client.query(
          `UPDATE modules
           SET url = replace(url, $1, $2),
               file_alias = replace(file_alias, $1, $2),
               resolved_realm_url = replace(resolved_realm_url, $1, $2),
               definitions = replace(definitions::text, $1, $2)::jsonb,
               deps = replace(deps::text, $1, $2)::jsonb,
               error_doc = replace(error_doc::text, $1, $2)::jsonb`,
          [fromURL, toURL],
        );
        await client.query(
          `UPDATE realm_registry
           SET url = replace(url, $1, $2),
               source_url = replace(source_url, $1, $2)`,
          [fromURL, toURL],
        );

        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // best effort cleanup
        }
        throw error;
      } finally {
        await client.end();
      }
    },
  );
}

export async function rebuildWorkingIndexFromIndex(
  databaseName: string,
): Promise<void> {
  await logTimed(
    templateLog,
    `rebuildWorkingIndexFromIndex ${databaseName}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig(databaseName));
      try {
        await client.connect();
        await client.query('BEGIN');
        await client.query(`DELETE FROM boxel_index_working`);
        await client.query(
          `INSERT INTO boxel_index_working (
             url,
             file_alias,
             type,
             generation,
             realm_url,
             pristine_doc,
             search_doc,
             error_doc,
             deps,
             types,
             icon_html,
             indexed_at,
             is_deleted,
             last_modified,
             display_names,
             resource_created_at,
             has_error,
             last_known_good_deps
           )
           SELECT
             url,
             file_alias,
             type,
             generation,
             realm_url,
             pristine_doc,
             search_doc,
             error_doc,
             deps,
             types,
             icon_html,
             indexed_at,
             is_deleted,
             last_modified,
             display_names,
             resource_created_at,
             has_error,
             last_known_good_deps
           FROM boxel_index`,
        );
        // Mirror the working rebuild for the prerendered_html channel. `job_id`
        // is omitted (defaults NULL), matching the boxel_index_working rebuild.
        await client.query(`DELETE FROM prerendered_html_working`);
        await client.query(
          `INSERT INTO prerendered_html_working (
             url,
             file_alias,
             realm_url,
             type,
             fitted_html,
             embedded_html,
             atom_html,
             head_html,
             isolated_html,
             markdown,
             deps,
             last_known_good_deps,
             generation,
             is_deleted,
             error_doc,
             diagnostics,
             rendered_at
           )
           SELECT
             url,
             file_alias,
             realm_url,
             type,
             fitted_html,
             embedded_html,
             atom_html,
             head_html,
             isolated_html,
             markdown,
             deps,
             last_known_good_deps,
             generation,
             is_deleted,
             error_doc,
             diagnostics,
             rendered_at
           FROM prerendered_html`,
        );
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // best effort cleanup
        }
        throw error;
      } finally {
        await client.end();
      }
    },
  );
}

interface IndexingStatus {
  active: {
    realmURL: string;
    totalFiles: number;
    filesCompleted: number;
  }[];
  pending: { realmURL: string }[];
}

async function queryIndexingStatus(
  workerManagerPort: number,
): Promise<IndexingStatus | undefined> {
  // Bound the fetch so a hung connection (the worker-manager hasn't bound
  // yet, or is wedged) can't pin `polling = true` in the progress reporter
  // and freeze it. The reporter retries every 2s, so 1.5s is comfortably
  // under one polling interval.
  let abort = new AbortController();
  let timeout = setTimeout(() => abort.abort(), 1500);
  try {
    let response = await fetch(
      `http://localhost:${workerManagerPort}/_indexing-status`,
      { signal: abort.signal },
    );
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as IndexingStatus;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Start a progress reporter that polls the worker-manager's
 * /_indexing-status JSON endpoint for precise indexing progress.
 * The port must be pre-allocated by the caller via findAvailablePort()
 * and passed to startIsolatedRealmStack as workerManagerPort.
 */
function startIndexingProgressReporter(
  workerManagerPort: number,
  totalRealms: number,
): {
  stop: () => void;
} {
  let stopped = false;
  let polling = false;
  let lastCompleted = -1;
  let lastTotal = -1;
  let startedAt = Date.now();
  let seenRealms = new Set<string>();

  let report = async () => {
    if (stopped || polling) {
      return;
    }
    polling = true;
    try {
      let elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      let status = await queryIndexingStatus(workerManagerPort);
      if (stopped) {
        return;
      }
      if (!status) {
        process.stderr.write(`\r  indexing: waiting for status ${elapsed}s`);
        return;
      }

      let current = status.active[0];
      let filesCompleted = current?.filesCompleted ?? 0;
      let totalFiles = current?.totalFiles ?? 0;
      lastCompleted = filesCompleted;
      lastTotal = totalFiles;

      // Track which realms we've seen to compute remaining count.
      if (current) {
        seenRealms.add(current.realmURL);
      }
      let remaining = Math.max(0, totalRealms - seenRealms.size);

      let realmName = current
        ? new URL(current.realmURL).pathname.replace(/\/$/, '').split('/').pop()
        : undefined;
      let realmLabel = realmName ? ` ${realmName}` : '';
      let remainingLabel =
        remaining > 0
          ? ` (${remaining} realm${remaining > 1 ? 's' : ''} remaining)`
          : '';

      if (totalFiles > 0) {
        let pct = Math.min(
          100,
          Math.round((filesCompleted / totalFiles) * 100),
        );
        let barWidth = 30;
        let filled = Math.round((pct / 100) * barWidth);
        let bar = '='.repeat(filled) + ' '.repeat(barWidth - filled);
        process.stderr.write(
          `\r  indexing${realmLabel} [${bar}] ${filesCompleted}/${totalFiles} files (${pct}%) ${elapsed}s${remainingLabel}`,
        );
      } else if (status.active.length > 0) {
        process.stderr.write(
          `\r  indexing${realmLabel}: discovering files... ${elapsed}s${remainingLabel}`,
        );
      } else {
        process.stderr.write(
          `\r  indexing: waiting for realm server ${elapsed}s`,
        );
      }
    } catch {
      // Progress reporting is best-effort; swallow errors so we don't
      // crash the process with an unhandled rejection from setInterval.
    } finally {
      polling = false;
    }
  };

  let interval = setInterval(() => void report(), 2000);
  let initialTimeout = setTimeout(() => void report(), 3000);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      clearTimeout(initialTimeout);
      if (lastCompleted >= 0) {
        let elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        process.stderr.write(
          `\r  indexing complete: ${lastCompleted}/${lastTotal} files in ${elapsed}s\n`,
        );
      }
    },
  };
}

// A combined-template build reaches "realm server ready" once the pinned base
// realm is indexed, but the non-pinned user realms are still
// from-scratch-indexing when this wait begins — and after each realm's index
// job resolves, its whole-realm prerender_html job (every card's HTML) drains
// through the same queue. On a slow or loaded runner that legitimately-remaining
// work runs well past a 30s window, so a tight timeout kills a build that is in
// fact still making steady progress (the indexing progress reporter keeps
// printing throughout). Budget generously, matching the realm-server multi-realm
// helper that drains the identical prerender_html tail. Override via env for
// local iteration; a malformed override (empty string coerces to 0,
// non-numeric to NaN) is ignored rather than allowed to collapse the wait into
// an immediate failure.
const QUEUE_IDLE_TIMEOUT_MS = (() => {
  let override = Number(process.env.TEST_HARNESS_QUEUE_IDLE_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : 300_000;
})();

export async function waitForQueueIdle(databaseName: string): Promise<void> {
  await logTimed(templateLog, `waitForQueueIdle ${databaseName}`, async () => {
    try {
      await waitUntil(
        async () => {
          let client = new PgClient(pgAdminConnectionConfig(databaseName));
          try {
            await client.connect();
            // A rejected job means the template would snapshot with silently
            // missing data (e.g. absent prerendered HTML) and resurface later
            // as confusing failures in unrelated tests. Fail here, loudly and
            // immediately, instead of draining the full timeout first.
            let { rows: rejected } = await client.query<{
              id: number;
              job_type: string;
            }>(
              `SELECT id, job_type FROM jobs WHERE status = 'rejected' ORDER BY id`,
            );
            if (rejected.length > 0) {
              let sampleLimit = 20;
              let sample = rejected
                .slice(0, sampleLimit)
                .map((row) => `${row.job_type}#${row.id}`)
                .join(', ');
              let overflow =
                rejected.length > sampleLimit
                  ? ` (+${rejected.length - sampleLimit} more)`
                  : '';
              throw new Error(
                `${rejected.length} job(s) rejected while waiting for queue to become idle in ${databaseName}: ${sample}${overflow}`,
              );
            }
            let {
              rows: [{ count: unfulfilledJobs }],
            } = await client.query<{ count: number }>(
              `SELECT COUNT(*)::int AS count FROM jobs WHERE status = 'unfulfilled'`,
            );
            let {
              rows: [{ count: activeReservations }],
            } = await client.query<{ count: number }>(
              `SELECT COUNT(*)::int AS count FROM job_reservations WHERE completed_at IS NULL`,
            );
            return unfulfilledJobs === 0 && activeReservations === 0;
          } finally {
            await client.end();
          }
        },
        {
          timeout: QUEUE_IDLE_TIMEOUT_MS,
          interval: 100,
          timeoutMessage: `Timed out waiting for queue to become idle in ${databaseName}`,
        },
      );
    } catch (error) {
      // Whether we timed out or bailed on a rejected job, dump what the queue
      // still holds so the next CI failure is diagnosable in one pass — is it a
      // slow-but-progressing prerender_html drain (raise the budget) or a
      // genuinely wedged worker holding a reservation (a real bug)?
      let backlog = await describeQueueBacklog(databaseName).catch(
        (e) =>
          `  (failed to gather queue diagnostics: ${(e as Error).message})`,
      );
      let err = error instanceof Error ? error : new Error(String(error));
      err.message = `${err.message}\n${backlog}`;
      throw err;
    }
  });
}

// Snapshot of what the queue still holds, for the waitForQueueIdle failure
// path. Best-effort: any query error is reported inline rather than masking the
// original timeout / rejection.
async function describeQueueBacklog(databaseName: string): Promise<string> {
  let client = new PgClient(pgAdminConnectionConfig(databaseName));
  try {
    await client.connect();
    let { rows: statusRows } = await client.query<{
      status: string;
      job_type: string;
      count: number;
    }>(
      `SELECT status, job_type, COUNT(*)::int AS count
         FROM jobs
        WHERE status IN ('unfulfilled', 'rejected')
        GROUP BY status, job_type
        ORDER BY status, count DESC`,
    );
    let { rows: reservationRows } = await client.query<{
      job_id: number;
      job_type: string | null;
      worker_id: string | null;
      age_s: number | null;
      locked_for_s: number | null;
    }>(
      `SELECT jr.job_id, j.job_type, jr.worker_id,
              EXTRACT(EPOCH FROM (now() - jr.created_at))::int AS age_s,
              EXTRACT(EPOCH FROM (jr.locked_until - now()))::int AS locked_for_s
         FROM job_reservations jr
         LEFT JOIN jobs j ON j.id = jr.job_id
        WHERE jr.completed_at IS NULL
        ORDER BY jr.created_at ASC
        LIMIT 20`,
    );
    let jobs =
      statusRows.length > 0
        ? statusRows
            .map((r) => `${r.job_type}[${r.status}]=${r.count}`)
            .join(', ')
        : 'none';
    let reservations =
      reservationRows.length > 0
        ? reservationRows
            .map(
              (r) =>
                `job ${r.job_id} (${r.job_type ?? '?'}) worker=${
                  r.worker_id ?? '?'
                } age=${r.age_s ?? '?'}s locked_for=${r.locked_for_s ?? '?'}s`,
            )
            .join('\n    ')
        : 'none';
    return `  pending jobs: ${jobs}\n  in-flight reservations (oldest first):\n    ${reservations}`;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Build a template database containing one or more realm fixtures.
 * Each realm's permissions come from its own `RealmConfig.permissions`
 * (or `DEFAULT_PERMISSIONS` if not provided). Base realm permissions are
 * always seeded; the harness no longer treats any user realm specially.
 */
export async function buildCombinedTemplateDatabase({
  realms,
  realmServerURL,
  context,
  cacheKey,
  templateDatabaseName,
  publicPortReservation,
}: {
  realms: RealmConfig[];
  realmServerURL: URL;
  context: FactorySupportContext;
  cacheKey: string;
  templateDatabaseName: string;
  /** Holder for the public realm-server port, allocated and held upstream
   *  in `resolveFactoryRealmServerURL`. Threaded straight into
   *  `startIsolatedRealmStack`, which releases it right before the compat
   *  proxy binds. Keeping it held across this build keeps the
   *  worker-manager hold below (and the support-service ports allocated
   *  before this call) from being handed the public port number. */
  publicPortReservation?: PortReservation;
}): Promise<void> {
  if (realms.length === 0) {
    throw new Error(
      'buildCombinedTemplateDatabase requires at least one realm',
    );
  }

  await logTimed(
    templateLog,
    `buildCombinedTemplateDatabase ${templateDatabaseName} (${realms.length} realms)`,
    async () => {
      let builderDatabaseName = builderDatabaseNameForCacheKey(cacheKey);
      let hasMigratedTemplate = await databaseExists(
        DEFAULT_MIGRATED_TEMPLATE_DB,
      );

      await dropDatabase(templateDatabaseName);
      await dropDatabase(builderDatabaseName);

      if (hasMigratedTemplate) {
        await cloneDatabaseFromTemplate(
          DEFAULT_MIGRATED_TEMPLATE_DB,
          builderDatabaseName,
        );
      }

      let baseRealmURL = baseRealmURLFor(realmServerURL);
      let realmURLs = realms.map((realm) =>
        realmURLWithinServer(realmServerURL, realm.path),
      );

      await resetMountedRealmState(builderDatabaseName, [
        ...realmURLs,
        baseRealmURL,
      ]);
      await resetQueueState(builderDatabaseName);

      for (let i = 0; i < realms.length; i++) {
        await seedRealmPermissions(
          builderDatabaseName,
          realmURLs[i],
          realms[i].permissions ?? DEFAULT_PERMISSIONS,
        );
      }
      await seedRealmPermissions(
        builderDatabaseName,
        baseRealmURL,
        DEFAULT_BASE_REALM_PERMISSIONS,
      );

      // Hold the worker-manager port across the gap between allocation and
      // the actual child bind inside startIsolatedRealmStack — without the
      // hold, sibling findAvailablePort() calls (for the realm-server,
      // prerender, etc) can be handed back the same port number by the OS
      // and the worker-manager later races them and dies with EADDRINUSE.
      // startIsolatedRealmStack releases the holder right before spawning
      // the worker-manager child.
      let wmReservation = await findAndHoldAvailablePort();
      // base + each user realm
      let progress = startIndexingProgressReporter(
        wmReservation.port,
        1 + realms.length,
      );

      let stack;
      try {
        stack = await startIsolatedRealmStack({
          realms,
          realmServerURL,
          databaseName: builderDatabaseName,
          context,
          migrateDB: !hasMigratedTemplate,
          fullIndexOnStartup: true,
          workerManagerPort: wmReservation,
          publicPortReservation,
        });
      } catch (error) {
        progress.stop();
        // startIsolatedRealmStack releases its own holders on failure, but
        // be defensive in case the throw happened before it took ownership.
        await wmReservation.release().catch(() => undefined);
        throw error;
      }

      try {
        await waitForQueueIdle(builderDatabaseName);
      } finally {
        progress.stop();
        await stopIsolatedRealmStack(stack);
      }

      await createTemplateSnapshot(builderDatabaseName, templateDatabaseName);
      await dropDatabase(builderDatabaseName);
    },
  );
}
