import { resolve } from 'node:path';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  readPreparedTemplateMetadata,
  writePreparedTemplateMetadata,
} from '../runtime-metadata';
import {
  buildRealmToken,
  CACHE_VERSION,
  DEFAULT_BASE_REALM_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  DEFAULT_REALM_DIR,
  DEFAULT_REALM_OWNER,
  DEFAULT_SOURCE_REALM_PERMISSIONS,
  hashRealmFixture,
  sourceRealmDir,
  harnessLog,
  hasTemplateDatabaseName,
  logTimed,
  parseFactoryContext,
  resolveFactoryRealmLocation,
  runtimeDatabaseName,
  stableStringify,
  templateDatabaseNameForCacheKey,
  hashString,
  hashCombinedRealmFixtures,
  baseRealmURLFor,
  realmRelativePath,
  sourceRealmURLFor,
  type CombinedRealmFixture,
  realmLog,
  type FactoryGlobalContextHandle,
  type FactoryRealmOptions,
  type FactoryRealmTemplate,
  type FactorySupportContext,
  type FactoryTestContext,
  type RealmAction,
  type StartedFactoryRealm,
} from './shared';
import {
  buildCombinedTemplateDatabase,
  buildTemplateDatabase,
  clearModuleCache,
  clearRealmPermissions,
  cloneDatabaseFromTemplate,
  databaseExists,
  dropDatabase,
  rebuildWorkingIndexFromIndex,
  resetQueueState,
  rewriteClonedRealmServerUrls,
  seedRealmPermissions,
  warnIfSnapshotLooksCold,
} from './database';
import {
  checkCommittedSnapshot,
  isCanonicalFixtureSet,
  restoreTemplateFromDisk,
  saveSnapshot,
} from './db-snapshot';
import { startFactorySupportServices } from './support-services';
import {
  startIsolatedRealmStack,
  stopIsolatedRealmStack,
} from './isolated-realm-stack';

export function getFactoryTestContext(): FactoryTestContext {
  let context = parseFactoryContext();
  if (!context) {
    throw new Error('SOFTWARE_FACTORY_CONTEXT is not defined');
  }
  return context;
}

export { startFactorySupportServices };

export async function startFactoryGlobalContext(
  options: FactoryRealmOptions = {},
): Promise<FactoryGlobalContextHandle> {
  return await logTimed(harnessLog, 'startFactoryGlobalContext', async () => {
    let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
    let { realmURL, realmServerURL } = await resolveFactoryRealmLocation({
      realmURL: options.realmURL,
      realmServerURL: options.realmServerURL,
      compatRealmServerPort: options.compatRealmServerPort,
    });
    let support = await startFactorySupportServices();
    try {
      let template = await ensureFactoryRealmTemplate({
        ...options,
        realmDir,
        realmURL,
        realmServerURL,
        context: support.context,
      });

      let context: FactoryTestContext = {
        ...support.context,
        cacheKey: template.cacheKey,
        fixtureHash: template.fixtureHash,
        realmDir,
        realmURL: realmURL.href,
        realmServerURL: realmServerURL.href,
        templateDatabaseName: template.templateDatabaseName,
      };

      return {
        context,
        stop: support.stop,
      };
    } catch (error) {
      await support.stop();
      throw error;
    }
  });
}

