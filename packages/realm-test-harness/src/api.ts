import { resolve } from 'node:path';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  readPreparedTemplateMetadata,
  writePreparedTemplateMetadata,
} from './runtime-metadata';
import { configureLogger } from './logger';

/**
 * Suppress console.log/warn during a callback. Used during template DB builds
 * to silence noisy third-party code (e.g. synapse docker helpers) that
 * writes directly to the console instead of going through the logger.
 */
async function withSilentConsole<T>(fn: () => Promise<T>): Promise<T> {
  let origLog = console.log;
  let origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

import {
  buildRealmToken,
  CACHE_VERSION,
  DEFAULT_BASE_REALM_PERMISSIONS,
  DEFAULT_REALM_OWNER,
  harnessLog,
  hashRealms,
  hasTemplateDatabaseName,
  logTimed,
  parseFactoryContext,
  resolveFactoryRealmServerURL,
  realmURLWithinServer,
  runtimeDatabaseName,
  stableStringify,
  templateDatabaseNameForCacheKey,
  hashString,
  baseRealmURLFor,
  realmLog,
  type FactoryGlobalContextHandle,
  type FactoryRealmOptions,
  type FactoryRealmTemplate,
  type FactorySupportContext,
  type FactoryTestContext,
  type RealmAction,
  type RealmConfig,
  type StartedFactoryRealm,
} from './shared';
import {
  buildCombinedTemplateDatabase,
  clearRealmPermissions,
  cloneDatabaseFromTemplate,
  databaseExists,
  dropDatabase,
  rebuildWorkingIndexFromIndex,
  resetQueueState,
  rewriteClonedRealmServerUrls,
  seedRealmPermissions,
} from './database';
import { startFactorySupportServices } from './support-services';
import {
  startIsolatedRealmStack,
  stopIsolatedRealmStack,
} from './isolated-realm-stack';

export function getFactoryTestContext(): FactoryTestContext {
  let context = parseFactoryContext();
  if (!context) {
    throw new Error('TEST_HARNESS_CONTEXT is not defined');
  }
  return context;
}

export { startFactorySupportServices };

export async function startFactoryGlobalContext(
  options: FactoryRealmOptions,
): Promise<FactoryGlobalContextHandle> {
  return await logTimed(harnessLog, 'startFactoryGlobalContext', async () => {
    let realms = resolveRealms(options.realms);
    let realmServerURL = await resolveFactoryRealmServerURL(
      options.realmServerURL,
      options.compatRealmServerPort,
    );
    let primaryRealmURL = realmURLWithinServer(realmServerURL, realms[0].path);
    let support = await startFactorySupportServices();
    try {
      let template = await ensureFactoryRealmTemplate({
        ...options,
        realms,
        realmServerURL,
        context: support.context,
      });

      let context: FactoryTestContext = {
        ...support.context,
        cacheKey: template.cacheKey,
        fixtureHash: template.fixtureHash,
        realmDir: realms[0].dir,
        realmURL: primaryRealmURL.href,
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

function resolveRealms(realms: RealmConfig[]): RealmConfig[] {
  if (!realms || realms.length === 0) {
    throw new Error('FactoryRealmOptions.realms is required and non-empty');
  }
  return realms.map((realm) => ({
    ...realm,
    dir: resolve(realm.dir),
  }));
}

export async function ensureFactoryRealmTemplate(
  options: FactoryRealmOptions & { forceRebuild?: boolean },
): Promise<FactoryRealmTemplate> {
  return await logTimed(harnessLog, 'ensureFactoryRealmTemplate', async () => {
    let realms = resolveRealms(options.realms);
    let contextRealmServerURL =
      options.context && hasTemplateDatabaseName(options.context)
        ? new URL(options.context.realmServerURL)
        : undefined;
    let realmServerURL = await resolveFactoryRealmServerURL(
      options.realmServerURL ?? contextRealmServerURL,
      options.compatRealmServerPort,
    );
    let primaryRealmURL = realmURLWithinServer(realmServerURL, realms[0].path);
    let realmsHash = hashRealms(realms);
    let cacheKey = hashString(
      stableStringify({
        version: CACHE_VERSION,
        realmsHash,
        cacheSalt:
          options.cacheSalt ?? process.env.TEST_HARNESS_CACHE_SALT ?? null,
      }),
    );
    let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
    let cachedTemplateMetadata =
      readPreparedTemplateMetadata(templateDatabaseName);
    let hasTemplateDatabase = await databaseExists(templateDatabaseName);

    if (
      !options.forceRebuild &&
      hasTemplateDatabase &&
      cachedTemplateMetadata
    ) {
      return {
        cacheKey,
        templateDatabaseName,
        fixtureHash: realmsHash,
        cacheHit: true,
        realmURL: new URL(cachedTemplateMetadata.templateRealmURL),
        realmServerURL: new URL(cachedTemplateMetadata.templateRealmServerURL),
      };
    }

    let cacheMissReason = options.forceRebuild
      ? 'forced rebuild'
      : !cachedTemplateMetadata
        ? hasTemplateDatabase
          ? 'template metadata is missing'
          : 'template database has not been prepared yet'
        : 'template database is missing';

    // Full build from scratch.
    // Suppress noisy support-service logging during the build.
    let originalLogLevels = process.env.LOG_LEVELS || '*=info';
    configureLogger(
      originalLogLevels +
        ',software-factory:harness:support=none,support-services=none',
    );

    let ownedSupport:
      | {
          context: FactorySupportContext;
          stop(): Promise<void>;
        }
      | undefined;
    let context = options.context;

    try {
      if (!context) {
        ownedSupport = await withSilentConsole(() =>
          startFactorySupportServices(),
        );
        context = ownedSupport.context;
      }

      await buildCombinedTemplateDatabase({
        realms,
        realmServerURL,
        context,
        cacheKey,
        templateDatabaseName,
      });
      writePreparedTemplateMetadata({
        realmDir: realms[0].dir,
        templateDatabaseName,
        templateRealmURL: primaryRealmURL.href,
        templateRealmServerURL: realmServerURL.href,
      });

      return {
        cacheKey,
        templateDatabaseName,
        fixtureHash: realmsHash,
        cacheHit: false,
        cacheMissReason,
        realmURL: primaryRealmURL,
        realmServerURL,
      };
    } finally {
      configureLogger(originalLogLevels);
      await withSilentConsole(async () => ownedSupport?.stop());
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
 * Ensure a template database exists for the given realms. All realms are
 * pre-indexed in a single DB, so any test cloning the template gets every
 * realm ready to serve.
 */
export async function ensureCombinedFactoryRealmTemplate(
  realms: RealmConfig[],
  options: {
    context?: FactorySupportContext;
    cacheSalt?: string;
    forceRebuild?: boolean;
    realmServerURL?: URL;
    compatRealmServerPort?: number;
  } = {},
): Promise<CombinedRealmTemplateResult> {
  return await logTimed(
    harnessLog,
    `ensureCombinedFactoryRealmTemplate (${realms.length} realms)`,
    async () => {
      let resolvedRealms = resolveRealms(realms);
      let template = await ensureFactoryRealmTemplate({
        realms: resolvedRealms,
        context: options.context,
        cacheSalt: options.cacheSalt,
        forceRebuild: options.forceRebuild,
        realmServerURL: options.realmServerURL,
        compatRealmServerPort: options.compatRealmServerPort,
      });
      return {
        cacheKey: template.cacheKey,
        templateDatabaseName: template.templateDatabaseName,
        combinedFixtureHash: template.fixtureHash,
        cacheHit: template.cacheHit,
        cacheMissReason: template.cacheMissReason,
        coveredRealmDirs: resolvedRealms.map((r) => r.dir),
        realmServerURL: template.realmServerURL,
      };
    },
  );
}

export async function startFactoryRealmServer(
  options: FactoryRealmOptions,
): Promise<StartedFactoryRealm> {
  return await logTimed(harnessLog, 'startFactoryRealmServer', async () => {
    let realms = resolveRealms(options.realms);
    let primaryRealm = realms[0];
    let existingContext = options.context ?? parseFactoryContext();
    let contextRealmServerURL =
      existingContext && hasTemplateDatabaseName(existingContext)
        ? new URL(existingContext.realmServerURL)
        : undefined;
    let realmServerURL = await resolveFactoryRealmServerURL(
      options.realmServerURL ?? contextRealmServerURL,
      options.compatRealmServerPort,
    );
    let primaryRealmURL = realmURLWithinServer(
      realmServerURL,
      primaryRealm.path,
    );
    let templateDatabaseName = options.templateDatabaseName;
    let databaseName = runtimeDatabaseName();

    let ownedGlobalContext: FactoryGlobalContextHandle | undefined;
    let context = existingContext;
    if (!context) {
      ownedGlobalContext = await startFactoryGlobalContext({
        ...options,
        realms,
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
              realms,
              realmServerURL,
              context,
            })
          ).templateDatabaseName;
    }

    let stack;
    try {
      let baseRealmURL = baseRealmURLFor(realmServerURL);
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
      await rebuildWorkingIndexFromIndex(databaseName);
      await seedRealmPermissions(
        databaseName,
        baseRealmURL,
        DEFAULT_BASE_REALM_PERMISSIONS,
      );

      // When the caller passes an explicit `templateDatabaseName` (the
      // typical flow in CI / Playwright with a pre-built combined template),
      // realms whose RealmConfig.permissions differ from the template's
      // need their permissions re-seeded at runtime. Without this, a test
      // that requested e.g. private permissions on `realms[0]` would
      // inherit the template's '*': read grant. We clear first so the
      // template's row set is fully replaced.
      for (let realm of realms) {
        if (realm.permissions) {
          let realmURL = realmURLWithinServer(realmServerURL, realm.path);
          await clearRealmPermissions(databaseName, realmURL);
          await seedRealmPermissions(databaseName, realmURL, realm.permissions);
        }
      }

      stack = await startIsolatedRealmStack({
        realms,
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
      realmDir: primaryRealm.dir,
      realmURL: primaryRealmURL,
      realmServerURL,
      databaseName,
      ports: stack.ports,
      childPids: [stack.realmServer.pid, stack.workerManager.pid].filter(
        (pid): pid is number => pid != null,
      ),
      cardURL(path: string) {
        return new URL(path, primaryRealmURL).href;
      },
      createBearerToken(
        user = DEFAULT_REALM_OWNER,
        permissions?: RealmAction[],
      ) {
        return buildRealmToken(
          primaryRealmURL,
          realmServerURL,
          user,
          permissions,
        );
      },
      authorizationHeaders(user?: string, permissions?: RealmAction[]) {
        return {
          Authorization: `Bearer ${buildRealmToken(
            primaryRealmURL,
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
  options: FactoryRealmOptions,
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
