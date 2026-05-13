import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { appURL } from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  createSubscribedUserAndLogin,
  postCardSource,
  postNewCard,
} from '../helpers';

let serverIndexUrl = new URL(appURL).origin;

test.describe('Publish realm', () => {
  let user: { username: string; password: string; credentials: any };

  async function openPublishRealmModal(page: Page) {
    await clearLocalStorage(page, serverIndexUrl);

    user = await createSubscribedUserAndLogin(
      page,
      'publish-realm',
      serverIndexUrl,
    );

    await createRealm(page, 'new-workspace', '1New Workspace');
    await page.locator('[data-test-workspace="1New Workspace"]').click();

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();

    await page.locator('[data-test-publish-realm-button]').click();
  }

  async function publishDefaultRealm(page: Page) {
    await openPublishRealmModal(page);
    await page.locator('[data-test-default-domain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();

    await page.waitForSelector('[data-test-unpublish-button]');
    await expect(
      page.locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      ),
    ).toBeVisible();
  }

  test('it can publish a realm to a subdirectory', async ({ page }) => {
    await publishDefaultRealm(page);

    let newTabPromise = page.waitForEvent('popup');

    await page
      .locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      )
      .click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      `http://${user.username}.localhost:4205/new-workspace/`,
    );
    await expect(
      newTab.locator(
        `[data-test-card="http://${user.username}.localhost:4205/new-workspace/index"]`,
      ),
    ).toBeVisible();
    await newTab.close();
    await page.bringToFront();
  });

  test('it validates, claims, and publishes to a custom subdomain', async ({
    page,
  }) => {
    await openPublishRealmModal(page);

    await page.locator('[data-test-custom-subdomain-setup-button]').click();

    let customSubdomainInput = page.locator(
      '[data-test-custom-subdomain-input]',
    );
    let claimButton = page.locator('[data-test-claim-custom-subdomain-button]');
    let customSubdomainField = customSubdomainInput.locator('input');

    await customSubdomainField.fill('xn--punycodetest');
    await claimButton.click();

    await expect(
      page.locator('[data-test-boxel-input-group-error-message]'),
    ).toHaveText('Punycode domains are not allowed for security reasons');

    await customSubdomainField.fill('acceptable-subdomain');
    await claimButton.click();

    await expect(
      page.locator('[data-test-boxel-input-group-error-message]'),
    ).toHaveCount(0);

    await expect(
      page.locator('[data-test-custom-subdomain-input]'),
    ).toHaveCount(0);

    await expect(
      page.locator('[data-test-custom-subdomain-checkbox]'),
    ).toBeChecked();
    await page.locator('[data-test-publish-button]').click();

    let newTabPromise = page.waitForEvent('popup');

    await page
      .locator(
        '[data-test-publish-realm-modal] [data-test-open-custom-subdomain-button]',
      )
      .click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://acceptable-subdomain.localhost:4205/',
    );
    await expect(
      newTab.locator(
        '[data-test-card="http://acceptable-subdomain.localhost:4205/index"]',
      ),
    ).toBeVisible();
    await newTab.close();
    await page.bringToFront();
  });

  test('it warns when private dependencies would cause host mode errors', async ({
    page,
  }) => {
    await clearLocalStorage(page, serverIndexUrl);

    user = await createSubscribedUserAndLogin(
      page,
      'publish-realm',
      serverIndexUrl,
    );

    let serverURL = new URL(serverIndexUrl);
    let publishedRealmBase = `${serverURL.protocol}//${serverURL.host}/${user.username}`;

    let defaultRealmURL = `${publishedRealmBase}/new-workspace/`;
    let privateRealmURL = `${publishedRealmBase}/secret-realm/`;

    await createRealm(page, 'new-workspace', '1New Workspace');
    await createRealm(page, 'secret-realm', 'Secret Realm');

    await postCardSource(
      page,
      privateRealmURL,
      'secret-card.gts',
      `
        import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class SecretCard extends CardDef {
          @field name = contains(StringField);
        }
      `,
    );

    await postNewCard(page, privateRealmURL, {
      data: {
        attributes: {
          name: 'Private Info',
        },
        meta: {
          adoptsFrom: {
            module: './secret-card',
            name: 'SecretCard',
          },
        },
      },
    });

    await postCardSource(
      page,
      defaultRealmURL,
      'dependent-card.gts',
      `
        import { CardDef, field, contains, linksTo } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { SecretCard } from "${privateRealmURL}secret-card";

        export class DependentCard extends CardDef {
          @field label = contains(StringField);
          @field secret = linksTo(() => SecretCard);
        }
      `,
    );

    await postCardSource(
      page,
      defaultRealmURL,
      'index.json',
      JSON.stringify(
        {
          data: {
            type: 'card',
            attributes: {
              label: 'Leaky Card',
            },
            meta: {
              adoptsFrom: {
                module: './dependent-card',
                name: 'DependentCard',
              },
            },
          },
        },
        null,
        2,
      ),
    );
    let dependentCardURL = `${defaultRealmURL}index.json`;

    await page.locator('[data-test-workspace="1New Workspace"]').click();
    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();
    await page.locator('[data-test-publish-realm-button]').click();

    await expect(
      page.locator('[data-test-private-dependency-warning]'),
    ).toBeVisible();

    await expect(
      page.locator(
        `[data-test-private-dependency-resource="${dependentCardURL}"]`,
      ),
    ).toBeVisible();

    await expect(
      page.locator(`[data-test-private-dependency-realm="${privateRealmURL}"]`),
    ).toBeVisible();
  });

  test('republishing reflects updated source content on the published URL (CS-11043)', async ({
    page,
    request,
  }) => {
    let t0 = Date.now();
    let step = (msg: string) =>
      console.log(`[CS-11043 ${Date.now() - t0}ms] ${msg}`);
    // CS-11043 regression net. The bug was: a republish reported success
    // server-side but the published URL kept serving the previous publish's
    // rendered HTML, sometimes for tens of hours. Every existing
    // publish-realm test does exactly one publish — this is the gap the
    // bug slipped through. Here we publish, change content, publish
    // again, and assert the published URL shows the new content (and not
    // the old).

    await clearLocalStorage(page, serverIndexUrl);
    user = await createSubscribedUserAndLogin(
      page,
      'publish-realm',
      serverIndexUrl,
    );

    let serverURL = new URL(serverIndexUrl);
    let defaultRealmURL = `${serverURL.protocol}//${serverURL.host}/${user.username}/new-workspace/`;

    await createRealm(page, 'new-workspace', '1New Workspace');

    // Define a card type whose isolated template renders a single
    // sentinel string we can grep for in the published HTML.
    await postCardSource(
      page,
      defaultRealmURL,
      'sentinel-card.gts',
      `
        import { CardDef, Component, field, contains } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class SentinelCard extends CardDef {
          @field value = contains(StringField);

          static isolated = class extends Component<typeof this> {
            <template>
              <div data-test-sentinel-output>{{@model.value}}</div>
            </template>
          };
        }
      `,
    );

    // Initial index.json: an instance of SentinelCard carrying the
    // sentinel that we expect the first publish to render.
    let initialSentinel = `sentinel-initial-${Date.now()}`;
    await postCardSource(
      page,
      defaultRealmURL,
      'index.json',
      JSON.stringify(
        {
          data: {
            type: 'card',
            attributes: { value: initialSentinel },
            meta: {
              adoptsFrom: { module: './sentinel-card', name: 'SentinelCard' },
            },
          },
        },
        null,
        2,
      ),
    );

    // Open the publish modal and do the first publish.
    await page.locator('[data-test-workspace="1New Workspace"]').click();
    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();
    await page.locator('[data-test-publish-realm-button]').click();
    await page.locator('[data-test-default-domain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();
    await page.waitForSelector('[data-test-unpublish-button]');

    // Open the published URL and verify the initial sentinel renders.
    let firstTabPromise = page.waitForEvent('popup');
    await page
      .locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      )
      .click();
    let firstTab = await firstTabPromise;
    await firstTab.waitForLoadState();
    await expect(firstTab.locator('[data-test-sentinel-output]')).toHaveText(
      initialSentinel,
      { timeout: 30_000 },
    );
    await firstTab.close();
    await page.bringToFront();

    // Close the modal so we can re-open it cleanly for the second publish.
    await page.locator('[data-test-close-modal]').click();

    step('first publish + sentinel verified, updating source for republish');

    // Change the index card's sentinel value. This is the "user edits
    // their realm between publishes" step.
    let updatedSentinel = `sentinel-updated-${Date.now()}`;
    await postCardSource(
      page,
      defaultRealmURL,
      'index.json',
      JSON.stringify(
        {
          data: {
            type: 'card',
            attributes: { value: updatedSentinel },
            meta: {
              adoptsFrom: { module: './sentinel-card', name: 'SentinelCard' },
            },
          },
        },
        null,
        2,
      ),
    );

    // DIAGNOSTIC: GET the source URL we just wrote to. If postCardSource
    // silently failed (auth, 4xx, etc.), the source still has the
    // initial value and the rest of the test is doomed to fail in
    // exactly the way we've been seeing. We assert the source has the
    // updated content before continuing.
    let sourceAuthToken = await page.evaluate(
      (realmURL) =>
        JSON.parse(window.localStorage['boxel-session'])[realmURL] as string,
      defaultRealmURL,
    );
    let sourceCheck = await request.get(`${defaultRealmURL}index.json`, {
      headers: {
        accept: 'application/vnd.card+source',
        authorization: sourceAuthToken,
      },
    });
    let sourceBody = await sourceCheck.text();
    step(
      `source index.json: status=${sourceCheck.status()} ` +
        `contains-updated=${sourceBody.includes(updatedSentinel)} ` +
        `contains-initial=${sourceBody.includes(initialSentinel)}`,
    );
    expect(
      sourceBody.includes(updatedSentinel),
      'source index.json should contain the updated sentinel after postCardSource',
    ).toBeTruthy();

    // Re-open the publish modal and re-trigger publish. The
    // default-domain checkbox can lose its selection on modal close,
    // so click it again before clicking publish — otherwise the
    // publish button is disabled (`!hasSelectedPublishedRealmURLs`)
    // and the click silently no-ops.
    await page.locator('[data-test-publish-realm-button]').click();
    step('publish modal reopened');
    let domainCheckbox = page.locator('[data-test-default-domain-checkbox]');
    let domainCheckboxChecked = await domainCheckbox.isChecked();
    step(`default-domain-checkbox.isChecked=${domainCheckboxChecked}`);
    if (!domainCheckboxChecked) {
      await domainCheckbox.click();
      step('clicked default-domain-checkbox to select');
    }
    let publishButton = page.locator('[data-test-publish-button]');
    let publishButtonDisabled = await publishButton.isDisabled();
    step(`publish-button.isDisabled=${publishButtonDisabled}`);

    // Set up the network wait BEFORE clicking — the handler awaits the
    // full reindex before returning 202, so when this resolves we know
    // the publish is fully done.
    let publishResponsePromise = page
      .waitForResponse(
        (r) =>
          r.url().endsWith('/_publish-realm') &&
          r.request().method() === 'POST',
        { timeout: 180_000 },
      )
      .catch((err) => {
        step(`waitForResponse rejected/timed-out: ${err.message}`);
        return null;
      });
    await publishButton.click();
    step('clicked publish button (second time)');
    let publishResponse = await publishResponsePromise;
    if (publishResponse) {
      step(
        `/_publish-realm responded status=${publishResponse.status()} ` +
          `url=${publishResponse.url()}`,
      );
      expect(
        publishResponse.status(),
        'second publish should succeed',
      ).toBeLessThan(300);
    } else {
      step(
        'WARNING: /_publish-realm response was NOT observed — publish may not have fired',
      );
    }

    // DIAGNOSTIC: fetch the published URL directly via plain HTTP
    // BEFORE opening the popup. This decouples "what the server
    // currently serves" from "what the browser tab renders". If the
    // direct fetch already shows the updated sentinel, but the popup
    // shows the initial, we have a browser-cache problem. If both
    // show the initial, the publish pipeline itself didn't propagate.
    let publishedRealmRootURL = `${serverURL.protocol}//${user.username}.${serverURL.host}/new-workspace/`;
    let directFetch = await request.get(publishedRealmRootURL);
    let directBody = await directFetch.text();
    step(
      `direct HTTP fetch of published URL ${publishedRealmRootURL}: ` +
        `status=${directFetch.status()} ` +
        `bodyLen=${directBody.length} ` +
        `contains-updated=${directBody.includes(updatedSentinel)} ` +
        `contains-initial=${directBody.includes(initialSentinel)}`,
    );

    // Open the published URL again and verify the UPDATED sentinel
    // renders — and the initial sentinel does NOT. This is the
    // load-bearing assertion CS-11043 would have failed.
    let secondTabPromise = page.waitForEvent('popup');
    await page
      .locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      )
      .click();
    let secondTab = await secondTabPromise;
    await secondTab.waitForLoadState();
    step(`popup opened, URL=${secondTab.url()}`);
    // Log the actual rendered sentinel-output text up front so a
    // failure has the value visible in the test log, not just the
    // assertion message.
    let sentinelLocator = secondTab.locator('[data-test-sentinel-output]');
    let sentinelCount = await sentinelLocator.count();
    let sentinelText =
      sentinelCount > 0 ? await sentinelLocator.first().textContent() : null;
    step(
      `popup [data-test-sentinel-output]: count=${sentinelCount} text=${JSON.stringify(sentinelText)}`,
    );
    // Generous retry budget: if waitForResponse above was downgraded
    // to null, the publish may not yet be done by the time we land on
    // the published URL. The assertion retries until the sentinel
    // appears or this budget expires, which gives slow republishes
    // room to land without flapping the test.
    await expect(secondTab.locator('[data-test-sentinel-output]')).toHaveText(
      updatedSentinel,
      { timeout: 120_000 },
    );
    await expect(secondTab.locator('body')).not.toContainText(initialSentinel);
    await secondTab.close();
    await page.bringToFront();
  });

  test('open site popover opens with shift-click', async ({ page }) => {
    await publishDefaultRealm(page);

    let newTabPromise = page.waitForEvent('popup');

    await page.locator('[data-test-close-modal]').click();
    await page.locator('[data-test-open-site-button]').click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      `http://${user.username}.localhost:4205/new-workspace/`,
    );
    await newTab.close();
    await page.bringToFront();

    await expect(page.locator('[data-test-open-site-popover]')).toHaveCount(0);

    let popupPromise = page
      .waitForEvent('popup', { timeout: 1_000 })
      .catch(() => null);

    await page.locator('[data-test-open-site-button]').click({
      modifiers: ['Shift'],
    });

    let popup = await popupPromise;
    expect(popup).toBeNull();

    await expect(page.locator('[data-test-open-site-popover]')).toBeVisible();

    newTabPromise = page.waitForEvent('popup');

    await page
      .locator('[data-test-open-site-popover] [data-test-open-site-button]')
      .click();

    newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      `http://${user.username}.localhost:4205/new-workspace/`,
    );
    await newTab.close();
    await page.bringToFront();
  });
});
