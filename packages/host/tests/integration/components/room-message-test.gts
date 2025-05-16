import { waitUntil, render } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  GetCardsContextName,
  GetCardContextName,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import RoomMessage from '@cardstack/host/components/matrix/room-message';

import { parseHtmlContent } from '@cardstack/host/lib/formatted-message/utils';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import { type RoomResource } from '@cardstack/host/resources/room';
import { getSearch } from '@cardstack/host/resources/search';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class GetCardsContextProvider extends GlimmerComponent<{
  Args: {};
  Blocks: { default: [] };
}> {
  @provide(GetCardContextName)
  // @ts-ignore "getCard" is declared but not used
  private get getCard() {
    return getCard;
  }
  @provide(GetCardsContextName)
  // @ts-ignore "getCards" is declared but not used
  private get getCards() {
    return getSearch;
  }
  @provide(GetCardCollectionContextName)
  // @ts-ignore "getCardCollection" is declared but not used
  private get getCardCollection() {
    return getCardCollection;
  }
}

module('Integration | Component | RoomMessage', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [],
    autostart: true,
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  async function setupTestScenario(
    isStreaming: boolean,
    timeAgoForCreated: number,
    timeAgoForUpdated: number,
    messageContent: string,
  ) {
    let message = {
      author: { userId: '@aibot:localhost' },
      body: messageContent,
      created: new Date(new Date().getTime() - timeAgoForCreated * 60 * 1000),
      updated: new Date(new Date().getTime() - timeAgoForUpdated * 60 * 1000),
      attachedResources() {
        return undefined;
      },
      htmlParts: parseHtmlContent(messageContent, '!abcd', '1234'),
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
      <GetCardsContextProvider>
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
      </GetCardsContextProvider>
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
});
