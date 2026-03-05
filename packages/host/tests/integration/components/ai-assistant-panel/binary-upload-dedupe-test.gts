import { click, waitFor } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import { fillIn } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { md5 } from 'super-fast-md5';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
} from '../../../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';
import { getTestRealmRegistry } from '../../../helpers/test-realm-registry';

// Minimal 1x1 transparent PNG (67 bytes)
const MINIMAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

// A different 1x1 PNG (RGB, no alpha) — different bytes produce different hash
const DIFFERENT_BINARY = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x62, 0xf8, 0x0f, 0x00, 0x00, 0x01, 0x01, 0x00, 0x05,
  0x18, 0xd8, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

module(
  'Integration | ai-assistant-panel | binary upload dedupe',
  function (hooks) {
    const realmName = 'Operator Mode Workspace';
    let loader: Loader;
    let operatorModeStateService: OperatorModeStateService;

    setupRenderingTest(hooks);
    setupOperatorModeStateCleanup(hooks);
    setupBaseRealm(hooks);

    hooks.beforeEach(function () {
      loader = getService('loader-service').loader;
    });

    setupLocalIndexing(hooks);
    setupOnSave(hooks);
    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
      now: (() => {
        let clock = new Date(2024, 8, 19).getTime();
        return () => (clock += 10);
      })(),
    });

    let { getRoomEvents } = mockMatrixUtils;

    let noop = () => {};

    hooks.beforeEach(async function () {
      operatorModeStateService = getService('operator-mode-state-service');

      class Person extends CardDef {
        static displayName = 'Person';
        @field firstName = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h2 data-test-person={{@model.firstName}}>
              <@fields.firstName />
            </h2>
          </template>
        };
      }

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'Person/fadhlan.json': new Person({ firstName: 'Fadhlan' }),
          'test-image.png': MINIMAL_PNG,
          'test-image-copy.png': MINIMAL_PNG,
          'other-image.png': DIFFERENT_BINARY,
          '.realm.json': `{ "name": "${realmName}" }`,
        },
      });
    });

    function setCardInOperatorModeState(
      cardURL?: string,
      format: 'isolated' | 'edit' = 'isolated',
    ) {
      operatorModeStateService.restore({
        stacks: cardURL ? [[{ id: cardURL, format }]] : [[]],
      });
    }

    async function openAiAssistant(): Promise<string> {
      await waitFor('[data-test-open-ai-assistant]');
      await click('[data-test-open-ai-assistant]');
      await waitFor('[data-test-room-settled]');
      let roomId = document
        .querySelector('[data-test-room]')
        ?.getAttribute('data-test-room');
      if (!roomId) throw new Error('Expected a room ID');
      return roomId;
    }

    async function renderAiAssistantPanel(id?: string) {
      setCardInOperatorModeState(id);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      let roomId = await openAiAssistant();
      return roomId;
    }

    async function attachFile(filename: string) {
      await click('[data-test-attach-button]');
      await click('[data-test-attach-file-btn]');
      await click(`[data-test-file="${filename}"]`);
      await click('[data-test-choose-file-modal-add-button]');
    }

    async function sendMessage(text: string) {
      await fillIn('[data-test-boxel-input-id="ai-chat-input"]', text);
      await click('[data-test-send-message-btn]');
    }

    test('binary file upload preserves content integrity', async function (assert) {
      await renderAiAssistantPanel();

      await attachFile('test-image.png');
      await sendMessage('Upload binary file');

      let uploadedContents = mockMatrixUtils.getUploadedContents();
      let expectedHash = md5(MINIMAL_PNG);
      let uploadedArray = [...uploadedContents.values()]
        .map((content) => new Uint8Array(content))
        .find((content) => md5(content) === expectedHash);

      assert.ok(
        uploadedArray,
        'Found uploaded content matching test-image.png',
      );

      assert.strictEqual(
        uploadedArray!.length,
        MINIMAL_PNG.length,
        'Uploaded content has same length as original PNG',
      );
      assert.deepEqual(
        uploadedArray,
        MINIMAL_PNG,
        'Uploaded bytes match original PNG exactly',
      );
    });

    test('binary content hash is computed from raw bytes', async function (assert) {
      let roomId = await renderAiAssistantPanel();

      await attachFile('test-image.png');
      await sendMessage('Upload binary file for hash check');

      let messageEvents = getRoomEvents(roomId).filter(
        (e) => e.type === 'm.room.message',
      );
      let messageData = messageEvents[0].content.data
        ? JSON.parse(messageEvents[0].content.data)
        : undefined;

      let expectedHash = md5(MINIMAL_PNG);

      assert.ok(messageData?.attachedFiles, 'Message has attached files');
      assert.strictEqual(
        messageData.attachedFiles[0].contentHash,
        expectedHash,
        'Content hash matches md5 of raw PNG bytes',
      );
    });

    test('same binary content from different paths deduplicates to same mxc URL', async function (assert) {
      let roomId = await renderAiAssistantPanel();

      // Send first message with test-image.png
      await attachFile('test-image.png');
      await sendMessage('First binary file');

      // Send second message with test-image-copy.png (same bytes, different path)
      await attachFile('test-image-copy.png');
      await sendMessage('Copy of binary file');

      let messageEvents = getRoomEvents(roomId).filter(
        (e) => e.type === 'm.room.message',
      );
      let firstData = messageEvents[0].content.data
        ? JSON.parse(messageEvents[0].content.data)
        : undefined;
      let secondData = messageEvents[1].content.data
        ? JSON.parse(messageEvents[1].content.data)
        : undefined;

      let expectedHash = md5(MINIMAL_PNG);

      assert.ok(firstData?.attachedFiles, 'First message has attached files');
      assert.ok(secondData?.attachedFiles, 'Second message has attached files');

      assert.strictEqual(
        firstData.attachedFiles[0].url,
        secondData.attachedFiles[0].url,
        'Same binary content deduplicates to same mxc URL',
      );
      assert.notEqual(
        firstData.attachedFiles[0].sourceUrl,
        secondData.attachedFiles[0].sourceUrl,
        'Source URLs are different (different file paths)',
      );
      assert.strictEqual(
        firstData.attachedFiles[0].contentHash,
        expectedHash,
        'First file content hash matches md5 of raw PNG bytes',
      );
      assert.strictEqual(
        secondData.attachedFiles[0].contentHash,
        expectedHash,
        'Second file content hash matches md5 of raw PNG bytes',
      );
    });

    test('file content is captured at attach time, not send time', async function (assert) {
      let roomId = await renderAiAssistantPanel();

      // Attach the file
      await attachFile('test-image.png');

      // Modify the file in the realm before sending
      let registry = getTestRealmRegistry();
      let testRealmRecord = registry.get(testRealmURL);
      if (!testRealmRecord) throw new Error('Test realm not found');
      await testRealmRecord.adapter.write('test-image.png', DIFFERENT_BINARY);
      await settled();

      // Now send — should use original content from attach time
      await sendMessage('File was modified after attach');

      let messageEvents = getRoomEvents(roomId).filter(
        (e) => e.type === 'm.room.message',
      );
      let messageData = messageEvents[0].content.data
        ? JSON.parse(messageEvents[0].content.data)
        : undefined;

      let originalHash = md5(MINIMAL_PNG);
      let modifiedHash = md5(DIFFERENT_BINARY);

      assert.ok(messageData?.attachedFiles, 'Message has attached files');
      assert.strictEqual(
        messageData.attachedFiles[0].contentHash,
        originalHash,
        'Content hash matches original PNG (captured at attach time)',
      );
      assert.notEqual(
        messageData.attachedFiles[0].contentHash,
        modifiedHash,
        'Content hash does not match modified content',
      );
    });
  },
);
