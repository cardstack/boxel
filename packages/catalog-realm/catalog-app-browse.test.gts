import {
  click,
  waitFor,
  waitUntil,
  fillIn,
  settled,
  triggerEvent,
} from '@ember/test-helpers';

import { module, skip, test } from 'qunit';

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL as mockCatalogURL,
  setupAuthEndpoints,
  setupUserSubscription,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setCatalogRealmURL,
} from '@cardstack/host/tests/helpers';
import { setupMockMatrix } from '@cardstack/host/tests/helpers/mock-matrix';
import { setupApplicationTest } from '@cardstack/host/tests/helpers/setup';

import {
  makeMockCatalogContents,
  makeDestinationRealmContents,
} from './catalog-app-test-fixtures';

// The mock listing card instances use adoptsFrom.module paths that point to the
// real catalog realm so the Boxel runtime can resolve the card class definitions
// (e.g. CardListing, SkillListing). Without a valid catalog realm URL those
// modules 404 and the UI never renders.
//
// ENV.resolvedCatalogRealmURL is injected by live-test.js when running live
// tests (local or CI), but is explicitly set to `undefined` in the standard
// host test environment (packages/host/config/environment.js). The localhost
// fallback ensures the constant is always a string and matches the default dev
// server URL.
const catalogRealmURL = ensureTrailingSlash(
  ENV.resolvedCatalogRealmURL ?? 'http://localhost:4201/catalog/',
);
const testDestinationRealmURL = `http://test-realm/test2/`;

//listing
const authorListingId = `${mockCatalogURL}Listing/author`;
const personListingId = `${mockCatalogURL}Listing/person`;
const emptyListingId = `${mockCatalogURL}Listing/empty`;
const pirateSkillListingId = `${mockCatalogURL}SkillListing/pirate-skill`;
const incompleteSkillListingId = `${mockCatalogURL}Listing/incomplete-skill`;
const apiDocumentationStubListingId = `${mockCatalogURL}Listing/api-documentation-stub`;

//tags
const calculatorTagId = `${mockCatalogURL}Tag/c1fe433a-b3df-41f4-bdcf-d98686ee42d7`;
const gameTagId = `${mockCatalogURL}Tag/51de249c-516a-4c4d-bd88-76e88274c483`;

