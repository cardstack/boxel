import { waitFor, waitUntil } from '@ember/test-helpers';

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

module('Acceptance | code submode | file def live reload', function (hooks) {
  let realm: Realm;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

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
      },
    }));
  });

  test('FileDef preview updates when the file is edited and saved', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}readme.md`,
    });

    await waitFor('[data-test-markdown-isolated]');
    assert
      .dom('[data-test-markdown-isolated]')
      .containsText('Hello', 'initial content is rendered');
    assert
      .dom('[data-test-markdown-isolated]')
      .containsText('Initial content.', 'initial paragraph is rendered');

    // Simulate the user editing and saving the file
    await realm.write('readme.md', `# Updated Title\n\nNew paragraph.`);

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-markdown-isolated]')
          ?.textContent?.includes('Updated Title'),
      { timeout: 5000, timeoutMessage: 'preview did not update after save' },
    );
    assert
      .dom('[data-test-markdown-isolated]')
      .containsText(
        'Updated Title',
        'preview updates to show new title after save',
      );
    assert
      .dom('[data-test-markdown-isolated]')
      .containsText(
        'New paragraph.',
        'preview updates to show new paragraph after save',
      );
  });
});
