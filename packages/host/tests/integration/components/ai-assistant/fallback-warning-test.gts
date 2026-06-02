import { render, triggerEvent, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import FallbackWarning, {
  FALLBACK_WARNING_MESSAGE,
} from '@cardstack/host/components/ai-assistant/fallback-warning';

import { setupRenderingTest } from '../../../helpers/setup';

module(
  'Integration | Component | ai-assistant/fallback-warning',
  function (hooks) {
    setupRenderingTest(hooks);

    test('renders an accessible warning icon trigger', async function (assert) {
      await render(<template><FallbackWarning /></template>);

      assert
        .dom('[data-test-fallback-warning]')
        .exists('warning icon trigger is rendered');
      assert
        .dom('[aria-label="AI assistant is running in fallback mode"]')
        .exists('icon exposes its purpose to assistive tech');
      assert
        .dom('[data-test-tooltip-content]')
        .doesNotExist('tooltip content is hidden until hover');
    });

    test('shows the warning text on hover', async function (assert) {
      await render(<template><FallbackWarning /></template>);

      await triggerEvent('[data-test-fallback-warning]', 'mouseenter');
      await waitFor('[data-test-tooltip-content]');

      assert
        .dom('[data-test-tooltip-content]')
        .hasText(FALLBACK_WARNING_MESSAGE);
    });
  },
);
