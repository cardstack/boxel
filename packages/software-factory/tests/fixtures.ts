import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import { defaultSupportMetadataFile } from '../src/runtime-metadata';
import { buildBrowserState, installBrowserState } from './helpers/browser-auth';

type StartedFactoryRealm = {
  realmDir: string;
  realmURL: URL;
  ownerBearerToken: string;
  cardURL(path: string): string;
  authorizationHeaders(): Record<string, string>;
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
};

type FactoryRealmInternalFixtures = {
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
const realmPort = Number(process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4205);
const compatPort = Number(
  process.env.SOFTWARE_FACTORY_COMPAT_REALM_PORT ?? 4201,
);
const workerManagerPort = Number(
  process.env.SOFTWARE_FACTORY_WORKER_MANAGER_PORT ?? 4232,
);
const localBasePrefix = `http://localhost:${realmPort}/base/`;
const localSkillsPrefix = `http://localhost:${realmPort}/skills/`;
const testSourceRealmDir = resolve(
  packageRoot,
  'test-fixtures/public-software-factory-source',
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
  timeoutMs = 10_000,
): Promise<void> {
  let startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let free = await new Promise<boolean>((resolve) => {
      let server = createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
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
  timeoutMs = 120_000,
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

async function startRealmProcess(realmDir = defaultRealmDir) {
  let tempDir = mkdtempSync(join(tmpdir(), 'software-factory-realm-'));
  let metadataFile = join(tempDir, 'runtime.json');
  let logs = '';
  let supportMetadata = existsSync(defaultSupportMetadataFile)
    ? (JSON.parse(readFileSync(defaultSupportMetadataFile, 'utf8')) as {
        context?: Record<string, unknown>;
        templateDatabaseName?: string;
      })
    : undefined;

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
        ...(supportMetadata?.context
          ? {
              SOFTWARE_FACTORY_CONTEXT: JSON.stringify(supportMetadata.context),
            }
          : {}),
        ...(supportMetadata?.templateDatabaseName
          ? {
              SOFTWARE_FACTORY_TEMPLATE_DATABASE_NAME:
                supportMetadata.templateDatabaseName,
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
    sampleCardURL: string;
    ownerBearerToken: string;
  };

  try {
    metadata = await waitForMetadataFile<{
      realmDir: string;
      realmURL: string;
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
        waitForPortFree(realmPort),
        waitForPortFree(compatPort),
        waitForPortFree(workerManagerPort),
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };

  return {
    realmDir: metadata.realmDir,
    realmURL: new URL(metadata.realmURL),
    ownerBearerToken: metadata.ownerBearerToken,
    cardURL(path: string) {
      return new URL(path, metadata.realmURL).href;
    },
    authorizationHeaders() {
      return {
        Authorization: `Bearer ${metadata.ownerBearerToken}`,
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
): Promise<StartedFactoryRealm> {
  let existing = sharedRealms.get(key);
  if (!existing) {
    existing = startRealmProcess(realmDir).then((realm) => ({
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

async function registerRealmRedirect(
  page: Page,
  fromPrefix: string,
  toPrefix: string,
) {
  await page.route(`${fromPrefix}**`, async (route) => {
    let url = route.request().url();
    let suffix = url.slice(fromPrefix.length);
    await route.continue({ url: `${toPrefix}${suffix}` });
  });
}

async function setRealmRedirects(page: Page) {
  await registerRealmRedirect(
    page,
    'http://localhost:4201/base/',
    localBasePrefix,
  );
  if (process.env.SOFTWARE_FACTORY_INCLUDE_SKILLS === '1') {
    await registerRealmRedirect(
      page,
      'http://localhost:4201/skills/',
      localSkillsPrefix,
    );
  }
}

export const test = base.extend<
  FactoryRealmFixtures & FactoryRealmOptions & FactoryRealmInternalFixtures
>({
  realmDir: [defaultRealmDir, { option: true }],
  realmServerMode: ['shared', { option: true }],

  page: async ({ page }, use) => {
    await setRealmRedirects(page);
    await use(page);
  },

  realm: async (
    { browserName: _browserName, realmDir, realmServerMode },
    use,
    testInfo,
  ) => {
    if (realmServerMode === 'shared') {
      let key = sharedRealmKey(testInfo.workerIndex, testInfo.file, realmDir);
      let realm = await acquireSharedRealm(key, realmDir);
      try {
        await use(realm);
      } finally {
        await releaseSharedRealm(key);
      }
      return;
    }

    let realm = await startRealmProcess(realmDir);
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

  authedPage: async ({ browser, realmURL }, use) => {
    let state = await buildBrowserState(realmURL.href);
    let context = await browser.newContext();
    await installBrowserState(context, state);
    let page = await context.newPage();
    await setRealmRedirects(page);

    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

test.setTimeout(120_000);

export { expect };
