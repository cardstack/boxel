import { waitUntil } from '@ember/test-helpers';

import { render } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import RoomMessage from '@cardstack/host/components/matrix/room-message';

import { setupMatrixServiceMock } from '../../helpers/mock-matrix-service';

module('Integration | Component | RoomMessage', function (hooks) {
  setupRenderingTest(hooks);
  setupMatrixServiceMock(hooks);

  function setupTestScenario(
    isStreaming: boolean,
    timeAgoForCreated: number,
    timeAgoForUpdated: number,
  ) {
    let message = {
      author: { userId: '@aibot:localhost' },
      message: 'Hello,',
      formattedMessage: 'Hello, ',
      created: new Date(new Date().getTime() - timeAgoForCreated * 60 * 1000),
      updated: new Date(new Date().getTime() - timeAgoForUpdated * 60 * 1000),
    };

    let testScenario = {
      message,
      isStreaming,
      monacoSDK: {},
      currentEditor: {},
      setCurrentMonacoContainer: null,
      maybeRetryAction: null,
    };

    return testScenario;
  }

  async function renderRoomMessageComponent(testScenario: any) {
    await render(<template>
      {{! @glint-ignore }}
      <RoomMessage
        @message={{testScenario.message}}
        @monacoSDK={{testScenario.monacoSDK}}
        @isStreaming={{testScenario.isStreaming}}
        @currentEditor={{testScenario.currentEditor}}
        @setCurrentEditor={{testScenario.setCurrentMonacoContainer}}
        @retryAction={{testScenario.maybeRetryAction}}
        data-test-message-idx='1'
      />
    </template>);
  }

  test('it shows an error when AI bot message streaming timeouts', async function (assert) {
    let testScenario = setupTestScenario(true, 2, 1); // Streaming, created 2 mins ago, updated 1 min ago
    await renderRoomMessageComponent(testScenario);

    assert
      .dom('[data-test-message-idx="1"] [data-test-ai-avatar]')
      .doesNotHaveClass('ai-avatar-animated');

    await waitUntil(
      () =>
        !document
          .querySelector('[data-test-message-idx="1"] [data-test-ai-avatar]')
          ?.classList.contains('ai-avatar-animated'),
    );
    assert
      .dom('[data-test-card-error]')
      .includesText(
        'This message was processing for too long. Please try again.',
      );
    assert.dom('[data-test-ai-message-content]').includesText('Hello,');
  });

  test('it does not show an error when last streaming chunk is still within reasonable time limit', async function (assert) {
    let testScenario = setupTestScenario(true, 2, 0.5); // Streaming, created 2 mins ago, updated 30 seconds ago
    await renderRoomMessageComponent(testScenario);

    assert
      .dom('[data-test-message-idx="1"] [data-test-ai-avatar]')
      .hasClass('ai-avatar-animated');
    assert.dom('[data-test-card-error]').doesNotExist();
    assert.dom('[data-test-ai-message-content]').includesText('Hello,');
  });
});
