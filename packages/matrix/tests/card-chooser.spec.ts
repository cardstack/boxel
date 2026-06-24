import { test, expect } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  createRealm,
  showAllCards,
  postCardSource,
  createSubscribedUserAndLogin,
} from '../helpers/index.ts';

// End-to-end coverage of the card chooser against a real realm server (real
// HTTP + real Matrix login). This is the Matrix-spec home for the
// "specify a card by URL" flow — the host integration version is skipped in
// environment mode because the mock-matrix harness races a login-flow reset
// and the per-slug HTTP/2 transport stalls the lazy base-info fetch; neither
// applies here, where base info loads through the normal boot/login flow.
test.describe('Card chooser', () => {
  const serverIndexUrl = new URL(appURL).origin;
  const realmName = 'cardchooser';

  // A card with a linksToMany field so the chooser can be opened from the
  // field's add-link affordance, and a base-realm type can be specified by URL.
  const taggedItemSource = `
    import { CardDef, field, contains, linksToMany } from '@cardstack/base/card-api';
    import StringField from '@cardstack/base/string';

    export class Tag extends CardDef {
      static displayName = 'Tag';
      @field name = contains(StringField);
    }
    export class TaggedItem extends CardDef {
      static displayName = 'Tagged Item';
      @field title = contains(StringField);
      @field tags = linksToMany(Tag);
    }
  `;

  test('can specify a card by URL in the card chooser', async ({ page }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'chooser',
      serverIndexUrl,
    );
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    await createRealm(page, realmName);
    await postCardSource(page, realmURL, 'tagged-item.gts', taggedItemSource);

    // Open the realm's grid and start creating a new card → the card chooser
    // opens so a type can be chosen.
    await showAllCards(page);
    await page.locator('[data-test-create-new-card-button]').click();
    await expect(page.locator('[data-test-card-chooser-modal]')).toBeVisible();
    await expect(page.locator('[data-test-item-button]').first()).toBeVisible();

    // Specify a base-realm card by URL.
    await page
      .locator('[data-test-search-field]')
      .fill('https://cardstack.com/base/types/card');

    // The result resolves under the "Base Workspace" realm section — the exact
    // assertion the host integration test makes, now over real HTTP. Anchor on
    // the stable realm URL alongside the human-visible name so we don't race
    // the realm-info fetch.
    let baseSection = page.locator(
      '[data-test-realm-url="https://cardstack.com/base/"][data-test-realm="Base Workspace"]',
    );
    await expect(baseSection).toBeVisible({ timeout: 30_000 });
    await expect(
      baseSection.locator('[data-test-results-count]'),
    ).toContainText('1 result');

    await page.locator('[data-test-item-button]').click();
    await expect(
      page.locator('[data-test-card-chooser-go-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-card-chooser-go-button]').click();

    // The chosen card is pushed onto the stack.
    await expect(
      page.locator('[data-test-stack-card-index="1"]'),
    ).toBeVisible();
  });
});