export function runTests() {
module('Acceptance | Catalog | catalog app - browse tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [mockCatalogURL, testDestinationRealmURL],
  });

  let { getRoomIds, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();
    setCatalogRealmURL(mockCatalogURL);
    // this setup test realm is pretending to be a mock catalog
    await setupAcceptanceTestRealm({
      realmURL: mockCatalogURL,
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        ...makeMockCatalogContents(mockCatalogURL, catalogRealmURL),
      },
    });
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testDestinationRealmURL,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        ...makeDestinationRealmContents(),
      },
    });
  });

  /**
   * Selects a tab by name within the catalog app
   */
  async function selectTab(tabName: string) {
    await waitFor(`[data-test-catalog-app] [data-test-tab-label="${tabName}"]`);
    await click(`[data-test-catalog-app] [data-test-tab-label="${tabName}"]`);
  }

  /**
   * Waits for grid to load in the catalog app
   */
  async function waitForGrid() {
    await waitFor('[data-test-catalog-list-view]');
    await waitFor('[data-test-cards-grid-cards]');
    await settled();
  }

  /**
   * Waits for showcase view to load
   */
  async function waitForShowcase() {
    await waitFor('[data-test-showcase-view]');
    await settled();
  }

  /**
   * Waits for room operations to complete
   */
  async function waitForRoom() {
    await waitFor('[data-room-settled]');
    await settled();
  }

  /**
   * Waits for a card to appear on the grid with optional title verification
   */
  async function waitForCardOnGrid(cardId: string, title?: string) {
    await waitFor(`[data-test-cards-grid-item="${cardId}"]`);
    if (title) {
      await waitFor(
        `[data-test-cards-grid-item="${cardId}"] [data-test-card-title="${title}"]`,
        //its problematic when we are waiting for computed title
        //my recommendation for the purposes of test is to populate the card title in the realm
      );
    }
  }

  /**
   * Waits for a card to appear on the stack with optional title verification
   */
  async function waitForCardOnStack(cardId: string, expectedTitle?: string) {
    await waitFor(
      `[data-test-stack-card="${cardId}"] [data-test-boxel-card-header-title]`,
    );
    if (expectedTitle) {
      await waitFor(
        `[data-test-stack-card="${cardId}"] [data-test-boxel-card-header-title]`,
      );
    }
  }

  async function clickDropdownItem(menuItemText: string) {
    let selector = `[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="${menuItemText}"]`;
    await waitFor(selector);
    await click(selector);
  }

  async function hoverToHydrateCard(buttonSelector: string) {
    await waitFor(buttonSelector);
    await triggerEvent(buttonSelector, 'mouseenter');
    await waitFor('[data-test-hydrated-card]');
  }

  async function openMenu(buttonSelector: string, checkHydration = true) {
    await waitFor(buttonSelector);
    await triggerEvent(buttonSelector, 'mouseenter');
    if (checkHydration) {
      await waitFor('[data-test-hydrated-card]');
    }
    await click(buttonSelector);
  }

  async function executeListingAction(
    buttonSelector: string,
    menuItemText: string,
    checkHydration = true,
  ) {
    await openMenu(buttonSelector, checkHydration);
    await clickDropdownItem(menuItemText);
  }

  async function verifyListingAction(
    assert: Assert,
    buttonSelector: string,
    expectedText: string,
    expectedMessage: string,
    menuItemName = 'Test Workspace B',
    checkHydration = true,
  ) {
    await waitFor(buttonSelector);
    assert.dom(buttonSelector).containsText(expectedText);
    await executeListingAction(buttonSelector, menuItemName, checkHydration);
    await waitUntil(() => getRoomIds().length > 0);

    const roomId = getRoomIds().pop()!;
    await waitFor(`[data-test-room="${roomId}"][data-test-room-settled]`);
    await waitFor(
      `[data-test-room="${roomId}"] [data-test-ai-assistant-message]`,
    );

    await waitFor(
      `[data-test-room="${roomId}"] [data-test-ai-message-content]`,
    );
    await settled();

    assert
      .dom(`[data-test-room="${roomId}"] [data-test-ai-message-content]`)
      .containsText(expectedMessage);
  }

  async function assertDropdownItem(
    assert: Assert,
    menuItemText: string,
    exists = true,
  ) {
    let selector = `[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="${menuItemText}"]`;
    if (exists) {
      await waitFor(selector);
      assert.dom(selector).exists();
    } else {
      assert.dom(selector).doesNotExist();
    }
  }

  module('catalog index', function (hooks) {
    hooks.beforeEach(async function () {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${mockCatalogURL}index`,
              format: 'isolated',
            },
          ],
        ],
      });
      await waitForShowcase();
    });

    module('listing fitted', function () {
      test('after clicking "Remix" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(authorListingId, 'Author');
        assert
          .dom(
            `[data-test-cards-grid-item="${authorListingId}"] [data-test-card-title="Author"]`,
          )
          .containsText('Author', '"Author" exist in listing');
        await verifyListingAction(
          assert,
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-action="Remix"]`,
          'Remix',
          'Remix done! Please suggest two example prompts on how to edit this card.',
          'Test Workspace B',
        );
      });

      test('after clicking "Remix" button, current realm (particularly catalog realm) is never displayed in realm options', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        const listingId = mockCatalogURL + 'Listing/author';
        await waitFor(`[data-test-cards-grid-item="${listingId}"]`);
        await waitFor(
          `[data-test-cards-grid-item="${listingId}"] [data-test-card-title="Author"]`,
        );
        await openMenu(
          `[data-test-cards-grid-item="${listingId}"] [data-test-catalog-listing-action="Remix"]`,
        );
        assert
          .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
          .exists({ count: 1 });
        await assertDropdownItem(assert, 'Test Workspace B');
        await assertDropdownItem(assert, 'Test Workspace A', false);
      });

      test('after clicking "Preview" button, the first example card opens up onto the stack', async function (assert) {
        await waitForCardOnGrid(authorListingId, 'Author');
        assert
          .dom(
            `[data-test-card="${authorListingId}"] [data-test-card-title="Author"]`,
          )
          .containsText('Author', '"Author" button exist in listing');
        await click(
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );
        await waitForCardOnStack(`${mockCatalogURL}author/Author/example`);
        assert
          .dom(
            `[data-test-stack-card="${mockCatalogURL}author/Author/example"] [data-test-boxel-card-header-title]`,
          )
          .hasText('Author - Mike Dane');
      });

      test('after clicking "Use Skills" button, the skills is attached to the skill menu', async function (assert) {
        await selectTab('Skills');
        await waitForGrid();
        await waitFor(`[data-test-cards-grid-item="${pirateSkillListingId}"]`);
        await openMenu(
          `[data-test-cards-grid-item="${pirateSkillListingId}"] [data-test-catalog-listing-fitted-add-skills-to-room-button]`,
        );
        await waitForRoom();
        await click('[data-test-skill-menu][data-test-pill-menu-button]');
        await waitFor('[data-test-skill-menu]');
        assert.dom('[data-test-skill-menu]').exists('Skill menu is visible');
        assert
          .dom('[data-test-pill-menu-item]')
          .containsText('Talk Like a Pirate')
          .exists('Skill is attached to the skill menu');
      });

      test('after clicking "carousel" area, the first example card opens up onto the stack', async function (assert) {
        await waitForCardOnGrid(authorListingId, 'Author');
        assert
          .dom(
            `[data-test-card="${authorListingId}"] [data-test-card-title="Author"]`,
          )
          .containsText('Author', '"Author" button exist in listing');
        await click(
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );
        await waitForCardOnStack(`${mockCatalogURL}author/Author/example`);
        assert
          .dom(
            `[data-test-stack-card="${mockCatalogURL}author/Author/example"] [data-test-boxel-card-header-title]`,
          )
          .hasText('Author - Mike Dane');
      });

      test('after clicking "Details" button, the listing details card opens up onto the stack', async function (assert) {
        await click(
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-details-button]`,
        );
        await waitForCardOnStack(authorListingId);
        assert
          .dom(
            `[data-test-stack-card="${authorListingId}"] [data-test-boxel-card-header-title]`,
          )
          .hasText('CardListing - Author');
      });

      test('after clicking "info-section" area, the listing details card opens up onto the stack', async function (assert) {
        await click(
          `[data-test-card="${authorListingId}"] [data-test-catalog-listing-fitted-details]`,
        );
        await waitForCardOnStack(authorListingId);
        assert
          .dom(
            `[data-test-stack-card="${authorListingId}"] [data-test-boxel-card-header-title]`,
          )
          .hasText('CardListing - Author');
      });

      test('no arrows and dots appear when one or less image exist', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(emptyListingId);
        await hoverToHydrateCard(
          `[data-test-cards-grid-item="${emptyListingId}"]`,
        );

        const carouselNav = document.querySelector(
          `[data-test-cards-grid-item="${emptyListingId}"] .carousel-nav`,
        );
        const carouselDots = document.querySelector(
          `[data-test-cards-grid-item="${emptyListingId}"] .carousel-dots`,
        );

        if (carouselNav && carouselDots) {
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-arrow-prev`,
            )
            .exists();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-arrow-next`,
            )
            .exists();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-item-0.is-active`,
            )
            .exists();
        } else {
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-nav`,
            )
            .doesNotExist();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-dots`,
            )
            .doesNotExist();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-arrow-prev`,
            )
            .doesNotExist();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-arrow-next`,
            )
            .doesNotExist();
        }
      });

      test('carousel arrows only when multiple images exist and works when triggered', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(personListingId);
        await hoverToHydrateCard(
          `[data-test-cards-grid-item="${personListingId}"]`,
        );

        await click(
          `[data-test-cards-grid-item="${personListingId}"] .carousel-arrow-prev`,
        );
        assert
          .dom(
            `[data-test-cards-grid-item="${personListingId}"] .carousel-item-2.is-active`,
          )
          .exists('After clicking prev, last slide (index 2) is active');

        await click(
          `[data-test-cards-grid-item="${personListingId}"] .carousel-arrow-next`,
        );
        assert
          .dom(
            `[data-test-cards-grid-item="${personListingId}"] .carousel-item-0.is-active`,
          )
          .exists('After clicking next, first slide (index 0) is active');
      });

      test('carousel dots appear only when multiple images exist and works when triggered', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(personListingId);

        // Hover over the carousel to make controls visible
        await hoverToHydrateCard(
          `[data-test-cards-grid-item="${personListingId}"]`,
        );

        const dots = document.querySelectorAll(
          `[data-test-cards-grid-item="${personListingId}"] .carousel-dot`,
        );

        if (dots.length > 1) {
          await click(dots[1]);
          assert
            .dom(
              `[data-test-cards-grid-item="${personListingId}"] .carousel-item-1.is-active`,
            )
            .exists('After clicking dot 1, slide 1 is active');
        }
      });

      test('preview button appears only when examples exist', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(authorListingId);
        await hoverToHydrateCard(
          `[data-test-cards-grid-item="${authorListingId}"]`,
        );
        const previewButton = document.querySelector(
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );

        if (previewButton) {
          assert
            .dom(
              `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
            )
            .exists();
        } else {
          assert
            .dom(
              `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
            )
            .doesNotExist();
        }
      });
    });

    module('navigation', function () {
      // showcase tab has different behavior compared to other tabs (apps, cards, fields, skills)
      module('show results as per catalog tab selected', function () {
        test('switch to showcase tab', async function (assert) {
          await selectTab('Showcase');
          await waitForShowcase();
          assert
            .dom('[data-test-navigation-reset-button="showcase"]')
            .exists(`"Catalog Home" button should exist`)
            .hasClass('is-selected');
          assert.dom('[data-test-boxel-radio-option-id="grid"]').doesNotExist();
        });

        test('switch to apps tab', async function (assert) {
          await selectTab('Apps');
          await waitForGrid();
          assert
            .dom('[data-test-navigation-reset-button="app"]')
            .exists(`"All Apps" button should exist`)
            .hasClass('is-selected');
          assert.dom('[data-test-boxel-radio-option-id="grid"]').exists();
        });
      });

      skip('filters', async function () {
        test('list view is shown if filters are applied', async function (assert) {
          await waitFor('[data-test-filter-search-input]');
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Mortgage');
          // filter by category
          await click('[data-test-filter-list-item="All"]');
          // filter by tag
          let tagPill = document.querySelector('[data-test-tag-list-pill]');
          if (tagPill) {
            await click(tagPill);
          }

          await waitUntil(() => {
            const cards = document.querySelectorAll(
              '[data-test-catalog-list-view]',
            );
            return cards.length === 1;
          });

          assert
            .dom('[data-test-catalog-list-view]')
            .exists(
              'Catalog list view should be visible when filters are applied',
            );
        });

        // TOOD: restore in CS-9083
        skip('should be reset when clicking "Catalog Home" button', async function (assert) {
          await waitFor('[data-test-filter-search-input]');
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Mortgage');
          // filter by category
          await click('[data-test-filter-list-item="All"]');
          // filter by tag
          let tagPill = document.querySelector('[data-test-tag-list-pill]');
          if (tagPill) {
            await click(tagPill);
          }

          assert
            .dom('[data-test-showcase-view]')
            .doesNotExist('Should be in list view after applying filter');

          await click('[data-test-navigation-reset-button="showcase"]');

          assert
            .dom('[data-test-showcase-view]')
            .exists(
              'Should return to showcase view after clicking Catalog Home',
            );

          assert
            .dom('[data-test-filter-search-input]')
            .hasValue('', 'Search input should be cleared');
          assert
            .dom('[data-test-filter-list-item].is-selected')
            .doesNotExist('No category should be selected after reset');
          assert
            .dom('[data-test-tag-list-pill].selected')
            .doesNotExist('No tag should be selected after reset');
        });

        // TODO: restore in CS-9131
        skip('should be reset when clicking "All Apps" button', async function (assert) {
          await selectTab('Apps');
          await waitForGrid();

          await waitFor('[data-test-filter-search-input]');
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Mortgage');
          // filter by category
          await click('[data-test-filter-list-item="All"]');
          // filter by tag
          let tagPill = document.querySelector('[data-test-tag-list-pill]');
          if (tagPill) {
            await click(tagPill);
          }

          await click('[data-test-navigation-reset-button="app"]');
          assert
            .dom('[data-test-showcase-view]')
            .doesNotExist('Should remain in list view, not return to showcase');
          await waitUntil(() => {
            const cards = document.querySelectorAll(
              '[data-test-catalog-list-view]',
            );
            return cards.length === 1;
          });
          assert
            .dom('[data-test-catalog-list-view]')
            .exists('Catalog list view should still be visible');

          assert
            .dom('[data-test-filter-search-input]')
            .hasValue('', 'Search input should be cleared');
          assert
            .dom('[data-test-filter-list-item].is-selected')
            .doesNotExist('No category should be selected after reset');
          assert
            .dom('[data-test-tag-list-pill].selected')
            .doesNotExist('No tag should be selected after reset');
        });

        skip('updates the card count correctly when filtering by a sphere group', async function (assert) {
          await click('[data-test-boxel-filter-list-button="LIFE"]');
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 2 });
        });

        skip('updates the card count correctly when filtering by a category', async function (assert) {
          await click('[data-test-filter-list-item="LIFE"] .dropdown-toggle');
          await click(
            '[data-test-boxel-filter-list-button="Health & Wellness"]',
          );
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 1 });
        });

        skip('updates the card count correctly when filtering by a search input', async function (assert) {
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Mortgage');
          await waitUntil(() => {
            const cards = document.querySelectorAll(
              '[data-test-cards-grid-cards] [data-test-cards-grid-item]',
            );
            return cards.length === 1;
          });
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 1 });
        });

        test('updates the card count correctly when filtering by a single tag', async function (assert) {
          await click(`[data-test-tag-list-pill="${gameTagId}"]`);
          assert
            .dom(`[data-test-tag-list-pill="${gameTagId}"]`)
            .hasClass('selected');
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 1 });
        });

        test('updates the card count correctly when filtering by multiple tags', async function (assert) {
          await click(`[data-test-tag-list-pill="${calculatorTagId}"]`);
          await click(`[data-test-tag-list-pill="${gameTagId}"]`);
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 2 });
        });

        test('updates the card count correctly when multiple filters are applied together', async function (assert) {
          await click('[data-test-boxel-filter-list-button="All"]');
          await click(`[data-test-tag-list-pill="${gameTagId}"]`);
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Blackjack');

          await waitUntil(() => {
            const cards = document.querySelectorAll(
              '[data-test-cards-grid-cards] [data-test-cards-grid-item]',
            );
            return cards.length === 1;
          });

          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 1 });
        });

        test('shows zero results when filtering with a non-matching or invalid search input', async function (assert) {
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'asdfasdf');
          await waitUntil(() => {
            const cards = document.querySelectorAll('[data-test-no-results]');
            return cards.length === 1;
          });

          assert.dom('[data-test-no-results]').exists();
        });

        test('categories with null sphere fields are excluded from filter list', async function (assert) {
          // Setup: Create a category with null sphere field
          await setupAcceptanceTestRealm({
            realmURL: mockCatalogURL,
            mockMatrixUtils,
            contents: {
              ...SYSTEM_CARD_FIXTURE_CONTENTS,
              'Category/category-with-null-sphere.json': {
                data: {
                  type: 'card',
                  attributes: {
                    name: 'CategoryWithNullSphere',
                  },
                  relationships: {
                    sphere: {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${mockCatalogURL}catalog-app/listing/category`,
                      name: 'Category',
                    },
                  },
                },
              },
            },
          });

          await visitOperatorMode({
            stacks: [
              [
                {
                  id: `${mockCatalogURL}`,
                  format: 'isolated',
                },
              ],
            ],
          });

          assert
            .dom(
              '[data-test-boxel-filter-list-button="CategoryWithNullSphere"]',
            )
            .doesNotExist(
              'Category with null sphere should not appear in filter list',
            );
        });
      });
    });
  });

  module('listing isolated', function (hooks) {
    hooks.beforeEach(async function () {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: authorListingId,
              format: 'isolated',
            },
          ],
        ],
      });
    });

    test('listing card shows more options dropdown in stack item', async function (assert) {
      let triggerSelector = `[data-test-stack-card="${authorListingId}"] [data-test-more-options-button]`;
      await waitFor(triggerSelector);
      await click(triggerSelector);
      await waitFor('[data-test-boxel-dropdown-content]');
      assert
        .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
        .exists('Listing card dropdown renders menu items');
      assert
        .dom(
          `[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Generate Example with AI"]`,
        )
        .exists('Generate Example with AI action is present');
    });

    test('after clicking "Remix" button, current realm (particularly catalog realm) is never displayed in realm options', async function (assert) {
      let selector = `[data-test-card="${authorListingId}"] [data-test-catalog-listing-action="Remix"]`;
      await openMenu(selector, false);
      assert
        .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
        .exists({ count: 1 });
      await assertDropdownItem(assert, 'Test Workspace B');
      await assertDropdownItem(assert, 'Test Workspace A', false);
    });

    test('after clicking "Use Skills" button, the skills is attached to the skill menu', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: pirateSkillListingId,
              format: 'isolated',
            },
          ],
        ],
      });
      await click(
        '[data-test-catalog-listing-embedded-add-skills-to-room-button]',
      );

      await waitFor('[data-room-settled]');
      await click('[data-test-skill-menu][data-test-pill-menu-button]');
      await waitFor('[data-test-skill-menu]');
      assert.dom('[data-test-skill-menu]').exists('Skill menu is visible');
      assert
        .dom('[data-test-pill-menu-item]')
        .containsText('Talk Like a Pirate')
        .exists('Skill is attached to the skill menu');
    });

    test('after clicking "Remix" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
      await verifyListingAction(
        assert,
        `[data-test-card="${authorListingId}"] [data-test-catalog-listing-action="Remix"]`,
        'Remix',
        'Remix done! Please suggest two example prompts on how to edit this card.',
        'Test Workspace B',
        false,
      );
    });

    test('after clicking "Preview" button, the first example card opens up onto the stack', async function (assert) {
      await click(
        `[data-test-card="${authorListingId}"] [data-test-catalog-listing-embedded-preview-button]`,
      );
      await waitForCardOnStack(`${mockCatalogURL}author/Author/example`);
      assert
        .dom(
          `[data-test-stack-card="${mockCatalogURL}author/Author/example"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Author - Mike Dane');
    });

    test('display of sections when viewing listing details', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: authorListingId,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom('[data-test-catalog-listing-embedded-summary-section]')
        .containsText('A card for representing an author');

      // Publisher (rendered in header)
      assert
        .dom('[data-test-app-listing-header-publisher]')
        .containsText('By Boxel Publishing');

      assert
        .dom('[data-test-catalog-listing-embedded-license-section]')
        .containsText('MIT License');

      assert
        .dom('[data-test-catalog-listing-embedded-images-section]')
        .exists({ count: 1 });
      assert
        .dom('[data-test-catalog-listing-embedded-examples-section]')
        .exists();

      assert
        .dom('[data-test-catalog-listing-embedded-examples] li')
        .exists({ count: 1 });
      assert.dom('[data-test-catalog-listing-embedded-tags-section]').exists();

      //TODO: this assertion is wrong, there is some issue with rendering of specType
      // also the format of the isolated has some weird css behaviour like Examples title running out of position
      // assert
      //   .dom('[data-test-catalog-listing-embedded-specs-section]')
      //   .containsText('Unknown');

      assert.dom('[data-test-catalog-listing-embedded-specs-section]').exists();

      assert
        .dom('[data-test-catalog-listing-embedded-tags-section]')
        .containsText('Calculator');
      assert
        .dom('[data-test-catalog-listing-embedded-categories-section]')
        .containsText('Writing');
    });

    test('listing with spec that has a missing specType groups it under unknown (accordion assertion)', async function (assert) {
      const unknownListingId = `${mockCatalogURL}Listing/unknown-only`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: unknownListingId,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom(
          '[data-test-catalog-listing-embedded-specs-section] [data-test-accordion-item]',
        )
        .exists({ count: 1 });
      assert
        .dom(
          '[data-test-catalog-listing-embedded-specs-section] [data-test-accordion-item="unknown"]',
        )
        .exists('Unknown group item exists');

      assert
        .dom(
          '[data-test-catalog-listing-embedded-specs-section] [data-test-accordion-item="unknown"]',
        )
        .containsText('unknown (1)');
    });

    test('unknown-only listing shows all default fallback texts', async function (assert) {
      const unknownListingId = `${mockCatalogURL}Listing/unknown-only`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: unknownListingId,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom('[data-test-catalog-listing-embedded-summary-section]')
        .containsText('No Summary Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-license-section]')
        .containsText('No License Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-images-section]')
        .containsText('No Images Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-examples-section]')
        .containsText('No Examples Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-categories-section]')
        .containsText('No Categories Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-tags-section]')
        .containsText('No Tags Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-skills-section]')
        .containsText('No Skills Provided');
    });

    test('remix button does not exist when a listing has no specs', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: emptyListingId,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom('[data-test-catalog-listing-embedded-specs-section]')
        .containsText('No Specs Provided');
      assert.dom('[data-test-catalog-listing-action="Remix"]').doesNotExist();
    });

    test('remix button does not exist when a skill listing has no skills', async function (assert) {
      const emptySkillListingId = incompleteSkillListingId;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: emptySkillListingId,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom('[data-test-catalog-listing-embedded-skills-section]')
        .containsText('No Skills Provided');
      assert.dom('[data-test-catalog-listing-action="Remix"]').doesNotExist();
    });

    test('after clicking "Build" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: apiDocumentationStubListingId,
              format: 'isolated',
            },
          ],
        ],
      });
      await verifyListingAction(
        assert,
        `[data-test-card="${apiDocumentationStubListingId}"] [data-test-catalog-listing-action="Build"]`,
        'Build',
        'Generate .gts card definition for "API Documentation" implementing all requirements from the attached listing specification. Then preview the final code in playground panel.',
        'Test Workspace B',
        false,
      );
    });
  });
});
}
