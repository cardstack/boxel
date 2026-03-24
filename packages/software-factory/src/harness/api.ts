import { resolve } from 'node:path';

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
  baseRealmURLFor,
  sourceRealmURLFor,
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
  buildTemplateDatabase,
  clearModuleCache,
  cloneDatabaseFromTemplate,
  databaseExists,
  dropDatabase,
  rebuildWorkingIndexFromIndex,
  resetQueueState,
  rewriteClonedRealmServerUrls,
  seedRealmPermissions,
  warnIfSnapshotLooksCold,
} from './database';
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
    });
    let permissions = options.permissions ?? DEFAULT_PERMISSIONS;
    let fixtureHash = hashRealmFixture(realmDir);
    let sourceRealmHash = hashRealmFixture(sourceRealmDir);
    let cacheKey = hashString(
      stableStringify({
        version: CACHE_VERSION,
        realmURL: realmURL.href,
        permissions,
        fixtureHash,
        sourceRealmHash,
        cacheSalt:
          options.cacheSalt ?? process.env.SOFTWARE_FACTORY_CACHE_SALT ?? null,
      }),
    );
    let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);

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
      if (await databaseExists(templateDatabaseName)) {
        return {
          cacheKey,
          templateDatabaseName,
          fixtureHash,
          cacheHit: true,
          realmURL,
          realmServerURL,
        };
      }

      await buildTemplateDatabase({
        realmDir,
        realmURL,
        realmServerURL,
        permissions,
        context,
        cacheKey,
        templateDatabaseName,
      });

      return {
        cacheKey,
        templateDatabaseName,
        fixtureHash,
        cacheHit: false,
        realmURL,
        realmServerURL,
      };
    } finally {
      await ownedSupport?.stop();
    }
  });
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
      if (options.templateRealmServerURL) {
        await rewriteClonedRealmServerUrls(
          databaseName,
          options.templateRealmServerURL,
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

      stack = await startIsolatedRealmStack({
        realmDir,
        realmURL,
        realmServerURL,
        databaseName,
        context,
        migrateDB: false,
        fullIndexOnStartup: false,
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
          Accept: 'application/vnd.card+json',
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
