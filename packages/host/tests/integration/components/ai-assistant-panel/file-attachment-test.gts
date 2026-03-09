import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  triggerEvent,
} from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type FileUploadService from '@cardstack/host/services/file-upload';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
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

module('Integration | ai-assistant-panel | file-attachment', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;
  let fileUploadService: FileUploadService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
    fileUploadService = getService('file-upload') as FileUploadService;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
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

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
        </template>
      };
    }

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field petName = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.petName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-pet={{@model.petName}}>
            <@fields.petName />
          </h2>
        </template>
      };
    }

    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'pet.gts': { Pet },
          'Person/fadhlan.json': new Person({ firstName: 'Fadhlan' }),
          '.realm.json': `{ "name": "${realmName}" }`,
        },
      });
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
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    return roomId;
  }

  async function attachFileFromRealm(fileName: string) {
    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    await click(`[data-test-file="${fileName}"]`);
    await click('[data-test-choose-file-modal-add-button]');
  }

  test('can send a message with only file attachments and no text', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    await attachFileFromRealm('person.gts');
    await waitFor(
      `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="complete"]`,
    );

    assert
      .dom(`[data-test-attached-file="${testRealmURL}person.gts"]`)
      .exists('file pill is rendered after attaching');

    // canSend should be true with only a file attached (no text needed)
    assert
      .dom('[data-test-send-message-btn]')
      .hasAttribute(
        'data-test-can-send-msg',
        '',
        'canSend should be true when file is attached without text',
      );
    assert
      .dom('[data-test-send-message-btn]')
      .isEnabled('send button should be enabled with only a file attached');
  });

  test('file from realm file chooser appears as attached with upload status', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    await attachFileFromRealm('person.gts');

    assert
      .dom(`[data-test-attached-file="${testRealmURL}person.gts"]`)
      .exists('file pill is rendered');

    // File pill should expose an upload status attribute
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status]`,
      )
      .exists('file pill should have an upload status attribute');
  });

  test('attach menu shows card, workspace file, and local file options', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    await click('[data-test-attach-button]');

    assert
      .dom('[data-test-attach-card-btn]')
      .hasText('Attach a Card', 'shows card option');
    assert
      .dom('[data-test-attach-workspace-file-btn]')
      .hasText('Attach a File (Workspace)', 'shows workspace file option');
    assert
      .dom('[data-test-attach-local-file-btn]')
      .hasText('Attach a File (Your Computer)', 'shows local file option');
  });

  test('local file attach uses synthetic source URL and does not upload to realm', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let roomId = await openAiAssistant();

    let localFileName = 'local-note.md';
    fileUploadService.__queueLocalFileForTesting(
      new File(['hello from local disk'], localFileName, {
        type: 'text/markdown',
      }),
    );

    let realmRecord = getTestRealmRegistry().get(testRealmURL);
    assert.ok(realmRecord, 'test realm is registered');
    assert.false(
      await realmRecord!.adapter.exists(localFileName),
      'local file does not exist in realm before attaching',
    );

    await click('[data-test-attach-button]');
    await click('[data-test-attach-local-file-btn]');

    await waitFor(
      '[data-test-attached-file^="boxel-local://"][data-test-file-upload-status="complete"]',
    );

    assert.false(
      await realmRecord!.adapter.exists(localFileName),
      'local file bytes were not uploaded to workspace realm',
    );

    await fillIn('[data-test-message-field]', 'send local file');
    await click('[data-test-send-message-btn]');

    let messageEvents = mockMatrixUtils
      .getRoomEvents(roomId)
      .filter((e) => e.type === 'm.room.message');
    let messageData = messageEvents[0].content.data
      ? JSON.parse(messageEvents[0].content.data)
      : undefined;
    let attachedFile = messageData?.attachedFiles?.[0];

    assert.ok(attachedFile, 'message includes attached local file');
    assert.true(
      String(attachedFile.sourceUrl).startsWith('boxel-local://'),
      'attached file uses synthetic local source URL',
    );
  });

  test('local image attachment pill renders filename without inline image preview', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    let pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xf8, 0x0f, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb1, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    let localFileName = 'upload-preview.png';
    fileUploadService.__queueLocalFileForTesting(
      new File([pngBytes], localFileName, {
        type: 'image/png',
      }),
    );

    await click('[data-test-attach-button]');
    await click('[data-test-attach-local-file-btn]');

    await waitFor(
      '[data-test-attached-file^="boxel-local://"][data-test-file-upload-status="complete"]',
    );

    assert
      .dom('[data-test-attached-file^="boxel-local://"]')
      .hasText(localFileName, 'local image pill displays the file name');
    assert
      .dom('[data-test-attached-file^="boxel-local://"] .image-atom__img')
      .doesNotExist('local image pill does not render inline image atom');
  });

  test('dropping a local file onto chat input area attaches it', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    let localFileName = 'dragged-note.md';
    let localFile = new File(['dragged content'], localFileName, {
      type: 'text/markdown',
    });

    await triggerEvent('[data-test-chat-input-area]', 'dragover', {
      dataTransfer: {
        types: ['Files'],
        files: [localFile],
      },
    });
    await triggerEvent('[data-test-chat-input-area]', 'drop', {
      dataTransfer: {
        types: ['Files'],
        files: [localFile],
      },
    });

    await waitFor(
      '[data-test-attached-file^="boxel-local://"][data-test-file-upload-status="complete"]',
    );

    assert
      .dom('[data-test-attached-file^="boxel-local://"]')
      .hasText(localFileName, 'dragged local file is attached');
  });

  test('chat input area shows visual drop-zone feedback during file drag', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    let localFile = new File(['dragged content'], 'dragged-note.md', {
      type: 'text/markdown',
    });

    await triggerEvent('[data-test-chat-input-area]', 'dragenter', {
      dataTransfer: {
        types: ['Files'],
        files: [localFile],
      },
    });

    assert
      .dom('[data-test-chat-input-drop-hint]')
      .exists('drop-zone hint is shown while dragging files');

    await triggerEvent('[data-test-chat-input-area]', 'dragleave', {
      dataTransfer: {
        types: ['Files'],
        files: [localFile],
      },
    });

    assert
      .dom('[data-test-chat-input-drop-hint]')
      .doesNotExist('drop-zone hint is hidden when drag leaves');
  });

  test('pasting clipboard file while focused in chat input attaches it', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    let pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xf8, 0x0f, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb1, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    let fileName = 'pasted-image.png';
    let pastedFile = new File([pngBytes], fileName, {
      type: 'image/png',
    });

    await click('[data-test-message-field]');
    await triggerEvent('[data-test-message-field]', 'paste', {
      clipboardData: {
        types: ['Files'],
        files: [pastedFile],
        items: [{ kind: 'file', getAsFile: () => pastedFile }],
      },
    });

    await waitFor(
      '[data-test-attached-file^="boxel-local://"][data-test-file-upload-status="complete"]',
    );

    assert
      .dom('[data-test-attached-file^="boxel-local://"]')
      .hasText(fileName, 'pasted clipboard file is attached');
  });

  test('file pill shows uploading indicator while Matrix upload is in progress', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    let resolveUpload!: () => void;
    let uploadPromise = new Promise<void>((resolve) => {
      resolveUpload = resolve;
    });
    mockMatrixUtils.setUploadContentInterceptor(() => uploadPromise);

    // Don't await the last click — it triggers startFileUpload which blocks
    // settled() via test waiters. Instead, fire-and-forget and waitFor the
    // transient "uploading" state.
    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    await click(`[data-test-file="person.gts"]`);
    click('[data-test-choose-file-modal-add-button]'); // intentionally not awaited

    await waitFor(
      `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="uploading"]`,
    );

    // During the eager upload, the file pill should show uploading status
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="uploading"]`,
      )
      .exists('file pill should show uploading status during upload');

    // Clean up: resolve the blocked upload
    mockMatrixUtils.setUploadContentInterceptor(undefined);
    resolveUpload();
    await settled();
  });

  test('send button is disabled while any file upload is pending', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    let resolveUpload!: () => void;
    let uploadPromise = new Promise<void>((resolve) => {
      resolveUpload = resolve;
    });
    mockMatrixUtils.setUploadContentInterceptor(() => uploadPromise);

    // Don't await the last click — it blocks settled() via test waiters
    await click('[data-test-attach-button]');
    await click('[data-test-attach-file-btn]');
    await click(`[data-test-file="person.gts"]`);
    click('[data-test-choose-file-modal-add-button]'); // intentionally not awaited

    await waitFor(
      `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="uploading"]`,
    );

    // After attaching, the file should show its upload status (eagerly uploading)
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="uploading"]`,
      )
      .exists('file should show uploading status after attach');

    // Use waitUntil to fill in the message field without settled() blocking
    let messageField = document.querySelector(
      '[data-test-message-field]',
    ) as HTMLTextAreaElement;
    messageField.value = 'text present but upload pending';
    messageField.dispatchEvent(new Event('input', { bubbles: true }));

    // Even with text present, send should be blocked while a file is uploading
    await waitUntil(() =>
      document.querySelector('[data-test-send-message-btn]'),
    );
    assert
      .dom('[data-test-send-message-btn]')
      .isDisabled(
        'send button should be disabled while file upload is pending',
      );

    // Clean up: resolve the blocked upload
    mockMatrixUtils.setUploadContentInterceptor(undefined);
    resolveUpload();
    await settled();
  });

  test('send button is disabled when a file upload has failed', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    mockMatrixUtils.setUploadContentInterceptor(async () => {
      throw new Error('Upload failed');
    });

    await attachFileFromRealm('person.gts');
    await waitFor(
      `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="error"]`,
    );

    // After upload failure, file pill should show error status
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="error"]`,
      )
      .exists('file pill should show error upload status');

    await fillIn('[data-test-message-field]', 'text with failed upload');

    assert
      .dom('[data-test-send-message-btn]')
      .isDisabled(
        'send button should be disabled when a file upload has failed',
      );
  });

  test('retry button on failed file upload restarts the upload', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    // First upload fails
    mockMatrixUtils.setUploadContentInterceptor(async () => {
      throw new Error('Upload failed');
    });

    await attachFileFromRealm('person.gts');
    await waitFor(
      `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="error"]`,
    );

    // After failure, retry button should be available on the file pill
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}person.gts"] [data-test-file-retry-btn]`,
      )
      .exists('failed file pill should have a retry button');

    // Set up blocking interceptor for retry so we can observe "uploading" state
    let resolveRetry!: () => void;
    let retryPromise = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    mockMatrixUtils.setUploadContentInterceptor(() => retryPromise);

    // Don't await — retry triggers startFileUpload which blocks settled()
    click(
      `[data-test-attached-file="${testRealmURL}person.gts"] [data-test-file-retry-btn]`,
    );

    await waitFor(
      `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="uploading"]`,
    );

    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="uploading"]`,
      )
      .exists('file should go back to uploading state after retry');

    // Clean up: resolve the blocked retry upload
    mockMatrixUtils.setUploadContentInterceptor(undefined);
    resolveRetry();
    await settled();
  });

  test('removing a file with failed upload unblocks send when text is present', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await openAiAssistant();

    mockMatrixUtils.setUploadContentInterceptor(async () => {
      throw new Error('Upload failed');
    });

    await attachFileFromRealm('person.gts');
    await waitFor(
      `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="error"]`,
    );

    await fillIn('[data-test-message-field]', 'text with failed file');

    // Send should be disabled because of the failed file upload
    assert
      .dom(
        `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="error"]`,
      )
      .exists('file pill shows error status');
    assert
      .dom('[data-test-send-message-btn]')
      .isDisabled('send is disabled due to failed file upload');

    // Remove the failed file
    mockMatrixUtils.setUploadContentInterceptor(undefined);
    await click(
      `[data-test-attached-file="${testRealmURL}person.gts"] [data-test-remove-file-btn]`,
    );

    // With the failed file removed and text present, send should be enabled
    assert
      .dom('[data-test-send-message-btn]')
      .isEnabled('send is enabled after removing the failed file');
    assert
      .dom('[data-test-send-message-btn]')
      .hasAttribute(
        'data-test-can-send-msg',
        '',
        'canSend is true when only text remains',
      );
  });

  test('attachment order is preserved in outgoing message event', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let roomId = await openAiAssistant();

    // Attach person.gts first, then pet.gts second
    await attachFileFromRealm('person.gts');
    await attachFileFromRealm('pet.gts');
    await waitFor(
      `[data-test-attached-file="${testRealmURL}person.gts"][data-test-file-upload-status="complete"]`,
    );
    await waitFor(
      `[data-test-attached-file="${testRealmURL}pet.gts"][data-test-file-upload-status="complete"]`,
    );

    await fillIn('[data-test-message-field]', 'message with ordered files');
    await click('[data-test-send-message-btn]');

    let events = mockMatrixUtils.getRoomEvents(roomId);
    let sentEvent = events.find(
      (e: any) =>
        e.type === 'm.room.message' &&
        e.content?.body === 'message with ordered files',
    );

    assert.ok(sentEvent, 'sent event exists');

    let rawData = (sentEvent as any)?.content?.data;
    let data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    let attachedFiles = data?.attachedFiles;
    assert.ok(attachedFiles, 'event has attachedFiles');
    assert.strictEqual(
      attachedFiles?.length,
      2,
      'two files are attached in the event',
    );
    assert.ok(
      attachedFiles?.[0]?.sourceUrl?.endsWith('person.gts'),
      'first attached file is person.gts (preserving attachment order)',
    );
    assert.ok(
      attachedFiles?.[1]?.sourceUrl?.endsWith('pet.gts'),
      'second attached file is pet.gts (preserving attachment order)',
    );
  });
});
