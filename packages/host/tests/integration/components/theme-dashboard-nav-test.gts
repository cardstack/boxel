import {
  click,
  waitFor,
  waitUntil,
  type RenderingTestContext,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard, renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as ThemeDashboardModule from '@cardstack/base/default-templates/theme-dashboard';
import type * as StructuredThemeModule from '@cardstack/base/structured-theme';
import type * as StructuredThemeVarsModule from '@cardstack/base/structured-theme-variables';
import type * as StyleReferenceModule from '@cardstack/base/style-reference';

module('Integration | theme-dashboard | nav', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let NavBar: typeof ThemeDashboardModule.NavBar;
  let StructuredTheme: typeof StructuredThemeModule.default;
  let StyleReference: typeof StyleReferenceModule.default;
  let ThemeVarField: typeof StructuredThemeVarsModule.default;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    NavBar = (
      await loader.import<typeof ThemeDashboardModule>(
        '@cardstack/base/default-templates/theme-dashboard',
      )
    ).NavBar;
    StructuredTheme = (
      await loader.import<typeof StructuredThemeModule>(
        '@cardstack/base/structured-theme',
      )
    ).default;
    StyleReference = (
      await loader.import<typeof StyleReferenceModule>(
        '@cardstack/base/style-reference',
      )
    ).default;
    ThemeVarField = (
      await loader.import<typeof StructuredThemeVarsModule>(
        '@cardstack/base/structured-theme-variables',
      )
    ).default;
  });

  function navItemIds(element: Element) {
    return [...element.querySelectorAll('[data-test-theme-nav-item]')].map(
      (el) => el.getAttribute('data-test-theme-nav-item'),
    );
  }

  test('a themed card lists the visualizer as Preview in the nav', async function (this: RenderingTestContext, assert) {
    let card = new StructuredTheme({
      rootVariables: new ThemeVarField({ background: '#f6e6ee' }),
    });
    let element = await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-theme-nav-item="preview"]')
      .hasText('Preview', 'the nav links to the visualizer');
    assert
      .dom('#preview')
      .exists('the visualizer carries the id the nav entry targets');
    assert.strictEqual(
      navItemIds(element)[0],
      'preview',
      'Preview leads the nav',
    );
    assert
      .dom('[data-test-theme-nav] [data-test-mode]')
      .exists('the dark-mode toggle is affixed to the nav bar');
  });

  test('a theme-less edit view leads the nav with Import CSS and has no Preview entry', async function (this: RenderingTestContext, assert) {
    let card = new StructuredTheme({});
    let element = await renderCard(loader, card, 'edit');

    assert.dom('[data-test-theme-nav-item="preview"]').doesNotExist();
    assert.strictEqual(
      navItemIds(element)[0],
      'import-css',
      'the import workflow leads the nav',
    );
  });

  test('a theme-less style reference edit view renders its sections in nav order', async function (this: RenderingTestContext, assert) {
    let card = new StyleReference({});
    let element = await renderCard(loader, card, 'edit');

    let sectionIds = [
      ...element.querySelectorAll('[data-test-style-ref-section]'),
    ].map((el) => el.getAttribute('data-test-style-ref-section'));
    assert.deepEqual(
      sectionIds,
      ['import-css', 'view-code', 'visual-dna', 'inspirations', 'wallpapers'],
      'the body leads with the import workflow, matching the nav',
    );
    assert.deepEqual(
      navItemIds(element).slice(0, 2),
      ['import-css', 'view-code'],
      'the nav leads with the import workflow',
    );
  });

  test('extra nav items collapse into a dropdown menu when the bar overflows', async function (this: RenderingTestContext, assert) {
    let sections = Array.from({ length: 12 }, (_, i) => ({
      id: `section-${i}`,
      navTitle: `Section ${i}`,
    }));
    let noop = () => {};
    // container-type matches the dashboard root, so the nav's container-query
    // rules apply at this width like in a real card. the width stays above the
    // bar's compact threshold, where the strip gives way to a hamburger menu
    await renderComponent(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div
          style='width: 30rem; container-type: inline-size'
          data-test-nav-test-wrapper
        >
          <NavBar @sections={{sections}} @toggleDarkMode={{noop}} />
        </div>
      </template>,
    );

    await waitFor('[data-test-theme-nav-more]');
    assert
      .dom('[data-test-theme-nav-more]')
      .isVisible('the more button appears when items overflow');
    // overflowing items are hidden with visibility, which isVisible can't see
    function itemVisibility(sectionId: string) {
      let item = document.querySelector(
        `[data-test-theme-nav-item="${sectionId}"]`,
      )!;
      return getComputedStyle(item).visibility;
    }
    assert.strictEqual(
      itemVisibility('section-0'),
      'visible',
      'leading items stay in the bar',
    );
    assert.strictEqual(
      itemVisibility('section-11'),
      'hidden',
      'overflowing items are hidden from the bar',
    );

    let visibleItems = [
      ...document.querySelectorAll('[data-test-theme-nav-item]'),
    ].filter((el) => getComputedStyle(el).visibility === 'visible');
    let lastVisible = visibleItems[visibleItems.length - 1]!;
    let moreButton = document.querySelector('[data-test-theme-nav-more]')!;
    let distance =
      moreButton.getBoundingClientRect().left -
      lastVisible.getBoundingClientRect().right;
    let hugsLastItem = distance >= 0 && distance < 30;
    assert.true(
      hugsLastItem,
      `the more button sits right after the last visible item (gap ${distance}px)`,
    );

    await click('[data-test-theme-nav-more]');
    assert
      .dom('[data-test-boxel-menu-item-text="Section 11"]')
      .exists('hidden items are listed in the dropdown');
    assert
      .dom('[data-test-boxel-menu-item-text="Section 0"]')
      .doesNotExist('items already in the bar are not duplicated');

    await click('[data-test-theme-nav-more]');
    let wrapper: HTMLElement = document.querySelector(
      '[data-test-nav-test-wrapper]',
    )!;
    wrapper.style.width = '160rem';
    await waitUntil(
      () => !document.querySelector('[data-test-theme-nav-more]'),
    );
    assert.strictEqual(
      itemVisibility('section-11'),
      'visible',
      'every item returns to the bar once it fits',
    );
  });
});