export async function ensureFactoryRealmTemplate(
  options: FactoryRealmOptions = {},
): Promise<FactoryRealmTemplate> {
  return await logTimed(harnessLog, 'ensureFactoryRealmTemplate', async () => {
    let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
    let contextRealmURL =
      options.context && hasTemplateDatabaseName(options.context)
        ? new URL(options.context.realmURL)
        : undefined;
    let contextRealmServerURL =
      options.context && hasTemplateDatabaseName(options.context)
        ? new URL(options.context.realmServerURL)
        : undefined;
    let { realmURL, realmServerURL } = await resolveFactoryRealmLocation({
      realmURL: options.realmURL ?? contextRealmURL,
      realmServerURL: options.realmServerURL ?? contextRealmServerURL,
      compatRealmServerPort: options.compatRealmServerPort,
    });
    let permissions = options.permissions ?? DEFAULT_PERMISSIONS;
    let fixtureHash = hashRealmFixture(realmDir);
    let sourceRealmHash = hashRealmFixture(sourceRealmDir);
    let realmPath = realmRelativePath(realmURL, realmServerURL);
    let cacheKey = hashString(
      stableStringify({
        version: CACHE_VERSION,
        realmPath,
        permissions,
        fixtureHash,
        sourceRealmHash,
        cacheSalt:
          options.cacheSalt ?? process.env.SOFTWARE_FACTORY_CACHE_SALT ?? null,
      }),
    );
    let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
    let cachedTemplateMetadata =
      readPreparedTemplateMetadata(templateDatabaseName);
    let hasTemplateDatabase = await databaseExists(templateDatabaseName);

    if (hasTemplateDatabase && cachedTemplateMetadata) {
      return {
        cacheKey,
        templateDatabaseName,
        fixtureHash,
        cacheHit: true,
        realmURL: new URL(cachedTemplateMetadata.templateRealmURL),
        realmServerURL: new URL(cachedTemplateMetadata.templateRealmServerURL),
      };
    }

    let cacheMissReason = !cachedTemplateMetadata
      ? hasTemplateDatabase
        ? 'template metadata is missing'
        : 'template database has not been prepared yet'
      : 'template database is missing';

    // Tier 2: Try restoring from committed pg_dump snapshot.
    // Only attempt when the DB is actually missing (not when metadata is missing
    // but the DB exists — CREATE DATABASE would fail in that case).
    let snapshotFixtures: CombinedRealmFixture[] = [
      { realmDir, realmPath: realmRelativePath(realmURL, realmServerURL) },
    ];
    if (!hasTemplateDatabase) {
      let snapshotData = checkCommittedSnapshot(snapshotFixtures);
      if (snapshotData) {
        harnessLog.info(
          'Restoring template from committed snapshot (fast path)',
        );
        let snapshotServerURL = new URL(snapshotData.realmServerURL);
        let snapshotRealmURL = new URL(
          realmRelativePath(realmURL, realmServerURL),
          snapshotServerURL,
        );
        try {
          await restoreTemplateFromDisk(templateDatabaseName);
          writePreparedTemplateMetadata({
            realmDir,
            templateDatabaseName,
            templateRealmURL: snapshotRealmURL.href,
            templateRealmServerURL: snapshotData.realmServerURL,
          });
          return {
            cacheKey,
            templateDatabaseName,
            fixtureHash,
            cacheHit: false,
            cacheMissReason: 'restored from snapshot',
            realmURL: snapshotRealmURL,
            realmServerURL: snapshotServerURL,
          };
        } catch (error) {
          harnessLog.warn(
            `Snapshot restore failed, falling back to full build: ${error}`,
          );
          try {
            await dropDatabase(templateDatabaseName);
          } catch {
            /* best effort */
          }
        }
      } else {
        harnessLog.info(
          'Snapshot not available or stale, proceeding with full build',
        );
      }
    }

    // Tier 3: Full build from scratch.
    let ownedSupport:
      | {
          context: FactorySupportContext;
          stop(): Promise<void>;
        }
      | undefined;
    let context = options.context;
    if (!context) {
      ownedSupport = await startFactorySupportServices();
      context = ownedSupport.context;
    }

    try {
      await buildTemplateDatabase({
        realmDir,
        realmURL,
        realmServerURL,
        permissions,
        context,
        cacheKey,
        templateDatabaseName,
      });
      writePreparedTemplateMetadata({
        realmDir,
        templateDatabaseName,
        templateRealmURL: realmURL.href,
        templateRealmServerURL: realmServerURL.href,
      });

      // Save snapshot for future fast restores (only for canonical fixtures).
      if (isCanonicalFixtureSet(snapshotFixtures)) {
        try {
          await saveSnapshot(
            templateDatabaseName,
            realmServerURL.href,
            snapshotFixtures,
          );
        } catch (error) {
          harnessLog.warn(`Failed to save snapshot: ${error}`);
        }
      }

      return {
        cacheKey,
        templateDatabaseName,
        fixtureHash,
        cacheHit: false,
        cacheMissReason,
        realmURL,
        realmServerURL,
      };
    } finally {
      await ownedSupport?.stop();
    }
  });
}

