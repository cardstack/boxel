import {
  focus,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import {
  CardDef,
  contains,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import Dashboard from '@cardstack/host/components/operator-mode/dashboard';
import DashboardSections from '@cardstack/host/components/operator-mode/dashboard/sections';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  realmConfigCardJSON,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  skillsRealmURL,
  testRealmURL,
} from '../../helpers';
import {
  clickScopeOption,
  markHosted,
  pressKey,
} from '../../helpers/dashboard';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const catalogRealmURL = 'http://test-realm/catalog/';
const wineCellar = `${catalogRealmURL}AppListing/wine-cellar`;
const recipeBox = `${catalogRealmURL}AppListing/recipe-box`;
const thumbnail =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";

function listingJSON(name: string) {
  return {
    data: {
      attributes: {
        name,
        summary: `Keep track of your ${name.toLowerCase()}.`,
        cardInfo: { cardThumbnailURL: thumbnail },
      },
      meta: {
        adoptsFrom: { module: '../listing', name: 'AppListing' },
      },
    },
  };
}

// The shelf's stories are stops in the keyboard cursor's walk, between the
// workspaces and the catalog tiles, as they are on the page.
module('Integration | dashboard | catalog shelf', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    class AppListing extends CardDef {
      @field name = contains(StringField);
      @field summary = contains(StringField);
    }
    class CatalogIndex extends CardDef {
      @field featured = linksToMany(AppListing);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: catalogRealmURL,
      permissions: { '*': ['read'] },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Catalog' }),
        'listing.gts': { AppListing, CatalogIndex },
        'index.json': {
          data: {
            relationships: {
              'featured.0': { links: { self: './AppListing/wine-cellar' } },
              'featured.1': { links: { self: './AppListing/recipe-box' } },
            },
            meta: {
              adoptsFrom: { module: './listing', name: 'CatalogIndex' },
            },
          },
        },
        'AppListing/wine-cellar.json': listingJSON('Wine Cellar'),
        'AppListing/recipe-box.json': listingJSON('Recipe Box'),
      },
    });
    // The realm server lists it as the one catalog.
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: skillsRealmURL,
      permissions: { '*': ['read'] },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Boxel Skills' }),
      },
    });
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace A' }),
      },
    });

    let sections = new DashboardSections();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Dashboard
            @sections={{sections}}
            @catalogRealmURL={{catalogRealmURL}}
          />
        </template>
      },
    );
    await waitFor(`[data-test-catalog-story="${recipeBox}"]`);
    await waitFor('[data-test-catalog-list] [data-test-workspace]');
  });

  test('the arrow keys walk the stories between the workspaces and the catalog tiles', async function (assert) {
    await focus('[data-test-workspace-button="Workspace A"]');
    // The first arrow key only shows the cursor.
    await pressKey('ArrowRight');
    await pressKey('ArrowRight');
    assert
      .dom('[data-test-catalog-story-selected]')
      .hasAttribute(
        'data-test-catalog-story-selected',
        'Wine Cellar',
        'after the last workspace comes the first story',
      );
    assert
      .dom(
        `[data-test-catalog-story="${wineCellar}"] [data-test-catalog-story-open]`,
      )
      .isFocused();

    await pressKey('ArrowRight');
    assert
      .dom('[data-test-catalog-story-selected]')
      .hasAttribute('data-test-catalog-story-selected', 'Recipe Box');

    await pressKey('ArrowRight');
    assert
      .dom('[data-test-catalog-story-selected]')
      .doesNotExist('the last story gives way to the catalogs');
    assert
      .dom('[data-test-catalog-list] [data-test-workspace-selected]')
      .exists('after the stories come the catalog tiles');

    await pressKey('ArrowLeft');
    await pressKey('ArrowLeft');
    await pressKey('ArrowLeft');
    assert
      .dom('[data-test-workspace-selected="Workspace A"]')
      .exists('back past the stories to the workspace');
  });

  test("the cursor's ring marks its story until a pointer press", async function (assert) {
    await focus('[data-test-workspace-button="Workspace A"]');
    await pressKey('ArrowRight');
    await pressKey('ArrowRight');
    assert
      .dom('[data-test-catalog-story-ring]')
      .hasAttribute('data-test-catalog-story-ring', 'Wine Cellar');

    await triggerEvent('[data-test-dashboard]', 'pointerup');
    assert.dom('[data-test-catalog-story-ring]').doesNotExist();
    assert
      .dom('[data-test-catalog-story-selected]')
      .hasAttribute(
        'data-test-catalog-story-selected',
        'Wine Cellar',
        'the cursor stays on the story',
      );
  });

  test('Hosted takes the stories out of the walk along with the shelf', async function (assert) {
    markHosted(testRealmURL);
    markHosted(skillsRealmURL);
    await clickScopeOption('hosted');
    assert.dom('[data-test-catalog-shelf]').doesNotExist();

    await focus('[data-test-workspace-button="Workspace A"]');
    await pressKey('ArrowRight');
    await pressKey('ArrowRight');
    assert
      .dom('[data-test-catalog-list] [data-test-workspace-selected]')
      .exists('after the last workspace comes the first catalog tile');
  });

  test('Enter opens the story the cursor is on', async function (assert) {
    await focus('[data-test-workspace-button="Workspace A"]');
    await pressKey('ArrowRight');
    await pressKey('ArrowRight');
    await pressKey('ArrowRight');
    assert
      .dom('[data-test-catalog-story-selected]')
      .hasAttribute('data-test-catalog-story-selected', 'Recipe Box');

    await triggerKeyEvent(
      `[data-test-catalog-story="${recipeBox}"] [data-test-catalog-story-open]`,
      'keydown',
      'Enter',
    );

    let operatorModeState = getService(
      'operator-mode-state-service',
    ) as OperatorModeStateService;
    assert.deepEqual(
      operatorModeState.topMostStackItems().map(({ id }) => id),
      [recipeBox],
      'the listing opens',
    );
  });

  test('focus on a story moves the cursor to it', async function (assert) {
    await focus(
      `[data-test-catalog-story="${recipeBox}"] [data-test-catalog-story-action]`,
    );
    assert
      .dom('[data-test-catalog-story-selected]')
      .hasAttribute(
        'data-test-catalog-story-selected',
        'Recipe Box',
        "focus on a story's own button selects the story",
      );
  });
});
