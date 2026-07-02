import type { TOC } from '@ember/component/template-only';
import {
  type RenderingTestContext,
  click,
  render,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import MiniFileChooser from '@cardstack/host/components/file-chooser/mini';
import type FileUploadService from '@cardstack/host/services/file-upload';

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

// Sized envelope mirroring the chooser's intended hosting context (a narrow
// side panel, ~360×480). The chooser's layout is fluid (100% of parent), so
// the bordered scroll box only constrains the tree at a realistic size.
const DesignRatioContainer: TOC<{ Blocks: { default: [] } }> = <template>
  <div class='design-ratio-container' data-test-design-ratio-container>
    {{yield}}
  </div>
  <style scoped>
    .design-ratio-container {
      width: 360px;
      height: 480px;
      border: 1px solid var(--boxel-border-color, var(--boxel-300));
      border-radius: var(--boxel-border-radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
  </style>
</template>;

// Round-trips a selection the way a real hosting container does: onSelect feeds
// tracked state back into @selected so the picked row visibly highlights.
class SelectionHarness {
  @tracked selected: string | undefined = undefined;
  onSelect = (url: string) => {
    this.selected = url;
  };
}

// The file tree paints a loading mask over its rows for ~300ms after load.
// Wait it out so clicks land on the rows rather than the mask.
async function waitForFileTreeReady() {
  await waitUntil(() => !document.querySelector('[data-test-file-tree-mask]'), {
    timeout: 5000,
  });
}

module('Integration | mini-file-chooser', function (hooks) {
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
        'pets/mango.json': new Pet({ name: 'Mango' }),
        'pets/vangogh.json': new Pet({ name: 'Van Gogh' }),
        'notes/readme.txt': 'hello world',
      },
    });
    await getService('realm').login(testRealmURL);
  });

  test('mounts in isolation with a workspace dropdown, file tree, and upload button', async function (assert) {
    const harness = new SelectionHarness();

    await render(
      <template>
        <DesignRatioContainer>
          <MiniFileChooser
            @onSelect={{harness.onSelect}}
            @initialRealmURL={{testRealmURL}}
          />
        </DesignRatioContainer>
      </template>,
    );

    await waitFor('[data-test-mini-file-chooser] [data-test-file-tree-nav]');
    await waitForFileTreeReady();

    assert
      .dom('[data-test-mini-file-chooser]')
      .exists('the mini file chooser mounts in isolation');
    assert
      .dom('[data-test-mini-file-chooser-realm-chooser]')
      .exists('the workspace dropdown is rendered');
    assert
      .dom('[data-test-mini-file-chooser-upload-button]')
      .hasText('Upload…', 'the upload button is rendered');

    // Both files and directories from the realm appear in the tree.
    assert
      .dom('[data-test-mini-file-chooser] [data-test-file="pet.gts"]')
      .exists('a root-level file renders in the tree');
    assert
      .dom('[data-test-mini-file-chooser] [data-test-directory="pets/"]')
      .exists('a directory renders in the tree');
  });

  test('selecting a file fires onSelect with its absolute URL', async function (assert) {
    const harness = new SelectionHarness();

    await render(
      <template>
        <DesignRatioContainer>
          <MiniFileChooser
            @onSelect={{harness.onSelect}}
            @selected={{harness.selected}}
            @initialRealmURL={{testRealmURL}}
          />
        </DesignRatioContainer>
      </template>,
    );

    await waitFor('[data-test-mini-file-chooser] [data-test-file="pet.gts"]');
    await waitForFileTreeReady();

    // Click selects the file visually; Enter confirms the selection.
    await click('[data-test-mini-file-chooser] [data-test-file="pet.gts"]');
    await triggerKeyEvent(
      '[data-test-mini-file-chooser] [data-test-file-tree-nav]',
      'keydown',
      'Enter',
    );
    await waitUntil(() => harness.selected === `${testRealmURL}pet.gts`);

    assert.strictEqual(
      harness.selected,
      `${testRealmURL}pet.gts`,
      'onSelect fires with the absolute file URL',
    );
    // The selection round-trips through @selected to highlight the row.
    assert
      .dom('[data-test-mini-file-chooser] [data-test-file="pet.gts"]')
      .hasClass('selected', 'the picked file row is highlighted');
  });

  test('switching workspace re-renders the tree against the new realm', async function (assert) {
    const harness = new SelectionHarness();

    // Open against the base realm first, then switch to the test realm and
    // confirm a test-realm-only file appears.
    await render(
      <template>
        <DesignRatioContainer>
          <MiniFileChooser
            @onSelect={{harness.onSelect}}
            @initialRealmURL={{baseRealm.url}}
          />
        </DesignRatioContainer>
      </template>,
    );

    await waitFor('[data-test-mini-file-chooser] [data-test-file-tree-nav]');
    await waitForFileTreeReady();
    assert
      .dom('[data-test-mini-file-chooser] [data-test-file="pet.gts"]')
      .doesNotExist('test-realm file is absent while base realm is selected');

    await click('[data-test-mini-file-chooser-realm-chooser]');
    await click(`[data-test-boxel-menu-item-text="Test Workspace B"]`);

    await waitFor('[data-test-mini-file-chooser] [data-test-file="pet.gts"]', {
      timeout: 5000,
    });
    assert
      .dom('[data-test-mini-file-chooser] [data-test-file="pet.gts"]')
      .exists('switching to the test realm re-renders the tree with its files');
  });

  test('drag-and-drop announces the upload target and uploads the dropped file', async function (assert) {
    const harness = new SelectionHarness();

    await render(
      <template>
        <DesignRatioContainer>
          <MiniFileChooser
            @onSelect={{harness.onSelect}}
            @initialRealmURL={{testRealmURL}}
          />
        </DesignRatioContainer>
      </template>,
    );

    await waitFor('[data-test-mini-file-chooser] [data-test-file-tree-nav]');
    await waitForFileTreeReady();

    let droppedFile = new File(['dropped contents'], 'dropped.txt', {
      type: 'text/plain',
    });

    await triggerEvent('[data-test-mini-file-chooser]', 'dragenter', {
      dataTransfer: { types: ['Files'], files: [droppedFile] },
    });

    assert
      .dom('[data-test-mini-file-chooser]')
      .hasAttribute('data-drop-zone-active');
    let dropZoneLabel = document
      .querySelector('[data-test-mini-file-chooser]')
      ?.getAttribute('data-drop-zone-label');
    assert.ok(
      dropZoneLabel?.startsWith('Drop file to upload to '),
      'the drop-zone label announces the upload target',
    );

    await triggerEvent('[data-test-mini-file-chooser]', 'drop', {
      dataTransfer: { types: ['Files'], files: [droppedFile] },
    });

    await waitUntil(() => harness.selected === `${testRealmURL}dropped.txt`, {
      timeout: 10000,
      timeoutMessage: 'drop upload did not resolve to onSelect',
    });
    assert.strictEqual(
      harness.selected,
      `${testRealmURL}dropped.txt`,
      'a dropped file uploads and fires onSelect with its URL',
    );
  });

  test('the upload button uploads a chosen file and fires onSelect', async function (assert) {
    const harness = new SelectionHarness();

    await render(
      <template>
        <DesignRatioContainer>
          <MiniFileChooser
            @onSelect={{harness.onSelect}}
            @initialRealmURL={{testRealmURL}}
          />
        </DesignRatioContainer>
      </template>,
    );

    await waitFor('[data-test-mini-file-chooser-upload-button]');
    await waitForFileTreeReady();

    await click('[data-test-mini-file-chooser-upload-button]');

    let fileUpload = getService('file-upload') as FileUploadService;
    await waitUntil(() => fileUpload.activeUploads.length > 0, {
      timeout: 5000,
      timeoutMessage: 'upload task was not created',
    });
    fileUpload.activeUploads[0].__provideFileForTesting(
      new File(['uploaded contents'], 'uploaded.txt', { type: 'text/plain' }),
    );

    await waitUntil(() => harness.selected === `${testRealmURL}uploaded.txt`, {
      timeout: 10000,
      timeoutMessage: 'button upload did not resolve to onSelect',
    });
    assert.strictEqual(
      harness.selected,
      `${testRealmURL}uploaded.txt`,
      'choosing a file via the upload button fires onSelect with its URL',
    );
  });
});
