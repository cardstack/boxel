import { service } from '@ember/service';
import { click, waitUntil, render } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  GetCardsContextName,
  GetCardContextName,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import RoomMessage, {
  STREAMING_TIMEOUT_MINUTES,
} from '@cardstack/host/components/matrix/room-message';

import { parseHtmlContent } from '@cardstack/host/lib/formatted-message/utils';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import type { RoomResource } from '@cardstack/host/resources/room';
import type StoreService from '@cardstack/host/services/store';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class GetCardsContextProvider extends GlimmerComponent<{
  Args: {};
  Blocks: { default: [] };
}> {
  @service declare private store: StoreService;

  @provide(GetCardContextName)
  // @ts-ignore "getCard" is declared but not used
  private get getCard() {
    return getCard;
  }
  @provide(GetCardsContextName)
  // @ts-ignore "getCards" is declared but not used
  private get getCards() {
    return this.store.getSearchResource.bind(this.store);
  }
  @provide(GetCardCollectionContextName)
  // @ts-ignore "getCardCollection" is declared but not used
  private get getCardCollection() {
    return getCardCollection;
  }
}

module('Integration | Component | RoomMessage', function (hooks) {
  setupRenderingTest(hooks);

  const STREAMING_TIMEOUT_MESSAGE = `This message has been processing for a long time (more than ${STREAMING_TIMEOUT_MINUTES} minutes), possibly due to a delay in response time, or due to a system error.`;

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [],
    autostart: true,
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  interface TestScenarioOptions {
    isStreaming: boolean;
    minutesAgoForCreated: number;
    minutesAgoForUpdated: number;
    messageContent: string;
    indexOfLastNonDebugMessage?: number;
    isStreamingFinished?: boolean;
    renderIndex?: number;
    extraMessages?: unknown[];
    retryAction?: (() => void) | null;
  }

  async function setupTestScenario(options: TestScenarioOptions) {
    let {
      isStreaming,
      minutesAgoForCreated,
      minutesAgoForUpdated,
      messageContent,
      indexOfLastNonDebugMessage,
      isStreamingFinished,
      renderIndex,
      extraMessages,
      retryAction,
    } = options;

    let now = Date.now();
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'Test Room',
    });

    let message = {
      author: {
        userId: '@aibot:localhost',
        displayName: 'AI Assistant',
        name: 'AI Assistant',
      },
      body: messageContent,
      created: new Date(now - minutesAgoForCreated * 60 * 1000),
      updated: new Date(now - minutesAgoForUpdated * 60 * 1000),
      roomId,
      eventId: 'event-1',
      instanceId: 'fixture-message',
      attachedResources() {
        return undefined;
      },
      htmlParts: parseHtmlContent(messageContent, '!abcd', '1234'),
      attachedFiles: [],
      attachedCardsAsFiles: [],
      commands: [],
      isStreamingFinished,
    };

    let messages = [message, ...(extraMessages ?? [])];

    let testScenario = {
      roomId,
      message,
      isStreaming,
      messages,
      indexOfLastNonDebugMessage:
        indexOfLastNonDebugMessage ?? messages.length - 1,
      monacoSDK: {},
      maybeRetryAction: retryAction ?? null,
      renderIndex: renderIndex ?? 0,
    } as unknown as RoomResource & {
      renderIndex: number;
      message: typeof message;
      isStreaming: boolean;
      maybeRetryAction: (() => void) | null;
    };

    return testScenario;
  }

  async function renderRoomMessageComponent(testScenario: any) {
    function noop() {}

    await render(
      <template>
        {{! @glint-ignore }}
        <GetCardsContextProvider>
          <RoomMessage
            @roomId={{testScenario.roomId}}
            @roomResource={{testScenario}}
            @monacoSDK={{testScenario.monacoSDK}}
            @isStreaming={{testScenario.isStreaming}}
            @registerScroller={{noop}}
            @index={{testScenario.renderIndex}}
            @retryAction={{testScenario.maybeRetryAction}}
            data-test-message-idx='{{testScenario.renderIndex}}'
          />
        </GetCardsContextProvider>
      </template>,
    );
  }

  test('it shows an error when AI bot message streaming timeouts', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: true,
      minutesAgoForCreated: 5,
      minutesAgoForUpdated: 4,
      messageContent: 'Hello,',
      retryAction: () => {},
    }); // Streaming, created 5 mins ago, updated 4 mins ago
    await renderRoomMessageComponent(testScenario);

    await waitUntil(() =>
      document
        .querySelector('[data-test-alert-message="0"]')
        ?.textContent?.includes(STREAMING_TIMEOUT_MESSAGE),
    );

    assert
      .dom('[data-test-card-error]')
      .includesText(STREAMING_TIMEOUT_MESSAGE);
    assert.dom('[data-test-ai-message-content]').includesText('Hello,');
    assert.dom('[data-test-alert-action-button="Wait longer"]').exists();
    assert.dom('[data-test-alert-action-button="Retry"]').exists();
  });

  test('it does not show an error when last streaming chunk is still within reasonable time limit', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: true,
      minutesAgoForCreated: 2,
      minutesAgoForUpdated: 1,
      messageContent: 'Hello,',
    }); // Streaming, created 2 mins ago, updated 1 minute ago
    await renderRoomMessageComponent(testScenario);

    assert
      .dom('[data-test-message-idx="0"] [data-test-ai-avatar]')
      .hasClass('ai-avatar-animated');
    assert.dom('[data-test-card-error]').doesNotExist();
    assert.dom('[data-test-alert-action-button="Wait longer"]').doesNotExist();
    assert
      .dom('[data-test-ai-message-content] span.streaming-text')
      .includesText('Hello,');
  });

  test('it does not show a timeout error when the message is not the last assistant message', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: true,
      minutesAgoForCreated: 6,
      minutesAgoForUpdated: 5,
      messageContent: 'Earlier response',
      indexOfLastNonDebugMessage: 1,
      extraMessages: [
        {
          author: {
            userId: '@aibot:localhost',
            displayName: 'AI Assistant',
            name: 'AI Assistant',
          },
          body: 'Latest response',
          created: new Date(),
          updated: new Date(),
          roomId: 'unused',
          eventId: 'event-2',
          htmlParts: parseHtmlContent('Latest response', '!abcd', '5678'),
          attachedFiles: [],
          attachedCardsAsFiles: [],
          commands: [],
        },
      ],
    });
    await renderRoomMessageComponent(testScenario);

    await waitUntil(() => {
      return document
        .querySelector('[data-test-message-idx="0"] [data-test-ai-avatar]')
        ?.classList.contains('ai-avatar-animated');
    });
    assert.dom('[data-test-card-error]').doesNotExist();
  });

  test('clicking "wait longer" clears the timeout error', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: true,
      minutesAgoForCreated: 6,
      minutesAgoForUpdated: 6,
      messageContent: 'Stuck response',
      retryAction: () => {},
    });
    await renderRoomMessageComponent(testScenario);

    assert
      .dom('[data-test-card-error]')
      .includesText(STREAMING_TIMEOUT_MESSAGE);

    await click('[data-test-alert-action-button="Wait longer"]');

    assert.dom('[data-test-alert-action-button="Wait longer"]').doesNotExist();
    assert.dom('[data-test-card-error]').doesNotExist();
  });
});
