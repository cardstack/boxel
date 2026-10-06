import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { Realm } from '@cardstack/runtime-common';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';
import { setupTestRealmServiceWorker } from '../../helpers/test-realm-service-worker';

const htmlPage = (heading: string) =>
  `<!doctype html><html><head><title>Page</title></head><body><h1>${heading}</h1></body></html>`;

function htmlFrameSource() {
  return (
    document.querySelector('[data-test-html-frame]')?.getAttribute('srcdoc') ??
    ''
  );
}

module('Acceptance | code submode | file def live reload', function (hooks) {
  let realm: Realm;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupTestRealmServiceWorker(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'readme.md': `# Hello\n\nInitial content.`,
        'page.html': htmlPage('Initial heading'),
      },
    }));
  });

  test('FileDef preview updates when the file is edited and saved', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}readme.md`,
    });

    await waitFor('[data-test-markdown-preview]');
    assert
      .dom('[data-test-markdown-preview]')
      .containsText('Hello', 'initial content is rendered');
    assert
      .dom('[data-test-markdown-preview]')
      .containsText('Initial content.', 'initial paragraph is rendered');

    // Simulate the user editing and saving the file
    await realm.write('readme.md', `# Updated Title\n\nNew paragraph.`);

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-markdown-preview]')
          ?.textContent?.includes('Updated Title'),
      { timeout: 5000, timeoutMessage: 'preview did not update after save' },
    );
    assert
      .dom('[data-test-markdown-preview]')
      .containsText(
        'Updated Title',
        'preview updates to show new title after save',
      );
    assert
      .dom('[data-test-markdown-preview]')
      .containsText(
        'New paragraph.',
        'preview updates to show new paragraph after save',
      );
  });

  test('markdown preview updates when the file is written while it is open in interact mode', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${testRealmURL}readme.md`, format: 'isolated', type: 'file' }],
      ],
    });

    await waitFor('[data-test-markdown-preview]');
    assert
      .dom('[data-test-markdown-preview]')
      .containsText('Initial content.', 'initial content is rendered');

    await realm.write('readme.md', `# Updated Title\n\nNew paragraph.`);

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-markdown-preview]')
          ?.textContent?.includes('New paragraph.'),
      { timeout: 5000, timeoutMessage: 'preview did not update after write' },
    );
    assert
      .dom('[data-test-markdown-preview]')
      .containsText('Updated Title', 'preview shows the new title');
  });

  test('HTML preview updates when the file is written in code submode', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}page.html`,
    });

    await waitUntil(() => htmlFrameSource().includes('Initial heading'), {
      timeout: 5000,
      timeoutMessage: 'initial HTML did not reach the frame',
    });

    await realm.write('page.html', htmlPage('Rewritten heading'));

    await waitUntil(() => htmlFrameSource().includes('Rewritten heading'), {
      timeout: 5000,
      timeoutMessage: 'HTML preview did not update after the write',
    });
    assert.notOk(
      htmlFrameSource().includes('Initial heading'),
      'the frame shows only the rewritten document',
    );
  });

  test('HTML preview updates when the file is written while it is open in interact mode', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${testRealmURL}page.html`, format: 'isolated', type: 'file' }],
      ],
    });

    await waitUntil(() => htmlFrameSource().includes('Initial heading'), {
      timeout: 5000,
      timeoutMessage: 'initial HTML did not reach the frame',
    });

    await realm.write('page.html', htmlPage('Rewritten heading'));

    await waitUntil(() => htmlFrameSource().includes('Rewritten heading'), {
      timeout: 5000,
      timeoutMessage: 'HTML preview did not update after the write',
    });
    assert.ok(
      htmlFrameSource().includes('Rewritten heading'),
      'the frame shows the rewritten document',
    );
  });

  test('HTML source view updates when the file is written', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${testRealmURL}page.html`, format: 'isolated', type: 'file' }],
      ],
    });

    await waitUntil(() => htmlFrameSource().includes('Initial heading'), {
      timeout: 5000,
      timeoutMessage: 'initial HTML did not reach the frame',
    });
    await click('[data-test-html-view-source]');
    assert.dom('[data-test-html-source]').containsText('Initial heading');

    await realm.write('page.html', htmlPage('Rewritten heading'));

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-html-source]')
          ?.textContent?.includes('Rewritten heading'),
      {
        timeout: 5000,
        timeoutMessage: 'HTML source view did not update after the write',
      },
    );
    assert
      .dom('[data-test-html-source]')
      .containsText(
        'Rewritten heading',
        'the source view shows the new markup',
      );
  });
});
