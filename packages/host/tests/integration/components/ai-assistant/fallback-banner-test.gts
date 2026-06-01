import { click, render } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import FallbackBanner, {
  FALLBACK_BANNER_DISMISSED_KEY,
} from '@cardstack/host/components/ai-assistant/fallback-banner';

import { setupRenderingTest } from '../../../helpers/setup';

module(
  'Integration | Component | ai-assistant/fallback-banner',
  function (hooks) {
    setupRenderingTest(hooks);
    setupWindowMock(hooks);

    test('renders the warning copy and dismiss button', async function (assert) {
      await render(<template><FallbackBanner /></template>);

      assert
        .dom('[data-test-fallback-banner]')
        .exists('banner is rendered when not dismissed');
      assert
        .dom('[data-test-fallback-banner]')
        .containsText("Custom system card couldn't be loaded");
      assert
        .dom('[data-test-fallback-banner]')
        .containsText('using built-in defaults');
      assert
        .dom('[data-test-fallback-banner]')
        .containsText('Some models may have reduced capabilities');
      assert
        .dom('[data-test-fallback-banner-dismiss]')
        .exists('dismiss button is rendered');
    });

    test('dismissing writes the sessionStorage flag and hides the banner', async function (assert) {
      await render(<template><FallbackBanner /></template>);

      assert.strictEqual(
        window.sessionStorage.getItem(FALLBACK_BANNER_DISMISSED_KEY),
        null,
        'precondition: sessionStorage flag is unset',
      );

      await click('[data-test-fallback-banner-dismiss]');

      assert.strictEqual(
        window.sessionStorage.getItem(FALLBACK_BANNER_DISMISSED_KEY),
        'true',
        'sessionStorage flag is set',
      );
      assert
        .dom('[data-test-fallback-banner]')
        .doesNotExist('banner is removed from the DOM');
    });

    test('does not render when sessionStorage flag is already set', async function (assert) {
      window.sessionStorage.setItem(FALLBACK_BANNER_DISMISSED_KEY, 'true');

      await render(<template><FallbackBanner /></template>);

      assert
        .dom('[data-test-fallback-banner]')
        .doesNotExist(
          'banner is hidden when sessionStorage already has the dismiss flag',
        );
    });
  },
);
