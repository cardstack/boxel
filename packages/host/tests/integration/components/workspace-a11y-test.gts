import { fillIn, render, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import {
  Workspace,
  setupBaseRealm,
  setupWorkspaceCard,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef, Format } from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

// `getComponent` returns an unparameterised ComponentLike; name the one argument
// these tests pass so the wrapper templates below type-check.
type CardComponent = ComponentLike<{ Args: { format?: Format } }>;

// The Workspace chrome updates several surfaces on its own — search results
// appear, setup jobs advance — with no interaction to hang an announcement off.
// These cover the accessible names and status regions that carry those changes,
// and the operator-mode rule that hides the chrome on a buried card.
module('Integration | Card | workspace | accessibility', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupWorkspaceCard(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  async function componentFor(card: CardDef): Promise<CardComponent> {
    let api = await loader.import<typeof import('@cardstack/base/card-api')>(
      '@cardstack/base/card-api',
    );
    return api.getComponent(card) as CardComponent;
  }

  test('the hotkey hint is decorative, and the shortcut is on the input', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');

    assert
      .dom('.search-box .search-kbd')
      .hasAttribute(
        'aria-hidden',
        'true',
        'the visible hint is not read out twice',
      );
    // Both spellings, because the binding accepts either modifier.
    assert
      .dom('.search-box .search-input')
      .hasAttribute('aria-keyshortcuts', 'Meta+K Control+K');
  });

  test('the hotkey hint matches the platform', async function (assert) {
    let ws = await loader.import<typeof import('@cardstack/base/workspace')>(
      '@cardstack/base/workspace',
    );
    await renderCard(loader, new Workspace({}), 'isolated');

    // Asserted against the label the module computed for this browser rather
    // than a hardcoded glyph, so the test reads the same on any platform.
    assert
      .dom('.search-box .search-kbd')
      .hasText(ws.searchHotkeyLabel(navigator.platform));
  });

  test('the search status region is present and silent before searching', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');

    // Present from the start: a live region only announces changes that happen
    // while it is already in the DOM.
    assert
      .dom('[data-test-search-announcement]')
      .exists('the status region is rendered up front')
      .hasAttribute('role', 'status')
      .hasNoText('nothing to announce before a term is typed');
  });

  test('a search with no matches announces that, rather than staying silent', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');

    await fillIn('.search-box .search-input', 'zzz-no-such-card');
    // The search debounces, so wait for it to settle rather than asserting into
    // the window where results are legitimately empty.
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-search-announcement]')
          ?.textContent?.trim() !== '',
      { timeout: 5000 },
    );

    assert.dom('[data-test-search-announcement]').hasText('No matching cards');

    // `.boxel-sr-only` sits in `@layer utilities`, and this card's scoped CSS is
    // unlayered — so any scoped rule matching this span would win and put the
    // announcement on screen. Assert the hiding actually took effect.
    let region = document.querySelector(
      '[data-test-search-announcement]',
    ) as HTMLElement;
    assert.strictEqual(
      getComputedStyle(region).position,
      'absolute',
      'the announcement is visually hidden, not laid out',
    );
    assert.strictEqual(
      getComputedStyle(region).clipPath,
      'inset(50%)',
      'and clipped rather than merely offset',
    );
  });

  test('the progress region is present and silent with no running jobs', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');

    assert
      .dom('[data-test-progress-announcement]')
      .exists('rendered at the root, outside every segment')
      .hasAttribute('role', 'status')
      .hasNoText('nothing running, nothing to say');
  });

  test('the chrome is hidden on a buried operator-mode card', async function (assert) {
    let Comp = await componentFor(new Workspace({}));

    // The ancestors the host really renders: `.operator-mode` on the container
    // and `.buried` on a stack item that is not on top. The card's scoped CSS
    // only scopes the selector's last compound, so these match from outside it.
    await render(
      <template>
        <div class='operator-mode'>
          <div class='buried'>
            <Comp @format='isolated' />
          </div>
        </div>
      </template>,
    );

    assert
      .dom('.frame-actions')
      .exists('the search chrome is still rendered')
      .isNotVisible('but hidden while the card is buried');
  });

  test('the chrome is visible on a card that is not buried', async function (assert) {
    let Comp = await componentFor(new Workspace({}));

    await render(
      <template>
        <div class='operator-mode'>
          <div>
            <Comp @format='isolated' />
          </div>
        </div>
      </template>,
    );

    assert.dom('.frame-actions').isVisible('shown for the top card');
  });
});
