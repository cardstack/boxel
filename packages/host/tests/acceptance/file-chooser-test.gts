import {
  currentURL,
  click,
  focus,
  settled,
  triggerEvent,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

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
            type: 'file',
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

  test('can drag and drop a file into chooser modal and see workspace feedback', async function (assert) {
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
    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('file chooser modal is open');

    let droppedFile = new File(['hello drag upload'], 'dropped.txt', {
      type: 'text/plain',
    });

    await triggerEvent('[data-test-choose-file-modal]', 'dragenter', {
      dataTransfer: {
        types: ['Files'],
        files: [droppedFile],
      },
    });

    assert
      .dom('[data-test-choose-file-modal]')
      .hasAttribute('data-drop-zone-active');
    let dropZoneLabel = document
      .querySelector('[data-test-choose-file-modal]')
      ?.getAttribute('data-drop-zone-label');
    assert.ok(dropZoneLabel, 'drop zone label is exposed on modal');
    assert.true(
      dropZoneLabel!.startsWith('Drop file to upload to '),
      'drop zone label announces upload target',
    );

    await triggerEvent('[data-test-choose-file-modal]', 'drop', {
      dataTransfer: {
        types: ['Files'],
        files: [droppedFile],
      },
    });

    await waitUntil(
      () => !document.querySelector('[data-test-choose-file-modal]'),
      {
        timeout: 10000,
        timeoutMessage: 'file chooser modal did not close after drop upload',
      },
    );

    assert
      .dom(
        '[data-test-links-to-editor="attachment"] [data-test-card="http://test-realm/test/dropped.txt"]',
      )
      .exists('attachment field now shows the dropped file');
  });

  test('uploading a file without an extension shows an error', async function (assert) {
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
    task.__provideFileForTesting(
      new File(['no extension'], 'Makefile', {
        type: 'application/octet-stream',
      }),
    );

    await waitUntil(
      () =>
        document.querySelector('[data-test-choose-file-modal-upload-error]') !==
        null,
      {
        timeout: 10000,
        timeoutMessage: 'upload error was not displayed',
      },
    );

    assert
      .dom('[data-test-choose-file-modal-upload-error]')
      .includesText(
        'has no extension',
        'error message mentions missing extension',
      );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('modal remains open after upload error');

    await click('[data-test-choose-file-modal-cancel-button]');
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

module('Acceptance | file chooser keyboard tests', function (hooks) {
  setupInteractSubmodeTests(hooks, {
    setRealm() {},
  });

  test('file list area is focused when the modal opens', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('file chooser modal is open');

    assert.strictEqual(
      document.activeElement,
      document.querySelector('[data-test-file-tree-nav]'),
      'file tree nav has focus on modal open',
    );

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('individual file buttons are not in the tab order', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-file="README.txt"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    assert
      .dom('[data-test-file="README.txt"]')
      .hasAttribute('tabindex', '-1', 'file buttons have tabindex=-1');

    assert
      .dom('[data-test-directory="FileLinkCard/"]')
      .hasAttribute('tabindex', '-1', 'directory buttons have tabindex=-1');

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('typing in the file list moves the cursor to the first matching file', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-file="README.txt"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    await focus('[data-test-file-tree-nav]');
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'r');

    assert
      .dom('[data-test-file="README.txt"]')
      .hasClass('cursor', 'README.txt gets the cursor');

    assert
      .dom('[data-test-file="test-image.png"]')
      .doesNotHaveClass('cursor', 'test-image.png does not get the cursor');

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('type-ahead cursor updates as more characters are typed', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-file="test-image.png"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    await focus('[data-test-file-tree-nav]');

    // Type 't' — should move cursor to test-image.png (starts with 't')
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 't');

    assert
      .dom('[data-test-file="test-image.png"]')
      .hasClass('cursor', 'test-image.png gets the cursor for "t"');

    assert
      .dom('[data-test-file="README.txt"]')
      .doesNotHaveClass('cursor', 'README.txt does not get the cursor for "t"');

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('typing moves the cursor to a matching directory', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-directory="FileLinkCard/"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    await focus('[data-test-file-tree-nav]');

    // Type 'f' — should move cursor to 'FileLinkCard' directory (case-insensitive)
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'f');

    assert
      .dom('[data-test-directory="FileLinkCard/"]')
      .hasClass('cursor', 'FileLinkCard directory gets the cursor');

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('ArrowDown moves the cursor through the file list', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-file="README.txt"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    await focus('[data-test-file-tree-nav]');

    // First ArrowDown: cursor moves to first item
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'ArrowDown');
    assert
      .dom('[data-test-file-tree-nav] button.cursor')
      .exists('some item has the cursor after first ArrowDown');

    // Second ArrowDown: cursor moves to next item
    let firstItem = document.querySelector(
      '[data-test-file-tree-nav] button.cursor',
    );
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'ArrowDown');
    assert.notStrictEqual(
      document.querySelector('[data-test-file-tree-nav] button.cursor'),
      firstItem,
      'cursor moved to a different item on second ArrowDown',
    );

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('ArrowUp from the first item keeps the cursor on the first item', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-file="README.txt"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    await focus('[data-test-file-tree-nav]');

    // Move to first item, then try to go up
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'ArrowDown');
    let firstItem = document.querySelector(
      '[data-test-file-tree-nav] button.cursor',
    );
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'ArrowUp');

    assert.strictEqual(
      document.querySelector('[data-test-file-tree-nav] button.cursor'),
      firstItem,
      'cursor stays on first item when ArrowUp from first item',
    );

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('ArrowRight expands a directory and moves the cursor into it', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-directory="FileLinkCard/"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    await focus('[data-test-file-tree-nav]');

    // Move cursor to FileLinkCard directory via type-ahead
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'f');
    assert
      .dom('[data-test-directory="FileLinkCard/"]')
      .hasClass('cursor', 'cursor is on FileLinkCard/');

    // ArrowRight should expand the directory and move cursor to first child
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'ArrowRight');

    assert
      .dom('[data-test-file="FileLinkCard/empty.json"]')
      .exists('FileLinkCard/ is expanded and shows children');

    assert
      .dom('[data-test-directory="FileLinkCard/"]')
      .doesNotHaveClass('cursor', 'cursor moved into the directory');

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('ArrowLeft collapses an open directory', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-directory="FileLinkCard/"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    // Expand the directory by clicking
    await click('[data-test-directory="FileLinkCard/"]');
    assert
      .dom('[data-test-file="FileLinkCard/empty.json"]')
      .exists('directory is expanded');

    await focus('[data-test-file-tree-nav]');

    // Move cursor to FileLinkCard directory
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'f');
    assert
      .dom('[data-test-directory="FileLinkCard/"]')
      .hasClass('cursor', 'cursor is on FileLinkCard/');

    // ArrowLeft should collapse the directory
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'ArrowLeft');

    assert
      .dom('[data-test-file="FileLinkCard/empty.json"]')
      .doesNotExist('FileLinkCard/ is collapsed');

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('Enter on a file confirms the selection and closes the modal', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-file="README.txt"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    await focus('[data-test-file-tree-nav]');

    // Move cursor to README.txt via type-ahead
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'r');
    assert
      .dom('[data-test-file="README.txt"]')
      .hasClass('cursor', 'cursor is on README.txt');

    // Enter should confirm the selection and close the modal
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'Enter');

    await waitUntil(
      () => !document.querySelector('[data-test-choose-file-modal]'),
      {
        timeout: 5000,
        timeoutMessage: 'modal did not close after Enter',
      },
    );

    assert
      .dom(
        '[data-test-links-to-editor="attachment"] [data-test-card="http://test-realm/test/README.txt"]',
      )
      .exists('README.txt was confirmed as the attachment');
  });

  test('Enter on a directory expands/collapses it without closing the modal', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    await waitFor('[data-test-directory="FileLinkCard/"]', {
      timeout: 5000,
      timeoutMessage: 'file tree did not load',
    });

    await focus('[data-test-file-tree-nav]');

    // Move cursor to FileLinkCard directory
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'f');

    // Enter should expand the directory
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'Enter');

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('modal is still open after Enter on directory');

    assert
      .dom('[data-test-file="FileLinkCard/empty.json"]')
      .exists('FileLinkCard/ is now expanded');

    // Enter again should collapse it
    await triggerKeyEvent('[data-test-file-tree-nav]', 'keydown', 'Enter');

    assert
      .dom('[data-test-file="FileLinkCard/empty.json"]')
      .doesNotExist('FileLinkCard/ is collapsed again');

    await click('[data-test-choose-file-modal-cancel-button]');
  });

  test('realm chooser is keyboard focusable', async function (assert) {
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

    await click(
      '[data-test-links-to-editor="attachment"] [data-test-add-new="attachment"]',
    );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('file chooser modal is open');

    // The Power Select trigger inside the realm chooser should be focusable
    let trigger = document.querySelector<HTMLElement>(
      '[data-test-choose-file-modal-realm-chooser] .ember-power-select-trigger',
    );

    assert.ok(trigger, 'realm chooser trigger element exists');
    const triggerIsFocusable =
      trigger?.getAttribute('tabindex') !== null ||
      trigger?.getAttribute('role') === 'button' ||
      trigger?.tagName.toLowerCase() === 'button';

    assert.ok(
      triggerIsFocusable,
      'realm chooser trigger is keyboard focusable',
    );

    await click('[data-test-choose-file-modal-cancel-button]');
  });
});

