import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import type { RealmAction, RealmPermissions } from '@cardstack/runtime-common';

import {
  defaultSupportMetadataFile,
  type PreparedTemplateMetadata,
  readSupportMetadata,
} from '../src/runtime-metadata';
import { buildRealmToken, buildServerToken } from '../src/harness/shared';
import { startHarnessPrerenderServer } from '../src/harness/support-services';
import { buildBrowserState, installBrowserState } from './helpers/browser-auth';
import {
  allocateTestWorkerPortSet,
  type TestWorkerPortReservation,
} from './helpers/port-allocator';

type StartedFactoryRealm = {
  realmDir: string;
  realmURL: URL;
  realmServerURL: URL;
  /** The host app URL served by the compat proxy (for QUnit live-test pages). */
  hostAppUrl: string;
  ownerBearerToken: string;
  /** Realm server JWT for _run-command and other server-level endpoints. */
  serverToken: string;
  ports: {
    publicPort: number;
    realmServerPort: number;
    workerManagerPort: number;
  };
  cardURL(path: string): string;
  createBearerToken(user: string, permissions: RealmAction[]): string;
  authorizationHeaders(
    user?: string,
    permissions?: RealmAction[],
  ): Record<string, string>;
  stop(): Promise<void>;
};

export type FactoryRealmFixtures = {
  realmURL: URL;
  cardURL: (path: string) => string;
  authedPage: Page;
};

export type RealmServerMode = 'shared' | 'isolated';

type FactoryRealmOptions = {
  realmDir: string;
  realmServerMode: RealmServerMode;
  realmPermissions: RealmPermissions | undefined;
};

type FactoryRealmWorkerFixtures = {
  testWorkerPortSet: TestWorkerPortReservation;
  testWorkerPrerender: {
    url: string;
    stop(): Promise<void>;
  };
};

type FactoryRealmTestFixtures = {
  realm: StartedFactoryRealm;
};

type SharedRealmHandle = {
  realm: StartedFactoryRealm;
  refCount: number;
};

const packageRoot = resolve(process.cwd());
const tsNodeBin = resolve(packageRoot, 'node_modules', '.bin', 'ts-node');
const defaultRealmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'test-fixtures/darkfactory-adopter',
);
const sharedRealms = new Map<string, Promise<SharedRealmHandle>>();

function appendLog(buffer: string, chunk: string): string {
  let combined = `${buffer}${chunk}`;
  return combined.length > 20_000 ? combined.slice(-20_000) : combined;
}

function killProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    let nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'ESRCH') {
      throw error;
    }
  }
}

async function waitForPortFree(
  port: number,
  timeoutMs = 30_000,
): Promise<void> {
  let startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let free = await new Promise<boolean>((resolve, reject) => {
      let server = createServer();
      server.once('error', (error: NodeJS.ErrnoException) => {
        server.close(() => {
          if (error.code === 'EADDRINUSE') {
            resolve(false);
          } else {
            reject(error);
          }
        });
      });
      server.listen(port, '127.0.0.1', () => {
        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
          } else {
            resolve(true);
          }
        });
      });
    });
    if (free) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Port ${port} still in use after ${timeoutMs}ms`);
}

async function waitForMetadataFile<T>(
  metadataFile: string,
  child: ReturnType<typeof spawn>,
  getLogs: () => string,
  timeoutMs = 300_000,
): Promise<T> {
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(metadataFile)) {
      return JSON.parse(readFileSync(metadataFile, 'utf8')) as T;
    }

    if (child.exitCode !== null) {
      throw new Error(
        `software-factory child exited early with code ${child.exitCode}\n${getLogs()}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `timed out waiting for software-factory metadata file ${metadataFile}\n${getLogs()}`,
  );
}

