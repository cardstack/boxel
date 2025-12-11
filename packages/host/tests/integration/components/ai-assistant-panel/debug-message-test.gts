import { waitFor, waitUntil, click } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import { Loader } from '@cardstack/runtime-common/loader';

import {
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { SerializedFile } from 'https://cardstack.com/base/file-api';
import type { CardMessageContent } from 'https://cardstack.com/base/matrix-event';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
  setupSnapshotRealm,
} from '../../../helpers';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | debug-message', function (hooks) {
  const realmName = 'Debug Message Test Realm';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
    now: (() => {
      let clock = new Date(2024, 8, 20).getTime();
      return () => (clock += 10);
    })(),
  });

  let { simulateRemoteMessage } = mockMatrixUtils;

  let snapshot = setupSnapshotRealm<{ loader: Loader }>(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      return { loader };
    },
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await snapshot.get().loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function () {
    ({ loader } = snapshot.get());
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
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
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    return roomId;
  }

  async function renderAiAssistantPanel() {
    setCardInOperatorModeState();
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        noop = () => {};
        <template>
          <OperatorMode @onClose={{this.noop}} />
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('it displays debug messages with downloadable file attachments', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    const mockFileUrl = 'mxc://localhost/debug-log.txt';
    const mockFile: SerializedFile & { content: string } = {
      name: 'debug-log.txt',
      sourceUrl: 'https://not-relevant',
      url: mockFileUrl,
      contentType: 'text/plain',
      content: 'This is the content of the debug log.',
    };

    const messageContentForRemoteMessage: CardMessageContent = {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      body: 'This is a debug message with an attachment.',
      data: {
        attachedFiles: [mockFile],
      },
    };

    let matrixService = this.owner.lookup(
      'service:matrix-service',
    ) as MatrixService;
    let downloadAsFileInBrowserCalled = false;

    // Stub the new MatrixService method that handles the download
    matrixService.downloadAsFileInBrowser = async (file: SerializedFile) => {
      assert.deepEqual(
        file.url,
        mockFileUrl,
        'matrixService.downloadAsFileInBrowser called with correct file url',
      );
      assert.strictEqual(
        file.name,
        mockFile.name,
        'matrixService.downloadAsFileInBrowser called with correct file name',
      );
      downloadAsFileInBrowserCalled = true;
      // No actual download will occur because this method is stubbed.
      return Promise.resolve();
    };

    await simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      messageContentForRemoteMessage,
      {
        type: APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
      },
    );

    await waitFor(
      `[data-test-room="${roomId}"] [data-test-message-idx="0"] [data-test-ai-message-content]`,
    );

    assert
      .dom(
        `[data-test-room="${roomId}"] [data-test-message-idx="0"] [data-test-ai-message-content]`,
      )
      .containsText(
        'This is a debug message with an attachment.',
        'Debug message body is rendered.',
      );

    const filePillSelector = `[data-test-room="${roomId}"] [data-test-message-idx="0"] [data-test-attached-file="${mockFile.sourceUrl}"]`;
    await waitFor(filePillSelector);
    assert
      .dom(filePillSelector)
      .exists('File pill for the attached file is rendered.');

    const downloadButtonSelector = `${filePillSelector} [data-test-download-file-btn]`;
    assert
      .dom(downloadButtonSelector)
      .exists('Download button is present on the file pill.');

    await click(downloadButtonSelector);

    await waitUntil(() => downloadAsFileInBrowserCalled, {
      timeout: 2000,
      timeoutMessage: 'matrixService.downloadAsFileInBrowser was not called',
    });
    assert.ok(
      downloadAsFileInBrowserCalled,
      'matrixService.downloadAsFileInBrowser should have been called.',
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
  });
});
