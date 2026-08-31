import { htmlSafe } from '@ember/template';
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

  // scrolling to a section replaceState's its hash onto the test page's URL
  hooks.afterEach(function () {
    if (window.location.hash) {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
  });

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

  // scrollToSectionFrom needs a scrollable ancestor inside the dashboard, so
  // the harness mirrors the card: a short scroll port with tall sections
  function navHarness(
    sections: { id: string; navTitle: string }[],
    width: string,
  ) {
    let noop = () => {};
    let style = htmlSafe(
      `width: ${width}; height: 12rem; overflow-y: auto; container-type: inline-size`,
    );
    return renderComponent(
      <template>
        <div style={{style}} data-theme-dashboard data-test-nav-test-wrapper>
          <NavBar @sections={{sections}} @toggleDarkMode={{noop}} />
          {{#each sections as |section|}}
            {{! template-lint-disable no-inline-styles }}
            <div id={{section.id}} style='height: 20rem'>
              {{section.navTitle}}
            </div>
          {{/each}}
        </div>
      </template>,
    );
  }

  // the smooth scroll is the observable effect of a menu action; capturing the
  // call keeps the assertion off the animation's timing
  function captureScrollBy(element: HTMLElement) {
    let calls: ScrollToOptions[] = [];
    let original = element.scrollBy;
    element.scrollBy = ((options?: ScrollToOptions | number) => {
      if (typeof options === 'object') {
        calls.push(options);
      }
    }) as HTMLElement['scrollBy'];
    return {
      calls,
      restore: () => {
        element.scrollBy = original;
      },
    };
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

  // the edit view maps each nav id onto a section through a hardcoded
  // conditional chain, so an id the chain doesn't know renders no section and
  // the nav link scrolls nowhere
  test('every style reference nav item targets a rendered section', async function (this: RenderingTestContext, assert) {
    let card = new StyleReference({
      rootVariables: new ThemeVarField({ background: '#f6e6ee' }),
    });
    let element = await renderCard(loader, card, 'edit');

    let ids = navItemIds(element);
    assert.deepEqual(
      ids,
      [
        'preview',
        'visual-dna',
        'inspirations',
        'wallpapers',
        'import-css',
        'view-code',
      ],
      'the nav lists the preview, the content sections and the theme tools',
    );
    for (let id of ids) {
      assert
        .dom(`[id="${id}"]`, element)
        .exists(`the "${id}" nav item has a section to scroll to`);
    }
  });

  test('choosing an overflowed section from the menu scrolls to it', async function (this: RenderingTestContext, assert) {
    let sections = Array.from({ length: 12 }, (_, i) => ({
      id: `section-${i}`,
      navTitle: `Section ${i}`,
    }));
    // above the compact threshold, so the strip keeps its "more" dropdown
    await navHarness(sections, '30rem');
    await waitFor('[data-test-theme-nav-more]');

    let scroller: HTMLElement = document.querySelector(
      '[data-test-nav-test-wrapper]',
    )!;
    let scrollBy = captureScrollBy(scroller);
    try {
      await click('[data-test-theme-nav-more]');
      await click('[data-test-boxel-menu-item-text="Section 11"]');
    } finally {
      scrollBy.restore();
    }

    assert.strictEqual(
      scrollBy.calls.length,
      1,
      'the menu item scrolls the dashboard once',
    );
    assert.true(
      (scrollBy.calls[0]?.top ?? 0) > 0,
      'it scrolls down toward the chosen section',
    );
    assert.strictEqual(
      window.location.hash,
      '#section-11',
      'the chosen section becomes the current hash',
    );
  });

  test('choosing a section from the compact menu scrolls to it', async function (this: RenderingTestContext, assert) {
    let sections = Array.from({ length: 12 }, (_, i) => ({
      id: `section-${i}`,
      navTitle: `Section ${i}`,
    }));
    // below the compact threshold, where the strip becomes a hamburger menu
    await navHarness(sections, '20rem');
    await waitFor('[data-test-theme-nav-menu]');

    let scroller: HTMLElement = document.querySelector(
      '[data-test-nav-test-wrapper]',
    )!;
    let scrollBy = captureScrollBy(scroller);
    try {
      await click('[data-test-theme-nav-menu]');
      await click('[data-test-boxel-menu-item-text="Section 3"]');
    } finally {
      scrollBy.restore();
    }

    assert.strictEqual(
      scrollBy.calls.length,
      1,
      'the menu item scrolls the dashboard once',
    );
    assert.true(
      (scrollBy.calls[0]?.top ?? 0) > 0,
      'it scrolls down toward the chosen section',
    );
    assert.strictEqual(
      window.location.hash,
      '#section-3',
      'the chosen section becomes the current hash',
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
