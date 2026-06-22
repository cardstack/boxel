import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import {
  type RenderingTestContext,
  click,
  render,
  triggerEvent,
  waitFor,
} from '@ember/test-helpers';

import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import FileChooser, {
  type FileChooserRealm,
} from '@cardstack/host/components/file-chooser/panel';

import {
  realmConfigCardJSON,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  StringField,
  contains,
  field,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// Captures the panel's yielded callbacks so tests can assert the provider
// notifies its host on realm switches and upload completion.
class PanelHarness {
  @tracked lastRealmChange: FileChooserRealm | undefined;
  onRealmChange = (realm: FileChooserRealm) => {
    this.lastRealmChange = realm;
  };
  onUploadComplete = () => {};
}

module('Integration | file-chooser/panel', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Test Workspace B' }),
        'pet.gts': { Pet },
      },
    });
    await getService('realm').login(testRealmURL);
  });

  test('opens on the initial realm and yields its selection state', async function (assert) {
    const harness = new PanelHarness();

    await render(
      <template>
        <FileChooser
          @initialRealmURL={{testRealmURL}}
          @onRealmChange={{harness.onRealmChange}}
          @onUploadComplete={{harness.onUploadComplete}}
          as |chooser|
        >
          <div data-test-panel>
            <chooser.RealmDropdown data-test-panel-realm-chooser />
            <span data-test-panel-realm-name>
              {{chooser.selectedRealm.info.name}}
            </span>
            <span data-test-panel-tree-key>{{chooser.fileTreeKey}}</span>
          </div>
        </FileChooser>
      </template>,
    );

    await waitFor('[data-test-panel-realm-chooser]');
    assert
      .dom('[data-test-panel-realm-name]')
      .hasText(
        'Test Workspace B',
        'the panel opens on the realm named by @initialRealmURL',
      );
    assert
      .dom('[data-test-panel-tree-key]')
      .hasText(
        `0:${testRealmURL}`,
        'the recreation key pins the initial realm at nonce 0',
      );
  });

  test('switching workspace notifies the host and bumps the recreation key', async function (assert) {
    const harness = new PanelHarness();

    await render(
      <template>
        <FileChooser
          @initialRealmURL={{baseRealm.url}}
          @onRealmChange={{harness.onRealmChange}}
          @onUploadComplete={{harness.onUploadComplete}}
          as |chooser|
        >
          <div data-test-panel>
            <chooser.RealmDropdown data-test-panel-realm-chooser />
            <span data-test-panel-realm-name>
              {{chooser.selectedRealm.info.name}}
            </span>
            <span data-test-panel-tree-key>{{chooser.fileTreeKey}}</span>
          </div>
        </FileChooser>
      </template>,
    );

    await waitFor('[data-test-panel-realm-chooser]');
    assert.strictEqual(
      harness.lastRealmChange,
      undefined,
      'no realm-change fires for the initial selection',
    );
    let initialKey = document
      .querySelector('[data-test-panel-tree-key]')
      ?.textContent?.trim();

    await click('[data-test-panel-realm-chooser]');
    await click('[data-test-boxel-menu-item-text="Test Workspace B"]');

    assert
      .dom('[data-test-panel-realm-name]')
      .hasText(
        'Test Workspace B',
        'the panel switches to the chosen workspace',
      );
    assert.strictEqual(
      harness.lastRealmChange?.url.href,
      testRealmURL,
      'onRealmChange fires with the newly selected realm so the host can clear stale picks',
    );
    assert
      .dom('[data-test-panel-tree-key]')
      .hasText(
        `1:${testRealmURL}`,
        'the recreation key advances so the file tree is rebuilt against the new realm',
      );
    assert.notStrictEqual(
      document.querySelector('[data-test-panel-tree-key]')?.textContent?.trim(),
      initialKey,
      'the recreation key changes on switch',
    );
  });

  test('a file drag toggles the drop-zone overlay state and announces the target', async function (assert) {
    const harness = new PanelHarness();

    await render(
      <template>
        <FileChooser
          @initialRealmURL={{testRealmURL}}
          @onRealmChange={{harness.onRealmChange}}
          @onUploadComplete={{harness.onUploadComplete}}
          as |chooser|
        >
          <div
            data-test-panel
            data-drop-zone-active={{chooser.dropZoneActive}}
            data-drop-zone-label={{chooser.dropZoneLabel}}
            {{on 'dragenter' chooser.onDragEnter}}
            {{on 'dragleave' chooser.onDragLeave}}
          >
            {{! contents irrelevant — exercising the panel's DnD state machine }}
            {{#each (array chooser.fileTreeKey)}}{{/each}}
          </div>
        </FileChooser>
      </template>,
    );

    await waitFor('[data-test-panel]');
    assert
      .dom('[data-test-panel]')
      .doesNotHaveAttribute(
        'data-drop-zone-active',
        'the overlay is inactive before any drag',
      );

    await triggerEvent('[data-test-panel]', 'dragenter', {
      dataTransfer: { types: ['Files'], files: [] },
    });
    assert
      .dom('[data-test-panel]')
      .hasAttribute(
        'data-drop-zone-active',
        '',
        'dragging a file in activates the overlay',
      );
    let label = document
      .querySelector('[data-test-panel]')
      ?.getAttribute('data-drop-zone-label');
    assert.ok(
      label?.startsWith('Drop file to upload to '),
      'the overlay label announces the upload target realm',
    );

    await triggerEvent('[data-test-panel]', 'dragleave', {
      dataTransfer: { types: ['Files'], files: [] },
    });
    assert
      .dom('[data-test-panel]')
      .doesNotHaveAttribute(
        'data-drop-zone-active',
        'leaving the last drag deactivates the overlay',
      );
  });

  test('a non-file drag is ignored by the drop-zone', async function (assert) {
    const harness = new PanelHarness();

    await render(
      <template>
        <FileChooser
          @initialRealmURL={{testRealmURL}}
          @onRealmChange={{harness.onRealmChange}}
          @onUploadComplete={{harness.onUploadComplete}}
          as |chooser|
        >
          <div
            data-test-panel
            data-drop-zone-active={{chooser.dropZoneActive}}
            {{on 'dragenter' chooser.onDragEnter}}
          >
            {{#each (array chooser.fileTreeKey)}}{{/each}}
          </div>
        </FileChooser>
      </template>,
    );

    await waitFor('[data-test-panel]');
    await triggerEvent('[data-test-panel]', 'dragenter', {
      dataTransfer: { types: ['text/plain'], files: [] },
    });
    assert
      .dom('[data-test-panel]')
      .doesNotHaveAttribute(
        'data-drop-zone-active',
        'dragging non-file content (e.g. selected text) never arms the overlay',
      );
  });
});