module('Acceptance | file chooser tests | upload size limit', function (hooks) {
  let FILE_SIZE_LIMIT = 512;

  setupInteractSubmodeTests(hooks, {
    setRealm() {},
    fileSizeLimitBytes: FILE_SIZE_LIMIT,
  });

  test('shows error when uploaded file exceeds size limit', async function (assert) {
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
    let oversizedContent = new Uint8Array(FILE_SIZE_LIMIT + 100).fill(0xff);
    task.__provideFileForTesting(
      new File([oversizedContent], 'too-big.bin', {
        type: 'application/octet-stream',
      }),
    );

    await waitUntil(
      () =>
        document.querySelector('[data-test-choose-file-modal-upload-error]') !==
        null,
      {
        timeout: 10000,
        timeoutMessage: 'upload error was not displayed',
      },
    );

    assert
      .dom('[data-test-choose-file-modal-upload-error]')
      .exists('error message is displayed');

    assert
      .dom('[data-test-choose-file-modal-upload-error]')
      .includesText(
        'exceeds maximum allowed size',
        'error message mentions the size limit',
      );

    assert
      .dom('[data-test-choose-file-modal]')
      .exists('modal remains open after upload error');

    assert
      .dom('[data-test-choose-file-modal-upload-button]')
      .hasText('Retry\u2026', 'retry button is shown');

    await click('[data-test-choose-file-modal-cancel-button]');
  });
});