async function startRealmProcess(
  realmDir = defaultRealmDir,
  testWorkerPortSet: TestWorkerPortReservation,
  testWorkerPrerenderURL: string,
  permissions?: RealmPermissions,
) {
  let tempDir = mkdtempSync(join(tmpdir(), 'software-factory-realm-'));
  let metadataFile = join(tempDir, 'runtime.json');
  let logs = '';
  let supportMetadata = existsSync(defaultSupportMetadataFile)
    ? (readSupportMetadata() as
        | {
            context?: Record<string, unknown>;
            templateDatabaseName?: string;
            templateRealmURL?: string;
            templateRealmServerURL?: string;
            realmDir?: string;
            preparedTemplates?: PreparedTemplateMetadata[];
          }
        | undefined)
    : undefined;
  let resolvedRealmDir = resolve(realmDir);
  let preparedTemplate =
    supportMetadata?.preparedTemplates?.find(
      (entry) =>
        resolve(entry.realmDir) === resolvedRealmDir ||
        entry.coveredRealmDirs?.some(
          (dir) => resolve(dir) === resolvedRealmDir,
        ),
    ) ??
    (supportMetadata?.realmDir != null &&
    resolve(supportMetadata.realmDir) === resolvedRealmDir &&
    supportMetadata.templateDatabaseName &&
    supportMetadata.templateRealmServerURL
      ? {
          realmDir: supportMetadata.realmDir,
          templateDatabaseName: supportMetadata.templateDatabaseName,
          templateRealmURL: supportMetadata.templateRealmURL ?? '',
          templateRealmServerURL: supportMetadata.templateRealmServerURL,
        }
      : undefined);

  // Release our holder sockets on the compat + realm-server ports right
  // before spawning the child. The realm child will bind to them in the
  // next few milliseconds; we reacquire the holders inside `stop()` below
  // after the child has exited so the ports stay ours between tests.
  await testWorkerPortSet.releaseRealmServerPorts();
  let child = spawn(
    tsNodeBin,
    [
      '--transpileOnly',
      'src/cli/serve-realm.ts',
      realmDir,
      `--compatRealmServerPort=${testWorkerPortSet.compatRealmServerPort}`,
      `--realmServerPort=${testWorkerPortSet.realmServerPort}`,
      `--prerenderURL=${testWorkerPrerenderURL}`,
    ],
    {
      cwd: packageRoot,
      detached: true,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        SOFTWARE_FACTORY_METADATA_FILE: metadataFile,
        ...(supportMetadata?.context
          ? {
              SOFTWARE_FACTORY_CONTEXT: JSON.stringify(supportMetadata.context),
            }
          : {}),
        ...(preparedTemplate
          ? {
              SOFTWARE_FACTORY_TEMPLATE_DATABASE_NAME:
                preparedTemplate.templateDatabaseName,
            }
          : {}),
        ...(preparedTemplate
          ? {
              SOFTWARE_FACTORY_TEMPLATE_REALM_SERVER_URL:
                preparedTemplate.templateRealmServerURL,
            }
          : {}),
        ...(permissions
          ? {
              SOFTWARE_FACTORY_PERMISSIONS: JSON.stringify(permissions),
            }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout?.on('data', (chunk) => {
    logs = appendLog(logs, String(chunk));
  });
  child.stderr?.on('data', (chunk) => {
    logs = appendLog(logs, String(chunk));
  });

  let metadata: {
    realmDir: string;
    realmURL: string;
    realmServerURL: string;
    ports: {
      publicPort: number;
      realmServerPort: number;
      workerManagerPort: number;
    };
    sampleCardURL: string;
    ownerBearerToken: string;
  };

  try {
    metadata = await waitForMetadataFile<{
      realmDir: string;
      realmURL: string;
      realmServerURL: string;
      ports: {
        publicPort: number;
        realmServerPort: number;
        workerManagerPort: number;
      };
      sampleCardURL: string;
      ownerBearerToken: string;
    }>(metadataFile, child, () => logs);
  } catch (error) {
    // Fully tear down the half-started child before re-acquiring our port
    // holders. Without the wait, the still-alive child can keep the ports
    // bound and the reacquire throws, leaving the ports unheld for the
    // rest of the worker's tests.
    try {
      if (child.exitCode === null) {
        killProcessGroup(child.pid!, 'SIGTERM');
        await new Promise<void>((resolvePromise) => {
          let timeout = setTimeout(() => {
            killProcessGroup(child.pid!, 'SIGKILL');
          }, 15_000);
          child.once('exit', () => {
            clearTimeout(timeout);
            resolvePromise();
          });
          child.once('error', () => {
            clearTimeout(timeout);
            resolvePromise();
          });
        });
      }
      await testWorkerPortSet.reacquireRealmServerPorts();
    } catch {
      // Cleanup errors must not mask the original startup failure.
    }
    throw error;
  }

  let stop = async () => {
    try {
      if (child.exitCode === null) {
        killProcessGroup(child.pid!, 'SIGTERM');
        await new Promise<void>((resolve, reject) => {
          let timeout = setTimeout(() => {
            killProcessGroup(child.pid!, 'SIGKILL');
          }, 15_000);

          child.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      await Promise.all([
        waitForPortFree(metadata.ports.realmServerPort),
        waitForPortFree(metadata.ports.publicPort),
        waitForPortFree(metadata.ports.workerManagerPort),
      ]);
      // Child has fully released its sockets; reclaim our holders on
      // compat + realm-server before the next test-scoped realm starts.
      await testWorkerPortSet.reacquireRealmServerPorts();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };

  return {
    realmDir: metadata.realmDir,
    realmURL: new URL(metadata.realmURL),
    realmServerURL: new URL(metadata.realmServerURL),
    hostAppUrl: `http://localhost:${metadata.ports.publicPort}`,
    ownerBearerToken: metadata.ownerBearerToken,
    serverToken: buildServerToken(),
    ports: metadata.ports,
    cardURL(path: string) {
      return new URL(path, metadata.realmURL).href;
    },
    createBearerToken(user: string, perms: RealmAction[]) {
      return buildRealmToken(
        new URL(metadata.realmURL),
        new URL(metadata.realmServerURL),
        user,
        perms,
      );
    },
    authorizationHeaders(user?: string, perms?: RealmAction[]) {
      if (!user && !perms) {
        return { Authorization: `Bearer ${metadata.ownerBearerToken}` };
      }
      if (!perms) {
        throw new Error(
          'authorizationHeaders: permissions must be provided when a user is specified',
        );
      }
      return {
        Authorization: `Bearer ${buildRealmToken(
          new URL(metadata.realmURL),
          new URL(metadata.realmServerURL),
          user,
          perms,
        )}`,
      };
    },
    stop,
  } satisfies StartedFactoryRealm;
}

function sharedRealmKey(
  workerIndex: number,
  testFile: string,
  realmDir: string,
) {
  return `${workerIndex}:${testFile}:${realmDir}`;
}

async function acquireSharedRealm(
  key: string,
  realmDir: string,
  testWorkerPortSet: TestWorkerPortReservation,
  testWorkerPrerenderURL: string,
): Promise<StartedFactoryRealm> {
  let existing = sharedRealms.get(key);
  if (!existing) {
    existing = startRealmProcess(
      realmDir,
      testWorkerPortSet,
      testWorkerPrerenderURL,
    ).then((realm) => ({
      realm,
      refCount: 0,
    }));
    sharedRealms.set(key, existing);
  }

  let handle = await existing;
  handle.refCount += 1;
  return handle.realm;
}

async function releaseSharedRealm(key: string): Promise<void> {
  let entry = sharedRealms.get(key);
  if (!entry) {
    return;
  }

  let handle = await entry;
  handle.refCount -= 1;

  if (handle.refCount <= 0) {
    sharedRealms.delete(key);
    await handle.realm.stop();
  }
}

export const test = base.extend<
  FactoryRealmFixtures & FactoryRealmOptions & FactoryRealmTestFixtures,
  FactoryRealmWorkerFixtures
>({
  realmDir: [defaultRealmDir, { option: true }],
  realmServerMode: ['shared', { option: true }],
  realmPermissions: [
    undefined as RealmPermissions | undefined,
    { option: true },
  ],
  testWorkerPortSet: [
    async ({ browserName: _browserName }, use, workerInfo) => {
      // These services are ephemeral per test, but we intentionally keep their
      // port assignments stable for the lifetime of a Playwright testWorker.
      // That gives each testWorker a consistent harness URL set even as the
      // underlying realm stack is torn down and recreated between tests.
      let reservation = await allocateTestWorkerPortSet(
        workerInfo.parallelIndex,
      );
      try {
        await use(reservation);
      } finally {
        await reservation.stop();
      }
    },
    { scope: 'worker' },
  ],
  testWorkerPrerender: [
    async ({ browserName: _browserName, testWorkerPortSet }, use) => {
      // Prerender is intentionally testWorker-scoped instead of test-scoped.
      // It is stateless, and now that the compat/realm ports are also stable
      // for the same Playwright testWorker, each restarted realm stack can
      // point back to the same prerender process without changing BOXEL_HOST_URL.
      let boxelHostURL = `http://localhost:${testWorkerPortSet.compatRealmServerPort}`;
      // Release the holder socket on the prerender port so the child can
      // bind. Prerender keeps this port for the rest of the worker's
      // lifetime, so there is no matching reacquire.
      await testWorkerPortSet.releasePrerenderPort();
      let prerender = await startHarnessPrerenderServer({
        boxelHostURL,
        port: testWorkerPortSet.prerenderPort,
      });
      try {
        await use(prerender);
      } finally {
        await prerender.stop();
      }
    },
    { scope: 'worker' },
  ],

  realm: async (
    {
      browserName: _browserName,
      realmDir,
      realmServerMode,
      realmPermissions: permissions,
      testWorkerPortSet,
      testWorkerPrerender,
    },
    use,
    testInfo,
  ) => {
    if (realmServerMode === 'shared' && !permissions) {
      let key = sharedRealmKey(testInfo.workerIndex, testInfo.file, realmDir);
      let realm = await acquireSharedRealm(
        key,
        realmDir,
        testWorkerPortSet,
        testWorkerPrerender.url,
      );
      try {
        await use(realm);
      } finally {
        await releaseSharedRealm(key);
      }
      return;
    }

    let realm = await startRealmProcess(
      realmDir,
      testWorkerPortSet,
      testWorkerPrerender.url,
      permissions,
    );
    try {
      await use(realm);
    } finally {
      await realm.stop();
    }
  },

  realmURL: async ({ realm }, use) => {
    await use(realm.realmURL);
  },

  cardURL: async ({ realm }, use) => {
    await use((path: string) => realm.cardURL(path));
  },

  authedPage: async ({ browser, realm }, use) => {
    let state = await buildBrowserState(
      realm.realmURL.href,
      realm.realmServerURL.href,
    );
    let context = await browser.newContext();
    await installBrowserState(context, state);
    let page = await context.newPage();

    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

test.setTimeout(300_000);

export { expect };
