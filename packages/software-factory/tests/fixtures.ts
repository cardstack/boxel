import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import { buildBrowserState, installBrowserState } from './helpers/browser-auth';

type PreparedRealmTemplate = {
  realmDir: string;
  cacheKey: string;
  templateDatabaseName: string;
  fixtureHash: string;
  cacheHit: boolean;
};

type StartedFactoryRealm = {
  realmDir: string;
  realmURL: URL;
  ownerBearerToken: string;
  cardURL(path: string): string;
  authorizationHeaders(): Record<string, string>;
  stop(): Promise<void>;
};

type SharedPrerenderProcess = {
  url: string;
  stop(): Promise<void>;
};

export type FactoryRealmFixtures = {
  realm: StartedFactoryRealm;
  realmURL: URL;
  cardURL: (path: string) => string;
  authedPage: Page;
};

type FactoryRealmWorkerFixtures = {
  preparedRealmTemplate: PreparedRealmTemplate;
  sharedPrerender: SharedPrerenderProcess;
  cachedContext: BrowserContext;
};

const packageRoot = resolve(process.cwd());
const defaultRealmURL = new URL(
  process.env.SOFTWARE_FACTORY_REALM_URL ?? 'http://127.0.0.1:4444/',
);
const defaultRealmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'demo-realm',
);

type ChildResult<T> = {
  metadata: T;
  logs: string;
};

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

async function runCachePrepare(realmDir = defaultRealmDir) {
  let tempDir = mkdtempSync(join(tmpdir(), 'software-factory-cache-'));
  let metadataFile = join(tempDir, 'template.json');
  let logs = '';

  try {
    let child = spawn('pnpm', ['cache:prepare', realmDir], {
      cwd: packageRoot,
      env: {
        ...process.env,
        SOFTWARE_FACTORY_METADATA_FILE: metadataFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk) => {
      logs = appendLog(logs, String(chunk));
    });
    child.stderr?.on('data', (chunk) => {
      logs = appendLog(logs, String(chunk));
    });

    let exitPromise = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `cache:prepare exited with code ${code ?? 'unknown'}\n${logs}`,
            ),
          );
        }
      });
    });

    let metadata = await waitForMetadataFile<PreparedRealmTemplate>(
      metadataFile,
      child,
      () => logs,
    );

    await exitPromise;

    return {
      metadata,
      logs,
    } satisfies ChildResult<PreparedRealmTemplate>;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function startRealmProcess(
  templateDatabaseName: string,
  prerenderServerURL: string,
  realmDir = defaultRealmDir,
) {
  let tempDir = mkdtempSync(join(tmpdir(), 'software-factory-realm-'));
  let metadataFile = join(tempDir, 'runtime.json');
  let logs = '';

  let child = spawn('pnpm', ['serve:realm', realmDir], {
    cwd: packageRoot,
    detached: true,
    env: {
      ...process.env,
      SOFTWARE_FACTORY_METADATA_FILE: metadataFile,
      SOFTWARE_FACTORY_PRERENDER_SERVER_URL: prerenderServerURL,
      SOFTWARE_FACTORY_TEMPLATE_DATABASE_NAME: templateDatabaseName,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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

async function startPrerenderProcess() {
  let tempDir = mkdtempSync(join(tmpdir(), 'software-factory-prerender-'));
  let metadataFile = join(tempDir, 'prerender.json');
  let logs = '';

  let child = spawn('pnpm', ['serve:prerender'], {
    cwd: packageRoot,
    detached: true,
    env: {
      ...process.env,
      SOFTWARE_FACTORY_METADATA_FILE: metadataFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => {
    logs = appendLog(logs, String(chunk));
  });
  child.stderr?.on('data', (chunk) => {
    logs = appendLog(logs, String(chunk));
  });

  let metadata: {
    url: string;
  };

  try {
    metadata = await waitForMetadataFile<{ url: string }>(
      metadataFile,
      child,
      () => logs,
    );
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
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };

  return {
    url: metadata.url,
    stop,
  } satisfies SharedPrerenderProcess;
}

export const test = base.extend<
  FactoryRealmFixtures,
  FactoryRealmWorkerFixtures
>({
  preparedRealmTemplate: [
    async ({ browserName: _browserName }, use) => {
      let { metadata } = await runCachePrepare();
      await use(metadata);
    },
    { scope: 'worker' },
  ],

  sharedPrerender: [
    async ({ browserName: _browserName }, use) => {
      let prerender = await startPrerenderProcess();
      try {
        await use(prerender);
      } finally {
        await prerender.stop();
      }
    },
    { scope: 'worker' },
  ],

  cachedContext: [
    async ({ browser, preparedRealmTemplate, sharedPrerender }, use) => {
      let bootstrapRealm = await startRealmProcess(
        preparedRealmTemplate.templateDatabaseName,
        sharedPrerender.url,
      );
      let context = await browser.newContext({
        baseURL: defaultRealmURL.href,
      });

      try {
        let browserState = await buildBrowserState(
          bootstrapRealm.realmURL.href,
        );
        await installBrowserState(context, browserState);

        // Warm the app shell once so later test pages can reuse browser cache.
        let warmPage = await context.newPage();
        try {
          await warmPage.goto(defaultRealmURL.href, {
            waitUntil: 'domcontentloaded',
          });
        } finally {
          await warmPage.close();
        }
      } finally {
        await bootstrapRealm.stop();
      }

      try {
        await use(context);
      } finally {
        await context.close();
      }
    },
    { scope: 'worker' },
  ],

  realm: async ({ preparedRealmTemplate, sharedPrerender }, use) => {
    let realm = await startRealmProcess(
      preparedRealmTemplate.templateDatabaseName,
      sharedPrerender.url,
    );
    try {
      await use(realm);
    } finally {
      await realm.stop();
    }
  },

  realmURL: async ({ realm }, use) => {
    await use(new URL(realm.realmURL.href));
  },

  cardURL: async ({ realm }, use) => {
    await use((path: string) => realm.cardURL(path));
  },

  authedPage: async ({ cachedContext, realm: _realm }, use) => {
    await cachedContext.clearCookies();
    let page = await cachedContext.newPage();
    try {
      await page.route(`${_realm.realmURL.origin}/**/*`, async (route) => {
        await route.continue({
          headers: {
            ...route.request().headers(),
            'cache-control': 'no-cache, no-store, max-age=0',
            pragma: 'no-cache',
          },
        });
      });
      await use(page);
    } finally {
      await page.close();
    }
  },
});

export { expect };
