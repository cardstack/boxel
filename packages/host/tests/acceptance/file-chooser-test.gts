import { currentURL, click, settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type FileUploadService from '@cardstack/host/services/file-upload';

import { testRealmURL, visitOperatorMode } from '../helpers';

import { setupInteractSubmodeTests } from '../helpers/interact-submode-setup';

module('Acceptance | file chooser tests', function (hooks) {
  setupInteractSubmodeTests(hooks, {
    setRealm() {},
  });

  test('clicking a linked file opens it as a new isolated stack item', async function (assert) {
    let fileId = `${testRealmURL}FileLinkCard/notes.txt`;
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}FileLinkCard/with-file`,
            format: 'isolated',
          },
        ],
      ],
    });

    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}FileLinkCard/with-file"] [data-test-card="${fileId}"]`,
      )
      .exists('linked file is rendered in the card');

    await click(
      `[data-test-stack-card="${testRealmURL}FileLinkCard/with-file"] [data-test-card="${fileId}"]`,
    );

    assert.operatorModeParametersMatch(currentURL(), {
      stacks: [
        [
          {
            id: `${testRealmURL}FileLinkCard/with-file`,
            format: 'isolated',
          },
          {
            id: fileId,
            format: 'isolated',
          },
        ],
      ],
    });
  });

  test('can link a file via the chooser', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}FileLinkCard/empty`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click(`[data-test-operator-mode-stack="0"] [data-test-edit-button]`);

    assert
      .dom('[data-test-links-to-editor="attachment"] [data-test-add-new]')
      .exists('add button is shown for empty FileDef field');

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('file chooser modal is open');

    assert
      .dom('[data-test-file="README.txt"]')
      .exists('file tree loaded README.txt');

    await click('[data-test-file="README.txt"]');
    await click('[data-test-choose-file-modal-add-button]');

    assert
      .dom('[data-test-choose-file-modal]')
      .doesNotExist('file chooser modal is closed');

    assert
      .dom(
        '[data-test-links-to-editor="attachment"] [data-test-card="http://test-realm/test/README.txt"]',
      )
      .exists('attachment field now shows the linked file');
    await click(`[data-test-operator-mode-stack="0"] [data-test-edit-button]`);
    assert
      .dom('[data-test-file-link-attachment]')
      .exists('the linked file is rendered in the card');
  });

  test('file chooser filters by type when field is ImageDef', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}ImageLinkCard/empty`,
            format: 'edit',
          },
        ],
      ],
    });

    assert
      .dom('[data-test-links-to-editor="photo"] [data-test-add-new]')
      .exists('add button rendered for ImageDef field');

    await click(
      '[data-test-links-to-editor="photo"] [data-test-add-new="photo"]',
    );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('file chooser modal is open');

    assert
      .dom('[data-test-choose-file-modal] [data-test-boxel-header-title]')
      .hasText('Choose Image', 'modal title reflects the file type');

    assert
      .dom('[data-test-file="test-image.png"]')
      .exists('image file is shown in the file chooser');

    assert
      .dom('[data-test-file="README.txt"]')
      .doesNotExist('non-image file is not shown in the file chooser');

    await click('[data-test-file="test-image.png"]');
    await click('[data-test-choose-file-modal-add-button]');

    assert
      .dom('[data-test-choose-file-modal]')
      .doesNotExist('file chooser modal is closed');

    assert
      .dom(
        '[data-test-links-to-editor="photo"] [data-test-card="http://test-realm/test/test-image.png"]',
      )
      .exists('photo field now shows the linked image');
  });

  test('file chooser shows all files when field is FileDef', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}FileLinkCard/empty`,
            format: 'edit',
          },
        ],
      ],
    });

    assert
      .dom('[data-test-links-to-editor="attachment"] [data-test-add-new]')
      .exists('add button rendered for FileDef field');

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('file chooser modal is open');

    assert
      .dom('[data-test-choose-file-modal] [data-test-boxel-header-title]')
      .hasText('Choose File', 'modal title shows generic file type');

    assert
      .dom('[data-test-file="README.txt"]')
      .exists('text file is shown in the file chooser');
    assert
      .dom('[data-test-file="test-image.png"]')
      .exists('image file is also shown in the file chooser');

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('can upload a file via the file chooser', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}FileLinkCard/empty`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click(`[data-test-operator-mode-stack="0"] [data-test-edit-button]`);

    assert
      .dom('[data-test-links-to-editor="attachment"] [data-test-add-new]')
      .exists('add button rendered for FileDef field');

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('file chooser modal is open');

    assert
      .dom('[data-test-choose-file-modal-upload-button]')
      .exists('upload button is shown in the file chooser');

    await click('[data-test-choose-file-modal-upload-button]');

    let fileUpload = getService('file-upload') as FileUploadService;
    await waitUntil(() => fileUpload.activeUploads.length > 0, {
      timeout: 2000,
      timeoutMessage: 'upload task was not created',
    });

    let task = fileUpload.activeUploads[0];
    assert.strictEqual(
      task.state,
      'picking',
      'task is in picking state waiting for file',
    );

    task.__provideFileForTesting(
      new File(['hello upload'], 'uploaded.txt', { type: 'text/plain' }),
    );

    await waitUntil(
      () => !document.querySelector('[data-test-choose-file-modal]'),
      {
        timeout: 10000,
        timeoutMessage: 'file chooser modal did not close after upload',
      },
    );

    assert
      .dom(
        '[data-test-links-to-editor="attachment"] [data-test-card="http://test-realm/test/uploaded.txt"]',
      )
      .exists('attachment field now shows the uploaded file');
  });

  test('cancelling file upload does not close the modal', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}FileLinkCard/empty`,
            format: 'isolated',
          },
        ],
      ],
    });

    await click(`[data-test-operator-mode-stack="0"] [data-test-edit-button]`);

    assert
      .dom('[data-test-links-to-editor="attachment"] [data-test-add-new]')
      .exists('add button rendered for FileDef field');

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('file chooser modal is open');

    await click('[data-test-choose-file-modal-upload-button]');

    let fileUpload = getService('file-upload') as FileUploadService;
    await waitUntil(() => fileUpload.activeUploads.length > 0, {
      timeout: 2000,
      timeoutMessage: 'upload task was not created',
    });

    let task = fileUpload.activeUploads[0];

    // Simulate cancelling the native file picker
    task.__provideFileForTesting(null);

    await settled();

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('modal remains open after cancelling file pick');

    await click('[data-test-choose-file-modal-cancel-button]');
  });
});
