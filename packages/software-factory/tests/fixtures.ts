import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import type { RealmPermissions } from '@cardstack/runtime-common/realm';

import {
  defaultSupportMetadataFile,
  type PreparedTemplateMetadata,
  readSupportMetadata,
} from '../src/runtime-metadata';
import { buildRealmToken } from '../src/harness/shared';
import { startHarnessPrerenderServer } from '../src/harness/support-services';
import { buildBrowserState, installBrowserState } from './helpers/browser-auth';

type StartedFactoryRealm = {
  realmDir: string;
  realmURL: URL;
  realmServerURL: URL;
  ownerBearerToken: string;
  ports: {
    publicPort: number;
    realmServerPort: number;
    workerManagerPort: number;
  };
  cardURL(path: string): string;
  createBearerToken(user?: string, permissions?: string[]): string;
  authorizationHeaders(
    user?: string,
    permissions?: string[],
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
  permissions: RealmPermissions | undefined;
};

type FactoryRealmWorkerFixtures = {
  testWorkerPortSet: TestWorkerPortSet;
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

type TestWorkerPortSet = {
  compatRealmServerPort: number;
  realmServerPort: number;
  prerenderPort: number;
};

const packageRoot = resolve(process.cwd());
const tsNodeBin = resolve(packageRoot, 'node_modules', '.bin', 'ts-node');
const defaultRealmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'test-fixtures/darkfactory-adopter',
);
const testSourceRealmDir = resolve(
  packageRoot,
  'test-fixtures/public-software-factory-source',
);
const sharedRealms = new Map<string, Promise<SharedRealmHandle>>();
const testWorkerPortBlockSize = 10;
const testWorkerPortSearchStride = 200;
const testWorkerRunOffset = Number(
  process.env.SOFTWARE_FACTORY_TEST_WORKER_RUN_OFFSET ??
    ((process.pid * 31 + process.ppid) % 1000) * testWorkerPortBlockSize,
);
const testWorkerPortBase = Number(
  process.env.SOFTWARE_FACTORY_TEST_WORKER_PORT_BASE ?? 43100,
);

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

async function isPortFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
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
}

async function allocateTestWorkerPortSet(
  testWorkerIndex: number,
): Promise<TestWorkerPortSet> {
  // Reserve one stable port block per Playwright testWorker for services whose
  // URLs must remain constant across test restarts within the same worker:
  // compat proxy and realm-server (for BOXEL_HOST_URL stability) and prerender
  // (standby target). The worker-manager port is NOT pre-allocated here — it is
  // dynamically assigned via findAvailablePort() each time a realm stack starts,
  // since its URL does not need to be stable. Include a per-process offset so
  // concurrent Playwright runs with the same worker index do not all probe the
  // same block first.
  for (let attempt = 0; attempt < 100; attempt++) {
    let blockStart =
      testWorkerPortBase +
      testWorkerRunOffset +
      testWorkerIndex * testWorkerPortBlockSize +
      attempt * testWorkerPortSearchStride;
    let candidate: TestWorkerPortSet = {
      compatRealmServerPort: blockStart,
      realmServerPort: blockStart + 1,
      prerenderPort: blockStart + 2,
    };
    let ports = Object.values(candidate);
    if (
      (await Promise.all(ports.map((port) => isPortFree(port)))).every(Boolean)
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to allocate a stable software-factory port block for testWorker ${testWorkerIndex}`,
  );
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
  testWorkerPortSet: TestWorkerPortSet,
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

  let child = spawn(
    tsNodeBin,
    ['--transpileOnly', 'src/cli/serve-realm.ts', realmDir],
    {
      cwd: packageRoot,
      detached: true,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        SOFTWARE_FACTORY_METADATA_FILE: metadataFile,
        SOFTWARE_FACTORY_SOURCE_REALM_DIR: testSourceRealmDir,
        SOFTWARE_FACTORY_COMPAT_REALM_PORT: String(
          testWorkerPortSet.compatRealmServerPort,
        ),
        SOFTWARE_FACTORY_REALM_PORT: String(testWorkerPortSet.realmServerPort),
        SOFTWARE_FACTORY_PRERENDER_PORT: String(
          testWorkerPortSet.prerenderPort,
        ),
        SOFTWARE_FACTORY_PRERENDER_URL: testWorkerPrerenderURL,
        ...(supportMetadata?.context
          ? {
              SOFTWARE_FACTORY_CONTEXT: JSON.stringify(supportMetadata.context),
            }
          : {}),
        // When custom permissions are specified, skip the pre-cached template
        // so startFactoryRealmServer calls ensureFactoryRealmTemplate with the
        // custom permissions (the cache key includes permissions).
        ...(preparedTemplate && !permissions
          ? {
              SOFTWARE_FACTORY_TEMPLATE_DATABASE_NAME:
                preparedTemplate.templateDatabaseName,
            }
          : {}),
        ...(preparedTemplate && !permissions
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
    killProcessGroup(child.pid!, 'SIGTERM');
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
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };

  return {
    realmDir: metadata.realmDir,
    realmURL: new URL(metadata.realmURL),
    realmServerURL: new URL(metadata.realmServerURL),
    ownerBearerToken: metadata.ownerBearerToken,
    ports: metadata.ports,
    cardURL(path: string) {
      return new URL(path, metadata.realmURL).href;
    },
    createBearerToken(user?: string, perms?: string[]) {
      if (!user && !perms) {
        return metadata.ownerBearerToken;
      }
      return buildRealmToken(
        new URL(metadata.realmURL),
        new URL(metadata.realmServerURL),
        user,
        perms,
      );
    },
    authorizationHeaders(user?: string, perms?: string[]) {
      let token =
        !user && !perms
          ? metadata.ownerBearerToken
          : buildRealmToken(
              new URL(metadata.realmURL),
              new URL(metadata.realmServerURL),
              user,
              perms,
            );
      return {
        Authorization: `Bearer ${token}`,
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
  testWorkerPortSet: TestWorkerPortSet,
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
  permissions: [undefined as RealmPermissions | undefined, { option: true }],
  testWorkerPortSet: [
    async ({ browserName: _browserName }, use, workerInfo) => {
      // These services are ephemeral per test, but we intentionally keep their
      // port assignments stable for the lifetime of a Playwright testWorker.
      // That gives each testWorker a consistent harness URL set even as the
      // underlying realm stack is torn down and recreated between tests.
      let portSet = await allocateTestWorkerPortSet(workerInfo.parallelIndex);
      await use(portSet);
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
      permissions,
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