export interface CombinedRealmTemplateResult {
  cacheKey: string;
  templateDatabaseName: string;
  combinedFixtureHash: string;
  cacheHit: boolean;
  cacheMissReason?: string;
  coveredRealmDirs: string[];
  realmServerURL: URL;
}

/**
 * Ensure a combined template database exists for multiple realm fixtures.
 * All fixture realms are pre-indexed in a single DB, so any test requesting
 * any of the covered realms gets a cache hit from the same template.
 */
export async function ensureCombinedFactoryRealmTemplate(
  fixtures: CombinedRealmFixture[],
  options: {
    context?: FactorySupportContext;
    permissions?: Record<string, RealmAction[]>;
    cacheSalt?: string;
  } = {},
): Promise<CombinedRealmTemplateResult> {
  return await logTimed(
    harnessLog,
    `ensureCombinedFactoryRealmTemplate (${fixtures.length} realms)`,
    async () => {
      if (fixtures.length === 0) {
        throw new Error('At least one realm fixture is required');
      }

      // Resolve realm server URL from context or default.
      let contextRealmServerURL =
        options.context && hasTemplateDatabaseName(options.context)
          ? new URL(options.context.realmServerURL)
          : undefined;
      let { realmServerURL } = await resolveFactoryRealmLocation({
        realmServerURL: contextRealmServerURL,
      });

      let permissions = options.permissions ?? DEFAULT_PERMISSIONS;
      let sourceRealmHash = hashRealmFixture(sourceRealmDir);
      let combinedFixtureHash = hashCombinedRealmFixtures(fixtures);

      let cacheKey = hashString(
        stableStringify({
          version: CACHE_VERSION,
          combinedFixtureHash,
          sourceRealmHash,
          permissions,
          cacheSalt:
            options.cacheSalt ??
            process.env.SOFTWARE_FACTORY_CACHE_SALT ??
            null,
        }),
      );
      let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
      let hasTemplateDatabase = await databaseExists(templateDatabaseName);
      let cachedTemplateMetadata =
        readPreparedTemplateMetadata(templateDatabaseName);

      if (hasTemplateDatabase && cachedTemplateMetadata) {
        return {
          cacheKey,
          templateDatabaseName,
          combinedFixtureHash,
          cacheHit: true,
          coveredRealmDirs: fixtures.map((f) => resolve(f.realmDir)),
          realmServerURL: new URL(
            cachedTemplateMetadata.templateRealmServerURL,
          ),
        };
      }

      let cacheMissReason = !cachedTemplateMetadata
        ? hasTemplateDatabase
          ? 'template metadata is missing'
          : 'template database has not been prepared yet'
        : 'template database is missing';

      // Resolve fixtures with absolute paths for snapshot operations.
      let resolvedFixtures: CombinedRealmFixture[] = fixtures.map((f) => ({
        realmDir: resolve(f.realmDir),
        realmPath: f.realmPath,
      }));

      // Tier 2: Try restoring from committed pg_dump snapshot.
      // Only attempt when the DB is actually missing (not when metadata is missing
      // but the DB exists — CREATE DATABASE would fail in that case).
      if (!hasTemplateDatabase) {
        let snapshotData = checkCommittedSnapshot(resolvedFixtures);
        if (snapshotData) {
          harnessLog.info(
            'Restoring template from committed snapshot (fast path)',
          );
          try {
            await restoreTemplateFromDisk(templateDatabaseName);
            writePreparedTemplateMetadata({
              realmDir: resolvedFixtures[0].realmDir,
              templateDatabaseName,
              templateRealmURL:
                snapshotData.realmServerURL + resolvedFixtures[0].realmPath,
              templateRealmServerURL: snapshotData.realmServerURL,
              coveredRealmDirs: resolvedFixtures.map((f) => f.realmDir),
            });
            return {
              cacheKey,
              templateDatabaseName,
              combinedFixtureHash,
              cacheHit: false,
              cacheMissReason: 'restored from snapshot',
              coveredRealmDirs: resolvedFixtures.map((f) => f.realmDir),
              realmServerURL: new URL(snapshotData.realmServerURL),
            };
          } catch (error) {
            harnessLog.warn(
              `Snapshot restore failed, falling back to full build: ${error}`,
            );
            try {
              await dropDatabase(templateDatabaseName);
            } catch {
              /* best effort */
            }
          }
        } else {
          harnessLog.info(
            'Snapshot not available or stale, proceeding with full build',
          );
        }
      }

      // Tier 3: Full build from scratch.
      let ownedSupport:
        | { context: FactorySupportContext; stop(): Promise<void> }
        | undefined;
      let context = options.context;
      if (!context) {
        ownedSupport = await startFactorySupportServices();
        context = ownedSupport.context;
      }

      try {
        // Resolve realm URLs for each fixture.
        let realmFixtures = resolvedFixtures.map((f) => {
          let realmURL = new URL(f.realmPath, realmServerURL);
          return {
            realmDir: f.realmDir,
            realmURL,
          };
        });

        await buildCombinedTemplateDatabase({
          realmFixtures,
          realmServerURL,
          permissions,
          context,
          cacheKey,
          templateDatabaseName,
        });

        // Write metadata for the primary realm (for backward compat).
        writePreparedTemplateMetadata({
          realmDir: realmFixtures[0].realmDir,
          templateDatabaseName,
          templateRealmURL: realmFixtures[0].realmURL.href,
          templateRealmServerURL: realmServerURL.href,
        });

        // Save snapshot for future fast restores (only for canonical fixtures).
        if (isCanonicalFixtureSet(resolvedFixtures)) {
          try {
            await saveSnapshot(
              templateDatabaseName,
              realmServerURL.href,
              resolvedFixtures,
            );
          } catch (error) {
            harnessLog.warn(`Failed to save snapshot: ${error}`);
          }
        }

        return {
          cacheKey,
          templateDatabaseName,
          combinedFixtureHash,
          cacheHit: false,
          cacheMissReason,
          coveredRealmDirs: realmFixtures.map((f) => f.realmDir),
          realmServerURL,
        };
      } finally {
        await ownedSupport?.stop();
      }
    },
  );
}

