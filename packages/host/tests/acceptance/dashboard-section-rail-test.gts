import {
  click,
  findAll,
  focus,
  settled,
  triggerEvent,
  triggerKeyEvent,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { visitOperatorMode } from '../helpers';
import {
  realmURL,
  clickScopeOption,
  markHosted,
  railOrder,
  setupDashboardTest,
} from '../helpers/dashboard';

module('Acceptance | dashboard section rail', function (hooks) {
  setupDashboardTest(hooks);

  const RAIL = '[data-test-section-rail]';
  const ENTRY = '[data-test-section-rail-entry="workspaces"]';
  const FLYOUT = '[data-test-section-rail-flyout="workspaces"]';
  const FAVORITES_ENTRY = '[data-test-section-rail-entry="favorites"]';
  const FAVORITES_FLYOUT = '[data-test-section-rail-flyout="favorites"]';
  const CATALOGS_ENTRY = '[data-test-section-rail-entry="catalogs"]';
  const CATALOGS_FLYOUT = '[data-test-section-rail-flyout="catalogs"]';
  const ITEM = (id: string) => `[data-test-section-rail-item="${id}"]`;

  function favoriteWorkspaceA() {
    let matrixService = getService('matrix-service') as MatrixService;
    matrixService.workspaceFavorites = [realmURL];
  }

  // As a browser does for Enter on a focused button: the key, then its
  // click.
  async function pressEntry(entry: string) {
    await focus(entry);
    await triggerKeyEvent(entry, 'keydown', 'Enter');
    await click(entry);
  }

  function openCardIds() {
    return (
      getService('operator-mode-state-service') as OperatorModeStateService
    ).getOpenCardIds();
  }

  test('lists the sections that register, and marks the one being read', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    assert.deepEqual(
      railOrder(),
      ['workspaces', 'catalogs', 'agents'],
      'in page order, with no Favorites entry while there are no favorites',
    );
    assert.dom(RAIL).isVisible();
    assert
      .dom(`${ITEM('workspaces')} [role="tooltip"]`)
      .hasText('Workspaces', 'a tooltip names its section, with no count');
    assert.dom(`${ITEM('catalogs')} [role="tooltip"]`).hasText('Catalogs');
    assert
      .dom(ENTRY)
      .hasAttribute('aria-current', 'location', 'the top section is read');
    assert.dom(CATALOGS_ENTRY).doesNotHaveAttribute('aria-current');
  });

  test('with a favorite, the Favorites entry comes first, and its flyout counts the favorites', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    favoriteWorkspaceA();
    await settled();

    assert.deepEqual(
      railOrder(),
      ['favorites', 'workspaces', 'catalogs', 'agents'],
      'the rail follows the page',
    );
    assert.dom(`${ITEM('favorites')} [role="tooltip"]`).hasText('Favorites');
    assert
      .dom(FAVORITES_ENTRY)
      .hasAttribute('aria-current', 'location', 'the top section is read');

    await click(FAVORITES_ENTRY);

    assert
      .dom(`${FAVORITES_FLYOUT} [data-test-section-rail-flyout-count]`)
      .hasText('1', 'the header counts the list below it');
  });

  test('the Catalogs entry opens its flyout of catalogs, and a catalog opens its workspace', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    let tileNames = findAll(
      '[data-test-catalog-list] [data-test-workspace]',
    ).map((el) => el.getAttribute('data-test-workspace'));
    assert.true(tileNames.length > 0, 'the fixture lists a catalog');

    await click(CATALOGS_ENTRY);

    assert
      .dom(`${CATALOGS_FLYOUT} [data-test-section-rail-flyout-count]`)
      .hasText(String(tileNames.length));
    assert.deepEqual(
      findAll(`${CATALOGS_FLYOUT} [data-test-section-rail-realm]`).map((el) =>
        el.getAttribute('data-test-section-rail-realm'),
      ),
      tileNames,
      'the catalogs the page lists, in its order',
    );

    await click(
      `${CATALOGS_FLYOUT} [data-test-section-rail-realm="${tileNames[0]}"]`,
    );

    assert.dom('[data-test-dashboard]').doesNotExist();
  });

  test('the Workspaces entry opens its flyout of workspaces, and a workspace opens it', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await pressEntry(ENTRY);

    assert.dom(ENTRY).hasAttribute('aria-expanded', 'true');
    assert.dom(`${FLYOUT} [data-test-section-rail-flyout-count]`).hasText('1');
    assert.deepEqual(
      findAll(`${FLYOUT} [data-test-section-rail-realm]`).map((el) =>
        el.getAttribute('data-test-section-rail-realm'),
      ),
      ['Workspace A'],
      'only their own workspaces, not the catalogs',
    );

    await click(`${FLYOUT} [data-test-section-rail-realm="Workspace A"]`);

    assert.dom('[data-test-dashboard]').doesNotExist();
    assert.strictEqual(
      (getService('operator-mode-state-service') as OperatorModeStateService)
        .realmURL,
      realmURL,
      'Workspace A is the open workspace',
    );
  });

  test('pressing Enter on the Favorites entry opens its flyout of favorites, and a favorite opens its workspace', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    favoriteWorkspaceA();
    await settled();

    await focus(FAVORITES_ENTRY);
    assert
      .dom(FAVORITES_FLYOUT)
      .doesNotExist('focus alone leaves it closed, so Tab passes the rail');

    await pressEntry(FAVORITES_ENTRY);

    assert.dom(FAVORITES_ENTRY).hasAttribute('aria-expanded', 'true');
    assert.dom(FAVORITES_FLYOUT).exists();
    assert.dom(`${FAVORITES_FLYOUT} header`).hasText('Favorites 1');
    assert
      .dom(`${FAVORITES_FLYOUT} [data-test-section-rail-realm]`)
      .exists({ count: 1 });

    await click(
      `${FAVORITES_FLYOUT} [data-test-section-rail-realm="Workspace A"]`,
    );

    assert.dom('[data-test-dashboard]').doesNotExist();
    assert.strictEqual(
      (getService('operator-mode-state-service') as OperatorModeStateService)
        .realmURL,
      realmURL,
      'Workspace A is the open workspace',
    );
  });

  test('under Hosted, each flyout lists only what the page lists', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    favoriteWorkspaceA();
    await settled();
    await clickScopeOption('hosted');

    function flyoutNames(flyout: string) {
      return findAll(`${flyout} [data-test-section-rail-realm]`).map((el) =>
        el.getAttribute('data-test-section-rail-realm'),
      );
    }

    for (let [entry, flyout] of [
      [FAVORITES_ENTRY, FAVORITES_FLYOUT],
      [ENTRY, FLYOUT],
      [CATALOGS_ENTRY, CATALOGS_FLYOUT],
    ]) {
      await click(entry);
      assert.deepEqual(flyoutNames(flyout), [], `${entry} lists nothing`);
      assert
        .dom(`${flyout} [data-test-section-rail-flyout-empty]`)
        .hasText('No matching results');
      await click(entry);
    }

    markHosted(realmURL);
    await settled();

    await click(FAVORITES_ENTRY);
    assert.deepEqual(
      flyoutNames(FAVORITES_FLYOUT),
      ['Workspace A'],
      'a hosted favorite is listed',
    );
    assert
      .dom(`${FAVORITES_FLYOUT} [data-test-section-rail-flyout-empty]`)
      .doesNotExist();
    await click(FAVORITES_ENTRY);

    await click(ENTRY);
    assert.deepEqual(
      flyoutNames(FLYOUT),
      ['Workspace A'],
      'a hosted workspace is listed',
    );
  });

  test('Escape closes the flyout with focus back on its entry', async function (assert) {
    await visitOperatorMode({
      workspaceChooserOpened: true,
      stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
    });
    favoriteWorkspaceA();
    await settled();
    await pressEntry(FAVORITES_ENTRY);
    await focus(
      `${FAVORITES_FLYOUT} [data-test-section-rail-realm="Workspace A"]`,
    );

    await triggerKeyEvent(
      `${FAVORITES_FLYOUT} [data-test-section-rail-realm="Workspace A"]`,
      'keydown',
      'Escape',
    );

    assert.dom(FAVORITES_FLYOUT).doesNotExist();
    assert.dom(FAVORITES_ENTRY).isFocused('focus goes back to the entry');
    assert.deepEqual(
      openCardIds(),
      [`${realmURL}index`],
      'Escape stays in the rail, so the card behind the dashboard stays open',
    );
  });

  test('Escape closes a flyout opened by a click that left focus elsewhere on the page', async function (assert) {
    await visitOperatorMode({
      workspaceChooserOpened: true,
      stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
    });
    // A click alone, as in a browser whose buttons take no focus on
    // click, so focus stays off the rail.
    await triggerEvent(ENTRY, 'click');
    assert.dom(FLYOUT).exists();
    assert.dom(ENTRY).isNotFocused();

    await triggerKeyEvent(document.body, 'keydown', 'Escape');

    assert.dom(FLYOUT).doesNotExist();
    assert.deepEqual(
      openCardIds(),
      [`${realmURL}index`],
      'the card behind the dashboard stays open',
    );
  });

  test('a tap on an entry toggles its flyout, and a tap outside the rail closes it', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    // As on a touch screen: the press focuses the entry before its click.
    async function tap() {
      await triggerEvent(CATALOGS_ENTRY, 'pointerdown', {
        pointerType: 'touch',
      });
      await focus(CATALOGS_ENTRY);
      await click(CATALOGS_ENTRY);
    }

    await tap();
    assert.dom(CATALOGS_FLYOUT).exists('the first tap opens the flyout');

    await tap();
    assert.dom(CATALOGS_FLYOUT).doesNotExist('the second tap closes it');

    await tap();
    await triggerEvent('[data-test-dashboard-greeting]', 'pointerdown', {
      pointerType: 'touch',
    });
    assert
      .dom(CATALOGS_FLYOUT)
      .doesNotExist('a tap outside the rail closes it');
  });
});
