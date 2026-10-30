import { waitFor, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';
import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

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
  realmConfigCardJSON,
} from '../../../helpers';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | answer footer', function (hooks) {
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let { simulateRemoteMessage } = mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'realm.json': realmConfigCardJSON({ name: 'Test Workspace' }),
        },
      });
    });
  });

  async function renderAiAssistantPanel() {
    operatorModeStateService.restore({ stacks: [[]] });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
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

  test('Copy puts the answer on the clipboard as markdown', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let answer = [
      '## Next steps',
      '',
      '- Add a **title** field',
      '- See [the docs](https://docs.example.com/cards)',
      '',
      '```ts',
      'let greeting = "hello";',
      '```',
    ].join('\n');

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'What should I do next?',
      msgtype: 'm.text',
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: answer,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor(
      '[data-test-message-idx="1"] [data-test-answer-footer] [data-test-pretui-answer-copy]',
    );
    // the answer renders as HTML, so its text is not what Copy takes
    assert
      .dom('[data-test-message-idx="1"] h2')
      .hasText('Next steps', 'the heading renders as HTML');

    let originalWriteText = navigator.clipboard.writeText;
    let clipboardText: string | undefined;
    navigator.clipboard.writeText = async (text: string) => {
      clipboardText = text;
    };
    try {
      await click(
        '[data-test-message-idx="1"] [data-test-answer-footer] [data-test-pretui-answer-copy]',
      );
    } finally {
      navigator.clipboard.writeText = originalWriteText;
    }
    assert.strictEqual(
      clipboardText,
      answer,
      'the clipboard gets the markdown source: heading, list, link and code block',
    );
  });
});
