import { fillIn, click } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import FromElseWhere from 'ember-elsewhere/components/from-elsewhere';
import { module, test } from 'qunit';

import AddWorkspace from '@cardstack/host/components/operator-mode/workspace-chooser/add-workspace';

import { setupSnapshotRealm } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | add-workspace', function (hooks) {
  setupRenderingTest(hooks);
  setupSnapshotRealm(hooks, {
    mockMatrixUtils: undefined as any,
    async build() {
      return {};
    },
  });

  test('it can auto-populate workspace endpoint field', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <AddWorkspace />
          <FromElseWhere @name='modal-elsewhere' />
        </template>
      },
    );

    await click('[data-test-add-workspace]');

    await fillIn('[data-test-display-name-field]', ' déjà vu$$');
    assert.dom('[data-test-endpoint-field]').hasValue('deja-vu');
  });

  test('it stops auto-populating endpoint field after user edits it', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <AddWorkspace />
          <FromElseWhere @name='modal-elsewhere' />
        </template>
      },
    );

    await click('[data-test-add-workspace]');
    await fillIn('[data-test-endpoint-field]', 'endpoint');
    await fillIn('[data-test-display-name-field]', 'different endpoint');
    assert.dom('[data-test-endpoint-field]').hasValue('endpoint');
  });
});
