import { test as base, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { setRealmRedirects } from '../helpers/index.ts';

// THROWAWAY VERIFICATION: hold the Poppins 700 stylesheet the email templates
// load, as in the CI failure where it had no response at screenshot time.
async function stallEmailFontStylesheet(context: BrowserContext) {
  await context.route(
    'https://fonts.googleapis.com/css2?family=Poppins:wght@700',
    async (route) => {
      console.log('stalling Poppins 700 stylesheet for 8000ms');
      await new Promise((r) => setTimeout(r, 8000));
      await route.continue();
    },
  );
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await stallEmailFontStylesheet(context);
    await use(context);
  },
  page: async ({ page }, use) => {
    await setRealmRedirects(page);
    await use(page);
  },
});

test.setTimeout(120_000);

export { expect };
