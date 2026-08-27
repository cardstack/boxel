import {
  settled,
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

  function navItemHrefs(element: Element) {
    return [...element.querySelectorAll('.dsr-nav .nav-item')].map((el) =>
      el.getAttribute('href'),
    );
  }

  test('a themed card lists the visualizer as Preview in the nav', async function (this: RenderingTestContext, assert) {
    let card = new StructuredTheme({
      rootVariables: new ThemeVarField({ background: '#f6e6ee' }),
    });
    let element = await renderCard(loader, card, 'isolated');

    assert
      .dom('.dsr-nav a[href="#preview"]')
      .hasText('Preview', 'the nav links to the visualizer');
    assert
      .dom('#preview')
      .exists('the visualizer carries the id the nav entry targets');
    assert.strictEqual(
      navItemHrefs(element)[0],
      '#preview',
      'Preview leads the nav',
    );
  });

  test('a theme-less edit view leads the nav with Import CSS and has no Preview entry', async function (this: RenderingTestContext, assert) {
    let card = new StructuredTheme({});
    let element = await renderCard(loader, card, 'edit');

    assert.dom('.dsr-nav a[href="#preview"]').doesNotExist();
    assert.strictEqual(
      navItemHrefs(element)[0],
      '#import-css',
      'the import workflow leads the nav',
    );
  });

  test('a theme-less style reference edit view renders its sections in nav order', async function (this: RenderingTestContext, assert) {
    let card = new StyleReference({});
    let element = await renderCard(loader, card, 'edit');

    let sectionIds = [
      ...element.querySelectorAll('.style-ref-grid > section[id]'),
    ].map((el) => el.id);
    assert.deepEqual(
      sectionIds,
      ['import-css', 'view-code', 'visual-dna', 'inspirations', 'wallpapers'],
      'the body leads with the import workflow, matching the nav',
    );
    assert.deepEqual(
      navItemHrefs(element).slice(0, 2),
      ['#import-css', '#view-code'],
      'the nav leads with the import workflow',
    );
  });

  test('scroll chevrons track overflow and disable at the scroll ends', async function (this: RenderingTestContext, assert) {
    let sections = Array.from({ length: 12 }, (_, i) => ({
      id: `section-${i}`,
      navTitle: `Section ${i}`,
    }));
    await renderComponent(
      <template>
        <div class='nav-test-wrapper' style='width: 10rem'>
          <NavBar @sections={{sections}} />
        </div>
      </template>,
    );

    await waitFor('[aria-label="Scroll navigation right"]');
    assert
      .dom('[aria-label="Scroll navigation right"]')
      .isNotDisabled('can scroll toward the overflowing items');
    assert
      .dom('[aria-label="Scroll navigation left"]')
      .isDisabled('nothing to scroll back to at rest');

    let navGrid = document.querySelector('.nav-grid')!;
    navGrid.scrollLeft = navGrid.scrollWidth;
    navGrid.dispatchEvent(new Event('scroll'));
    await settled();
    assert
      .dom('[aria-label="Scroll navigation right"]')
      .isDisabled('right chevron disables at the end of the strip');
    assert
      .dom('[aria-label="Scroll navigation left"]')
      .isNotDisabled('left chevron enables once scrolled');

    let wrapper: HTMLElement = document.querySelector('.nav-test-wrapper')!;
    wrapper.style.width = '80rem';
    await waitUntil(
      () => !document.querySelector('[aria-label="Scroll navigation right"]'),
    );
    assert
      .dom('[aria-label="Scroll navigation left"]')
      .doesNotExist('chevrons leave once the items fit');
  });
});
