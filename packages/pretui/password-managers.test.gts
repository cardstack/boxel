// Pretui — the hint that tells password managers to leave a field alone.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ignoredByPasswordManagers } from './password-managers';

function assertIgnored(assert: Assert, selector: string) {
  assert.dom(selector).hasAttribute('data-1p-ignore', '');
  assert.dom(selector).hasAttribute('data-lpignore', 'true');
  assert.dom(selector).hasAttribute('data-form-type', 'other');
  assert.dom(selector).hasAttribute('data-bwignore', '');
}

module('Pretui | password-managers', function (hooks) {
  setupCardTest(hooks);

  test('marks the form control it is on', async function (assert) {
    await render(
      <template>
        <input
          aria-label='Card URL'
          data-test-control
          {{ignoredByPasswordManagers}}
        />
      </template>,
    );
    assertIgnored(assert, '[data-test-control]');
  });

  test('marks the form controls inside an element that is not one', async function (assert) {
    await render(
      <template>
        <div data-test-group {{ignoredByPasswordManagers}}>
          <input aria-label='Site name' data-test-control='input' />
          <textarea aria-label='Notes' data-test-control='textarea'></textarea>
        </div>
      </template>,
    );
    assertIgnored(assert, '[data-test-control="input"]');
    assertIgnored(assert, '[data-test-control="textarea"]');
    assert
      .dom('[data-test-group]')
      .doesNotHaveAttribute(
        'data-lpignore',
        'the wrapper itself is no field, so it carries no hint',
      );
  });
});
