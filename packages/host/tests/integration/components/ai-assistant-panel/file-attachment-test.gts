import { waitFor, waitUntil, click, fillIn } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

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

module('Integration | ai-assistant-panel | file-attachment', function (hooks) {
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
