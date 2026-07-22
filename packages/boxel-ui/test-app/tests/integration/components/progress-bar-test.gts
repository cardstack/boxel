import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

import { ProgressBar } from '@cardstack/boxel-ui/components';

module('Integration | Component | progress-bar', function (hooks) {
  setupRenderingTest(hooks);

  test('exposes the progressbar role and aria value range', async function (assert) {
    await render(<template><ProgressBar @value={{3}} @max={{12}} /></template>);

    assert
      .dom('[data-test-boxel-progress-bar]')
      .hasAttribute('role', 'progressbar')
      .hasAttribute('aria-valuenow', '3')
      .hasAttribute('aria-valuemin', '0')
      .hasAttribute('aria-valuemax', '12')
      .hasAttribute('aria-valuetext', '25%');
  });

  test('clamps aria-valuenow into [0, max]', async function (assert) {
    await render(
      <template><ProgressBar @value={{20}} @max={{12}} /></template>,
    );

    assert
      .dom('[data-test-boxel-progress-bar]')
      .hasAttribute('aria-valuenow', '12')
      .hasAttribute('aria-valuetext', '100%');
  });

  test('uses the label as the accessible name when provided', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{1}} @max={{4}} @label='Importing files' />
      </template>,
    );

    assert
      .dom('[data-test-boxel-progress-bar]')
      .hasAttribute('aria-label', 'Importing files');
  });

  test('falls back to a generic accessible name when no label is provided', async function (assert) {
    await render(<template><ProgressBar @value={{3}} @max={{12}} /></template>);

    // role="progressbar" requires a non-empty accessible name; an empty
    // aria-label would fail the aria-progressbar-name axe rule.
    assert
      .dom('[data-test-boxel-progress-bar]')
      .hasAttribute('aria-label', 'Progress');
  });
});
