import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import { defaultSupportMetadataFile } from '../src/runtime-metadata.js';
import {
  buildBrowserState,
  installBrowserState,
} from './helpers/browser-auth.js';

type StartedFactoryRealm = {
  realmDir: string;
  realmURL: URL;
  ownerBearerToken: string;
  cardURL(path: string): string;
  authorizationHeaders(): Record<string, string>;
  stop(): Promise<void>;
};

export type FactoryRealmFixtures = {
  realm: StartedFactoryRealm;
  realmURL: URL;
  cardURL: (path: string) => string;
  authedPage: Page;
};

type FactoryRealmOptions = {
  realmDir: string;
};

const packageRoot = resolve(process.cwd());
const defaultRealmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'test-fixtures/darkfactory-adopter',
);
const realmPort = Number(process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4205);
const publicSoftwareFactoryPrefix =
  process.env.SOFTWARE_FACTORY_PUBLIC_SOURCE_URL ??
  'http://localhost:4201/software-factory/';
const localBasePrefix = `http://localhost:${realmPort}/base/`;
const localSoftwareFactoryPrefix = `http://localhost:${realmPort}/software-factory/`;
const localSkillsPrefix = `http://localhost:${realmPort}/skills/`;
const testSourceRealmDir = resolve(
  packageRoot,
  'test-fixtures/public-software-factory-source',
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
      })
    : undefined;

  let child = spawn('pnpm', ['serve:realm', realmDir], {
    cwd: packageRoot,
    detached: true,
    env: {
      ...process.env,
      SOFTWARE_FACTORY_METADATA_FILE: metadataFile,
      SOFTWARE_FACTORY_SOURCE_REALM_DIR: testSourceRealmDir,
      ...(supportMetadata?.context
        ? {
            SOFTWARE_FACTORY_CONTEXT: JSON.stringify(supportMetadata.context),
          }
        : {}),
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
  await registerRealmRedirect(
    page,
    publicSoftwareFactoryPrefix,
    localSoftwareFactoryPrefix,
  );
  if (process.env.SOFTWARE_FACTORY_INCLUDE_SKILLS === '1') {
    await registerRealmRedirect(
      page,
      'http://localhost:4201/skills/',
      localSkillsPrefix,
    );
  }
}

export const test = base.extend<FactoryRealmFixtures, FactoryRealmOptions>({
  realmDir: [defaultRealmDir, { option: true, scope: 'worker' }],

  page: async ({ page }, use) => {
    await setRealmRedirects(page);
    await use(page);
  },

  realm: async ({ browserName: _browserName, realmDir }, use) => {
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