export async function startFactoryRealmServer(
  options: FactoryRealmOptions = {},
): Promise<StartedFactoryRealm> {
  return await logTimed(harnessLog, 'startFactoryRealmServer', async () => {
    let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
    let existingContext = options.context ?? parseFactoryContext();
    let contextRealmURL =
      existingContext && hasTemplateDatabaseName(existingContext)
        ? new URL(existingContext.realmURL)
        : undefined;
    let contextRealmServerURL =
      existingContext && hasTemplateDatabaseName(existingContext)
        ? new URL(existingContext.realmServerURL)
        : undefined;
    let { realmURL, realmServerURL } = await resolveFactoryRealmLocation({
      realmURL: options.realmURL ?? contextRealmURL,
      realmServerURL: options.realmServerURL ?? contextRealmServerURL,
      compatRealmServerPort: options.compatRealmServerPort,
    });
    let templateDatabaseName = options.templateDatabaseName;
    let databaseName = runtimeDatabaseName();

    let ownedGlobalContext: FactoryGlobalContextHandle | undefined;
    let context = existingContext;
    if (!context) {
      ownedGlobalContext = await startFactoryGlobalContext({
        ...options,
        realmDir,
        realmURL,
        realmServerURL,
      });
      context = ownedGlobalContext.context;
    }

    if (!templateDatabaseName) {
      templateDatabaseName = hasTemplateDatabaseName(context)
        ? context.templateDatabaseName
        : (
            await ensureFactoryRealmTemplate({
              ...options,
              realmDir,
              realmURL,
              realmServerURL,
              context,
            })
          ).templateDatabaseName;
    }

    let stack;
    try {
      let baseRealmURL = baseRealmURLFor(realmServerURL);
      let sourceRealmURL = sourceRealmURLFor(realmServerURL);
      await dropDatabase(databaseName);
      await cloneDatabaseFromTemplate(templateDatabaseName, databaseName);

      // Always rewrite URLs if the template was built with a different realm
      // server URL. Without this, cloned permissions reference the template's
      // port, causing 401 when the runtime uses a different port.
      let templateServerURL =
        options.templateRealmServerURL ??
        (readPreparedTemplateMetadata(templateDatabaseName)
          ?.templateRealmServerURL
          ? new URL(
              readPreparedTemplateMetadata(templateDatabaseName)!
                .templateRealmServerURL,
            )
          : undefined);
      if (templateServerURL && templateServerURL.href !== realmServerURL.href) {
        await rewriteClonedRealmServerUrls(
          databaseName,
          templateServerURL,
          realmServerURL,
        );
      }
      await resetQueueState(databaseName);
      await clearModuleCache(databaseName);
      await rebuildWorkingIndexFromIndex(databaseName);
      await warnIfSnapshotLooksCold(databaseName, [
        realmURL,
        baseRealmURL,
        sourceRealmURL,
      ]);
      await seedRealmPermissions(
        databaseName,
        baseRealmURL,
        DEFAULT_BASE_REALM_PERMISSIONS,
      );
      await seedRealmPermissions(
        databaseName,
        sourceRealmURL,
        DEFAULT_SOURCE_REALM_PERMISSIONS,
      );

      // Apply custom test-realm permissions if provided. We clear the
      // template's permissions first so leftover rows (e.g. the default
      // '*' public-read grant) don't leak into the private realm.
      let permissions = options.permissions;
      if (permissions) {
        await clearRealmPermissions(databaseName, realmURL);
        await seedRealmPermissions(databaseName, realmURL, permissions);
      }

      stack = await startIsolatedRealmStack({
        realmDir,
        realmURL,
        realmServerURL,
        databaseName,
        context,
        migrateDB: false,
        fullIndexOnStartup: false,
        realmServerPort: options.realmServerPort,
        prerenderURL: options.prerenderURL,
      });
    } catch (error) {
      let cleanupError: unknown;

      try {
        await dropDatabase(databaseName);
      } catch (cleanupFailure) {
        cleanupError ??= cleanupFailure;
      }

      try {
        await ownedGlobalContext?.stop();
      } catch (cleanupFailure) {
        cleanupError ??= cleanupFailure;
      }

      if (cleanupError) {
        throw cleanupError;
      }

      throw error;
    }

    return {
      realmDir,
      realmURL,
      realmServerURL,
      databaseName,
      ports: stack.ports,
      childPids: [stack.realmServer.pid, stack.workerManager.pid].filter(
        (pid): pid is number => pid != null,
      ),
      cardURL(path: string) {
        return new URL(path, realmURL).href;
      },
      createBearerToken(
        user = DEFAULT_REALM_OWNER,
        permissions?: RealmAction[],
      ) {
        return buildRealmToken(realmURL, realmServerURL, user, permissions);
      },
      authorizationHeaders(user?: string, permissions?: RealmAction[]) {
        return {
          Authorization: `Bearer ${buildRealmToken(
            realmURL,
            realmServerURL,
            user,
            permissions,
          )}`,
        };
      },
      async stop() {
        await logTimed(
          realmLog,
          `stopFactoryRealmServer ${databaseName}`,
          async () => {
            let cleanupError: unknown;

            try {
              await stopIsolatedRealmStack(stack);
            } catch (error) {
              cleanupError ??= error;
            }

            try {
              await dropDatabase(databaseName);
            } catch (error) {
              cleanupError ??= error;
            }

            try {
              await ownedGlobalContext?.stop();
            } catch (error) {
              cleanupError ??= error;
            }

            if (cleanupError) {
              throw cleanupError;
            }
          },
        );
      },
    };
  });
}

export async function fetchRealmCardJson(
  path: string,
  options: FactoryRealmOptions = {},
) {
  return await logTimed(harnessLog, `fetchRealmCardJson ${path}`, async () => {
    let runtime = await startFactoryRealmServer(options);
    try {
      let response = await fetch(runtime.cardURL(path), {
        headers: {
          Accept: SupportedMimeType.CardJson,
        },
      });
      return {
        status: response.status,
        body: await response.text(),
        url: response.url,
      };
    } finally {
      await runtime.stop();
    }
  });
}
