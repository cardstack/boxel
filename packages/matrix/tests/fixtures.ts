import { test as base, expect } from '@playwright/test';
import { setRealmRedirects } from '../helpers/index.ts';
import { routeEmailAssets } from '../helpers/email-assets.ts';

export const test = base.extend<{ reportTestBudget: void }>({
  context: async ({ context }, use) => {
    await routeEmailAssets(context);
    await use(context);
  },
  page: async ({ page }, use) => {
    await setRealmRedirects(page);
    await use(page);
  },
  // When a test fails or times out, print the budget it ran under next to
  // the time it used, so a timeout can be told apart from a hung step.
  reportTestBudget: [
    // Playwright reads a fixture's dependencies from its first parameter, so
    // a fixture with none must still destructure an empty object.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      let startedAt = Date.now();
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        console.log(
          `[test-budget] ${testInfo.titlePath.join(' › ')}: status=${testInfo.status} elapsed=${Date.now() - startedAt}ms timeout=${testInfo.timeout}ms retry=${testInfo.retry}`,
        );
      }
    },
    { auto: true },
  ],
});

export { expect };
