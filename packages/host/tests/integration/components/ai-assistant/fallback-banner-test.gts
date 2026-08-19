import { click, render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import FallbackBanner, {
  FALLBACK_BANNER_MESSAGE,
} from '@cardstack/host/components/ai-assistant/fallback-banner';

import { setupRenderingTest } from '../../../helpers/setup';

module(
  'Integration | Component | ai-assistant/fallback-banner',
  function (hooks) {
    setupRenderingTest(hooks);

    test('renders the warning copy', async function (assert) {
      await render(<template><FallbackBanner /></template>);

      assert.dom('[data-test-fallback-banner]').exists();
      assert
        .dom('[data-test-fallback-banner]')
        .hasText(FALLBACK_BANNER_MESSAGE);
    });

    test('does not render a dismiss button when @onDismiss is omitted', async function (assert) {
      await render(<template><FallbackBanner /></template>);

      assert.dom('[data-test-fallback-banner-dismiss]').doesNotExist();
    });

    test('clicking the dismiss button invokes @onDismiss', async function (assert) {
      let calls = 0;
      let handleDismiss = () => {
        calls += 1;
      };

      await render(
        <template><FallbackBanner @onDismiss={{handleDismiss}} /></template>,
      );

      assert.dom('[data-test-fallback-banner-dismiss]').exists();
      await click('[data-test-fallback-banner-dismiss]');
      assert.strictEqual(calls, 1, '@onDismiss fired once');
    });
  },
);
