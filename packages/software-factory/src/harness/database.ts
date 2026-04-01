import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client as PgClient } from 'pg';

import {
  baseRealmDir,
  baseRealmURLFor,
  builderDatabaseNameForCacheKey,
  DEFAULT_BASE_REALM_PERMISSIONS,
  DEFAULT_MIGRATED_TEMPLATE_DB,
  DEFAULT_SOURCE_REALM_PERMISSIONS,
  logTimed,
  pgAdminConnectionConfig,
  quotePgIdentifier,
  shouldIgnoreFixturePath,
  sourceRealmDir,
  sourceRealmURLFor,
  templateLog,
  waitUntil,
  type FactorySupportContext,
  type RealmPermissions,
} from './shared';
import {
  startIsolatedRealmStack,
  stopIsolatedRealmStack,
} from './isolated-realm-stack';

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
        await client.query(`DELETE FROM realm_versions WHERE realm_url = $1`, [
          realmURL.href,
        ]);
        await client.query(`DELETE FROM realm_file_meta WHERE realm_url = $1`, [
          realmURL.href,
        ]);
        await client.query(
          `DELETE FROM published_realms
       WHERE source_realm_url = $1 OR published_realm_url = $1`,
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
               isolated_html = replace(isolated_html, $1, $2),
               embedded_html = replace(embedded_html::text, $1, $2)::jsonb,
               atom_html = replace(atom_html, $1, $2),
               fitted_html = replace(fitted_html::text, $1, $2)::jsonb,
               display_names = replace(display_names::text, $1, $2)::jsonb,
               icon_html = replace(icon_html, $1, $2),
               head_html = replace(head_html, $1, $2),
               last_known_good_deps = replace(last_known_good_deps::text, $1, $2)::jsonb`,
          [fromURL, toURL],
        );

        await client.query(
          `UPDATE realm_versions
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
        await client.query(
          `UPDATE published_realms
           SET source_realm_url = replace(source_realm_url, $1, $2),
               published_realm_url = replace(published_realm_url, $1, $2)`,
          [fromURL, toURL],
        );
        await client.query(
          `UPDATE session_rooms
           SET realm_url = replace(realm_url, $1, $2)`,
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
             realm_version,
             realm_url,
             pristine_doc,
             search_doc,
             error_doc,
             deps,
             types,
             icon_html,
             isolated_html,
             indexed_at,
             is_deleted,
             last_modified,
             embedded_html,
             atom_html,
             fitted_html,
             display_names,
             resource_created_at,
             head_html,
             has_error,
             last_known_good_deps
           )
           SELECT
             url,
             file_alias,
             type,
             realm_version,
             realm_url,
             pristine_doc,
             search_doc,
             error_doc,
             deps,
             types,
             icon_html,
             isolated_html,
             indexed_at,
             is_deleted,
             last_modified,
             embedded_html,
             atom_html,
             fitted_html,
             display_names,
             resource_created_at,
             head_html,
             has_error,
             last_known_good_deps
           FROM boxel_index`,
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

export async function warnIfSnapshotLooksCold(
  databaseName: string,
  realmURLs: URL[],
): Promise<void> {
  await logTimed(
    templateLog,
    `warnIfSnapshotLooksCold ${databaseName}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig(databaseName));
      try {
        await client.connect();

        let missing: string[] = [];
        for (let realmURL of realmURLs) {
          let indexResult = await client.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count
             FROM boxel_index
             WHERE realm_url = $1`,
            [realmURL.href],
          );
          let versionResult = await client.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count
             FROM realm_versions
             WHERE realm_url = $1`,
            [realmURL.href],
          );

          if (
            (indexResult.rows[0]?.count ?? 0) === 0 ||
            (versionResult.rows[0]?.count ?? 0) === 0
          ) {
            missing.push(realmURL.href);
          }
        }

        if (missing.length > 0) {
          templateLog.warn(
            `cloned harness snapshot is missing preindexed coverage for ${missing.join(
              ', ',
            )}; runtime may do a cold/full index. If schema or persisted index fields changed, update rewriteClonedRealmServerUrls() and rebuildWorkingIndexFromIndex().`,
          );
        }
      } finally {
        await client.end();
      }
    },
  );
}

