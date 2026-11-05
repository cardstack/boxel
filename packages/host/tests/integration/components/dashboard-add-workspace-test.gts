import { fillIn, click, find } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import FromElseWhere from 'ember-elsewhere/components/from-elsewhere';
import { module, test } from 'qunit';

import AddWorkspace from '@cardstack/host/components/operator-mode/dashboard/add-workspace';
import { cleanseString } from '@cardstack/host/lib/utils';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | dashboard | add-workspace', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(async function () {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <AddWorkspace />
          <FromElseWhere @name='modal-elsewhere' />
        </template>
      },
    );
    await click('[data-test-add-workspace]');
  });

  test('the endpoint follows the display name, cleansed', async function (assert) {
    await fillIn('[data-test-display-name-field]', ' déjà vu$$');
    assert.dom('[data-test-endpoint-field]').hasValue('deja-vu');
  });

  test('the modal opens with a display name and the endpoint made from it', async function (assert) {
    let displayName = (
      find('[data-test-display-name-field]') as HTMLInputElement
    )?.value;
    let endpoint = (find('[data-test-endpoint-field]') as HTMLInputElement)
      ?.value;

    assert.ok(displayName?.length, 'the display name is filled in');
    assert.ok(displayName?.includes(' '), 'the display name uses spaces');
    assert.notEqual(
      displayName,
      endpoint,
      'the display name and endpoint differ',
    );
    assert
      .dom('[data-test-endpoint-field]')
      .hasValue(cleanseString(displayName ?? ''));
  });

  test('an endpoint the user edited no longer follows the display name', async function (assert) {
    await fillIn('[data-test-endpoint-field]', 'endpoint');
    await fillIn('[data-test-display-name-field]', 'different endpoint');
    assert.dom('[data-test-endpoint-field]').hasValue('endpoint');
  });
});
