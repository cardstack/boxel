import { test as base, expect } from '@playwright/test';
import { setRealmRedirects } from '../helpers/index.ts';
import { routeEmailAssets } from '../helpers/email-assets.ts';

export const test = base.extend({
  context: async ({ context }, use) => {
    await routeEmailAssets(context);
    await use(context);
  },
  page: async ({ page }, use) => {
    await setRealmRedirects(page);
    await use(page);
  },
});

test.setTimeout(120_000);

export { expect };
