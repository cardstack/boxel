import { test as base, expect } from '@playwright/test';
import { seedBrowserSession } from './helpers/browser-auth';

export type FactoryRealmFixtures = {
  realmURL: URL;
  cardURL: (path: string) => string;
  authedPage: import('@playwright/test').Page;
};

const defaultRealmURL = new URL(
  process.env.SOFTWARE_FACTORY_REALM_URL ?? 'http://127.0.0.1:4444/',
);

export const test = base.extend<FactoryRealmFixtures>({
  realmURL: async ({ baseURL: _baseURL }, use) => {
    await use(new URL(defaultRealmURL.href));
  },

  cardURL: async ({ realmURL }, use) => {
    await use((path: string) => new URL(path, realmURL).href);
  },

  authedPage: async ({ page, realmURL }, use) => {
    await seedBrowserSession(page, realmURL.href);
    await use(page);
  },
});

export { expect };
