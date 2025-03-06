import { waitUntil } from '@ember/test-helpers';

import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import RoomMessage from '@cardstack/host/components/matrix/room-message';

import { type RoomResource } from '@cardstack/host/resources/room';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Component | RoomMessage', function (hooks) {
  setupRenderingTest(hooks);
  let { createAndJoinRoom } = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [],
    autostart: true,
  });

  async function setupTestScenario(
    isStreaming: boolean,
    timeAgoForCreated: number,
    timeAgoForUpdated: number,
    messageContent: string,
  ) {
    let message = {
      author: { userId: '@aibot:localhost' },
      message: messageContent,
      formattedMessage: messageContent,
      created: new Date(new Date().getTime() - timeAgoForCreated * 60 * 1000),
      updated: new Date(new Date().getTime() - timeAgoForUpdated * 60 * 1000),
    };

    let testScenario = {
      roomId: createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'Test Room',
      }),
      message,
      messages: [message],
      isStreaming,
      monacoSDK: {},
      maybeRetryAction: null,
    } as unknown as RoomResource;

    return testScenario;
  }

  async function renderRoomMessageComponent(testScenario: any) {
    function noop() {}

    await render(<template>
      {{! @glint-ignore }}
      <RoomMessage
        @roomId={{testScenario.roomId}}
        @roomResource={{testScenario}}
        @monacoSDK={{testScenario.monacoSDK}}
        @isStreaming={{testScenario.isStreaming}}
        @registerScroller={{noop}}
        @index={{0}}
        @retryAction={{testScenario.maybeRetryAction}}
        data-test-message-idx='1'
      />
    </template>);
  }

  test('it shows an error when AI bot message streaming timeouts', async function (assert) {
    let testScenario = await setupTestScenario(true, 2, 1, 'Hello,'); // Streaming, created 2 mins ago, updated 1 min ago
    await renderRoomMessageComponent(testScenario);

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
    let testScenario = await setupTestScenario(true, 2, 0.5, 'Hello,'); // Streaming, created 2 mins ago, updated 30 seconds ago
    await renderRoomMessageComponent(testScenario);

    assert
      .dom('[data-test-message-idx="1"] [data-test-ai-avatar]')
      .hasClass('ai-avatar-animated');
    assert.dom('[data-test-card-error]').doesNotExist();
    assert
      .dom('[data-test-ai-message-content] span.streaming-text')
      .includesText('Hello,');
  });

  test('it escapes html code that is in code tags', async function (assert) {
    let testScenario = await setupTestScenario(
      true,
      0,
      0,
      `
\`\`\`typescript
<template>
  <h1>Hello, world!</h1>
</template>
\`\`\`
`,
    );
    await renderRoomMessageComponent(testScenario);

    let content = document.querySelector(
      '[data-test-ai-message-content]',
    )?.innerHTML;
    assert.ok(
      content?.includes(`&lt;template&gt;
  &lt;h1&gt;Hello, world!&lt;/h1&gt;
&lt;/template&gt;`),
      'rendered code snippet in a streaming message should contain escaped HTML template so that we see code, not rendered html',
    );
  });
});
