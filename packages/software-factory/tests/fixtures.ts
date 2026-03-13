import { resolve } from 'node:path';

import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

import { defaultSupportMetadataFile } from '../src/runtime-metadata';
import { readSupportContext } from '../src/runtime-metadata';
import {
  startFactoryRealmRuntimeController,
  startFactoryRealmServer,
  type FactoryTestContext,
  type FactoryRealmRuntimeController,
} from '../src/harness';
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
  realm: StartedFactoryRealm;
  realmURL: URL;
  cardURL: (path: string) => string;
  authedPage: Page;
};

type InternalFactoryFixtures = {
  supportContext: FactoryTestContext;
  realmController: FactoryRealmRuntimeController;
};

const packageRoot = resolve(process.cwd());
const defaultRealmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'demo-realm',
);

function getSupportContext(): FactoryTestContext {
  let supportContext = readSupportContext() as FactoryTestContext | undefined;
  if (!supportContext) {
    throw new Error(
      `software-factory support context is missing: ${defaultSupportMetadataFile}`,
    );
  }
  return supportContext;
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
    'http://localhost:4205/base/',
  );
  if (process.env.SOFTWARE_FACTORY_INCLUDE_SKILLS === '1') {
    await registerRealmRedirect(
      page,
      'http://localhost:4201/skills/',
      'http://localhost:4205/skills/',
    );
  }
}

export const test = base.extend<FactoryRealmFixtures, InternalFactoryFixtures>({
  page: async ({ page }, use) => {
    await setRealmRedirects(page);
    await use(page);
  },

  supportContext: [
    async ({ browserName: _browserName }, use) => {
      await use(getSupportContext());
    },
    { scope: 'worker' },
  ],

  realmController: [
    async ({ supportContext }, use) => {
      let controller = await startFactoryRealmRuntimeController(supportContext);

      try {
        await use(controller);
      } finally {
        await controller.stop();
      }
    },
    { scope: 'worker' },
  ],

  realm: async ({ realmController, supportContext }, use) => {
    let realm = await startFactoryRealmServer({
      realmDir: defaultRealmDir,
      context: supportContext,
      runtimeController: realmController,
    });

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