function countFixtureFiles(dir: string): number {
  let count = 0;
  function visit(currentDir: string, relativePath: string) {
    for (let entry of readdirSync(currentDir, { withFileTypes: true })) {
      let entryRelativePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      if (shouldIgnoreFixturePath(entryRelativePath)) {
        continue;
      }
      let fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, entryRelativePath);
      } else if (entry.isFile()) {
        count++;
      }
    }
  }
  try {
    visit(dir, '');
  } catch {
    // If we can't count files, just return 0 and skip progress reporting
  }
  return count;
}

async function queryIndexedCount(databaseName: string): Promise<{
  indexed: number;
  errors: number;
}> {
  let client = new PgClient({
    ...pgAdminConnectionConfig(databaseName),
    connectionTimeoutMillis: 2000,
  });
  try {
    await client.connect();
    let { rows } = await client.query<{ total: number; errors: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE has_error)::int AS errors FROM boxel_index`,
    );
    return { indexed: rows[0]?.total ?? 0, errors: rows[0]?.errors ?? 0 };
  } catch {
    return { indexed: 0, errors: 0 };
  } finally {
    try {
      await client.end();
    } catch {
      // best effort cleanup
    }
  }
}

/**
 * Start a progress reporter that polls the database for indexing status and
 * writes updates to stderr. Returns a stop function.
 */
function startIndexingProgressReporter(
  databaseName: string,
  estimatedTotal: number,
): { stop: () => void } {
  let stopped = false;
  let polling = false;
  let lastReported = -1;
  let startedAt = Date.now();

  let report = async () => {
    if (stopped || polling) {
      return;
    }
    polling = true;
    try {
      let { indexed, errors } = await queryIndexedCount(databaseName);
      if (stopped) {
        return;
      }
      // Only report when the count changes or on the first poll.
      if (indexed === lastReported) {
        return;
      }
      lastReported = indexed;

      let elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      let errorSuffix = errors > 0 ? ` (${errors} errors)` : '';
      if (estimatedTotal > 0) {
        let pct = Math.min(100, Math.round((indexed / estimatedTotal) * 100));
        let barWidth = 30;
        let filled = Math.round((pct / 100) * barWidth);
        let bar = '='.repeat(filled) + ' '.repeat(barWidth - filled);
        process.stderr.write(
          `\r  indexing [${bar}] ${indexed}/${estimatedTotal} files (${pct}%) ${elapsed}s${errorSuffix}`,
        );
      } else {
        process.stderr.write(
          `\r  indexing ${indexed} files indexed ${elapsed}s${errorSuffix}`,
        );
      }
    } finally {
      polling = false;
    }
  };

  let interval = setInterval(() => void report(), 2000);
  // Do an immediate first check after a brief delay to let the DB initialize.
  let initialTimeout = setTimeout(() => void report(), 3000);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      clearTimeout(initialTimeout);
      // Clear the progress line and print final status.
      if (lastReported >= 0) {
        let elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        process.stderr.write(
          `\r  indexing complete: ${lastReported} files indexed in ${elapsed}s\n`,
        );
      }
    },
  };
}

export async function waitForQueueIdle(databaseName: string): Promise<void> {
  await logTimed(templateLog, `waitForQueueIdle ${databaseName}`, async () => {
    await waitUntil(
      async () => {
        let client = new PgClient(pgAdminConnectionConfig(databaseName));
        try {
          await client.connect();
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
        timeout: 30_000,
        interval: 100,
        timeoutMessage: `Timed out waiting for queue to become idle in ${databaseName}`,
      },
    );
  });
}

/**
 * Build a combined template database containing multiple realm fixtures.
 * The primary realm is indexed first, then additional realms are registered
 * and indexed in the same realm server process.
 */
export async function buildCombinedTemplateDatabase({
  realmFixtures,
  realmServerURL,
  permissions,
  context,
  cacheKey,
  templateDatabaseName,
}: {
  realmFixtures: { realmDir: string; realmURL: URL }[];
  realmServerURL: URL;
  permissions: RealmPermissions;
  context: FactorySupportContext;
  cacheKey: string;
  templateDatabaseName: string;
}): Promise<void> {
  if (realmFixtures.length === 0) {
    throw new Error(
      'buildCombinedTemplateDatabase requires at least one realm fixture',
    );
  }

  await logTimed(
    templateLog,
    `buildCombinedTemplateDatabase ${templateDatabaseName} (${realmFixtures.length} realms)`,
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
      let sourceRealmURL = sourceRealmURLFor(realmServerURL);

      let allRealmURLs = [
        ...realmFixtures.map((f) => f.realmURL),
        baseRealmURL,
        sourceRealmURL,
      ];
      await resetMountedRealmState(builderDatabaseName, allRealmURLs);
      await resetQueueState(builderDatabaseName);

      for (let fixture of realmFixtures) {
        await seedRealmPermissions(
          builderDatabaseName,
          fixture.realmURL,
          permissions,
        );
      }
      await seedRealmPermissions(
        builderDatabaseName,
        baseRealmURL,
        DEFAULT_BASE_REALM_PERMISSIONS,
      );
      await seedRealmPermissions(
        builderDatabaseName,
        sourceRealmURL,
        DEFAULT_SOURCE_REALM_PERMISSIONS,
      );

      // Use the first fixture as the primary realm, rest as additional.
      let [primary, ...rest] = realmFixtures;
      let additionalRealms = rest.map((f, i) => ({
        realmDir: f.realmDir,
        realmURL: f.realmURL,
        username: `additional_realm_${i}`,
      }));

      // Estimate total files for progress reporting.
      let estimatedTotal =
        realmFixtures.reduce(
          (sum, f) => sum + countFixtureFiles(f.realmDir),
          0,
        ) +
        countFixtureFiles(sourceRealmDir) +
        countFixtureFiles(baseRealmDir);
      let progress = startIndexingProgressReporter(
        builderDatabaseName,
        estimatedTotal,
      );

      let stack;
      try {
        stack = await startIsolatedRealmStack({
          realmDir: primary.realmDir,
          realmURL: primary.realmURL,
          realmServerURL,
          databaseName: builderDatabaseName,
          context,
          migrateDB: !hasMigratedTemplate,
          fullIndexOnStartup: true,
          additionalRealms,
        });
      } catch (error) {
        progress.stop();
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

export async function buildTemplateDatabase({
  realmDir,
  realmURL,
  realmServerURL,
  permissions,
  context,
  cacheKey,
  templateDatabaseName,
}: {
  realmDir: string;
  realmURL: URL;
  realmServerURL: URL;
  permissions: RealmPermissions;
  context: FactorySupportContext;
  cacheKey: string;
  templateDatabaseName: string;
}): Promise<void> {
  await logTimed(
    templateLog,
    `buildTemplateDatabase ${templateDatabaseName}`,
    async () => {
      let builderDatabaseName = builderDatabaseNameForCacheKey(cacheKey);
      let hasMigratedTemplate = await databaseExists(
        DEFAULT_MIGRATED_TEMPLATE_DB,
      );

      templateLog.debug(
        `buildTemplateDatabase: builder=${builderDatabaseName} migratedTemplate=${hasMigratedTemplate}`,
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
      let sourceRealmURL = sourceRealmURLFor(realmServerURL);

      await resetMountedRealmState(builderDatabaseName, [
        realmURL,
        baseRealmURL,
        sourceRealmURL,
      ]);
      await resetQueueState(builderDatabaseName);
      await seedRealmPermissions(builderDatabaseName, realmURL, permissions);
      await seedRealmPermissions(
        builderDatabaseName,
        baseRealmURL,
        DEFAULT_BASE_REALM_PERMISSIONS,
      );
      await seedRealmPermissions(
        builderDatabaseName,
        sourceRealmURL,
        DEFAULT_SOURCE_REALM_PERMISSIONS,
      );

      // Estimate total files for progress reporting: fixture + source realm + base realm.
      let estimatedTotal =
        countFixtureFiles(realmDir) +
        countFixtureFiles(sourceRealmDir) +
        countFixtureFiles(baseRealmDir);
      let progress = startIndexingProgressReporter(
        builderDatabaseName,
        estimatedTotal,
      );

      let stack;
      try {
        stack = await startIsolatedRealmStack({
          realmDir,
          realmURL,
          realmServerURL,
          databaseName: builderDatabaseName,
          context,
          migrateDB: !hasMigratedTemplate,
          fullIndexOnStartup: true,
        });
      } catch (error) {
        progress.stop();
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
