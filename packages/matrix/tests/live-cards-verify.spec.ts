// Throwaway verification for the live-cards code-mode edit flake. Not for
// merging. In the two CI failures the card save took 10.4 s and 12.7 s
// because the realm answers only after re-indexing. This spec makes every
// save take that long by holding the PATCH for SAVE_DELAY_MS before it
// reaches the realm, then runs:
//   - the old test body, which must fail (marked test.fail)
//   - the new test body, which must pass
//   - the new test body with no delay, which must pass
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  createRealm,
  postNewCard,
  getMonacoContent,
  describeMonacoModels,
  waitUntil,
  createSubscribedUserAndLogin,
} from '../helpers/index.ts';

const SAVE_DELAY_MS = 12_000;
const serverIndexUrl = new URL(appURL).origin;
const realmName = 'realm1';

async function openCardInCodeModeEdit(page: Page, delayMs: number) {
  let { username } = await createSubscribedUserAndLogin(
    page,
    'subscriber',
    serverIndexUrl,
  );
  const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
  await createRealm(page, realmName);
  let instanceUrl = await postNewCard(page, realmURL, {
    data: {
      attributes: {
        title: 'test card title',
        description: 'test card description',
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/card-api',
          name: 'CardDef',
        },
      },
    },
  });

  if (delayMs > 0) {
    await page.route(
      (url) => url.href.startsWith(instanceUrl),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          console.log(`holding PATCH ${route.request().url()} ${delayMs}ms`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
        await route.fallback();
      },
    );
  }

  await page.goto(
    `${realmURL}?operatorModeState=${encodeURIComponent(
      JSON.stringify({
        stacks: [],
        codePath: instanceUrl,
        fileView: 'browser',
        submode: 'code',
      }),
    )}`,
  );
  await page.locator('[data-test-format-chooser="edit"]').click();
  return instanceUrl;
}

test.describe('Live Cards flake verification', () => {
  test('old test body fails when the save is slow', async ({ page }) => {
    test.fail();
    await openCardInCodeModeEdit(page, SAVE_DELAY_MS);

    await new Promise((r) => setTimeout(r, 5000));
    let content = await getMonacoContent(page);

    await page
      .locator('[data-test-field="cardInfo-name"] input')
      .fill('Replacement');

    await waitUntil(async () => (await getMonacoContent(page)) !== content);

    await expect(
      await getMonacoContent(page),
      'monaco editor has been updated',
    ).toContain('Replacement');
  });

  for (let [label, delayMs] of [
    ['slow', SAVE_DELAY_MS],
    ['fast', 0],
  ] as const) {
    test(`new test body passes when the save is ${label}`, async ({ page }) => {
      let instanceUrl = await openCardInCodeModeEdit(page, delayMs);

      await expect
        .poll(() => getMonacoContent(page), {
          message: 'monaco editor has loaded the card source',
        })
        .toContain('"adoptsFrom"');

      let saveStartedAt = Date.now();
      let save = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().startsWith(instanceUrl) &&
          (response.request().postData() ?? '').includes('Replacement'),
      );

      await page
        .locator('[data-test-field="cardInfo-name"] input')
        .fill('Replacement');

      let saveResponse = await save;
      console.log(
        `card save: status=${saveResponse.status()} after ${
          Date.now() - saveStartedAt
        }ms`,
      );
      expect(saveResponse.ok(), 'card save succeeded').toBe(true);

      try {
        await expect
          .poll(() => getMonacoContent(page), {
            message: 'monaco editor has been updated',
          })
          .toContain('Replacement');
      } catch (e) {
        console.log(
          `monaco models when the update was missing: ${JSON.stringify(
            await describeMonacoModels(page),
          )}`,
        );
        throw e;
      }
    });
  }
});
