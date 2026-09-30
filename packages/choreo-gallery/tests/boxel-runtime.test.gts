import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { click } from '@ember/test-helpers';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

const siteModuleURL = new URL('./site', import.meta.url).href;

export function runTests() {
  module('Choreo gallery | generated Boxel runtime', function (hooks) {
    setupCardTest(hooks);

    test('the authored site renders and navigates through Boxel', async function (assert) {
      let loader = getService('loader-service').loader;
      let { ChoreoGallery } = await loader.import(siteModuleURL);
      let site = new ChoreoGallery({});

      history.replaceState({}, '', '/');
      await renderCard(loader, site, 'isolated');

      assert.dom('.hero').exists('gallery hero rendered');
      assert.dom('.card').exists({ count: 45 }, 'all canonical tiles rendered');
      await click('button[title="Switch to light mode"]');
      assert.dom('.choreo-site').hasAttribute('data-theme', 'light');
      await click('button[title="Switch to dark mode"]');
      assert.dom('.choreo-site').hasAttribute('data-theme', 'dark');
      assert
        .dom('.card[data-demo="mockup"] iframe')
        .doesNotExist('Mockup stays in the main DOM');
      assert
        .dom('.card[data-demo="long-take"] iframe')
        .doesNotExist('Long Take stays in the main DOM');

      await click('.card[data-demo="keyframes"] .card-meta');

      assert
        .dom('.demo-head[data-demo="keyframes"]')
        .exists('the detail route rendered in place');
      assert
        .dom('.sample code')
        .includesText('motion', 'highlighted GTS content is present');
      assert.true(
        location.pathname.endsWith('/keyframes'),
        'the deep-link URL changed without a reload',
      );
      await click(document.querySelector('.topbar a')!);
      await click('.card[data-demo="towers"] .card-meta');
      await click('.tw-theater-btn');
      assert.dom('.choreo-site').hasClass('is-theater');
      assert
        .dom('.tw-theater-btn')
        .isNotVisible('the entry control does not overlap the theater exit');
      assert
        .dom('.theater-built')
        .isVisible('the theater exit remains available');
    });
  });
}
