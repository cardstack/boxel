import { test as base, expect } from '@playwright/test';
import { setRealmRedirects } from '../helpers';

export const test = base.extend({
  page: async ({ page }, use) => {
    await setRealmRedirects(page);
    await use(page);
  },
});

test.setTimeout(120_000);

export { expect };
