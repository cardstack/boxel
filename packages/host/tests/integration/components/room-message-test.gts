import { service } from '@ember/service';
import {
  click,
  focus,
  triggerEvent,
  waitUntil,
  render,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  GetCardsContextName,
  GetCardContextName,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import { AI_BOT_EXECUTOR } from '@cardstack/runtime-common/commands';

import { aiBotUserId } from '@cardstack/host/components/ai-assistant/panel';
import RoomMessage, {
  STREAMING_TIMEOUT_MINUTES,
} from '@cardstack/host/components/matrix/room-message';

import { parseHtmlContent } from '@cardstack/host/lib/formatted-message/utils';
import MessageTool from '@cardstack/host/lib/matrix-classes/message-tool';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import type { RoomResource } from '@cardstack/host/resources/room';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type StoreService from '@cardstack/host/services/store';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import { setupRealmServerEndpoints } from '../../helpers';
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

  // Answering a tool call sends the operator-mode summary as the result's
  // context, which lists the catalog realms; this module has no realms.
  setupRealmServerEndpoints(hooks, [
    {
      route: '_catalog-realms',
      getResponse: async () =>
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
    },
  ]);

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
        userId: aiBotUserId,
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

    assert.dom('[data-test-card-error]').doesNotExist();
    assert.dom('[data-test-alert-action-button="Wait longer"]').doesNotExist();
    assert
      .dom('[data-test-ai-message-content] [data-test-ai-bot-markdown]')
      .includesText('Hello,');
    assert
      .dom('[data-test-ai-message-content] [data-test-pretui-markdown-caret]')
      .exists('a streaming answer shows the caret');
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
            userId: aiBotUserId,
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

    assert
      .dom('[data-test-message-idx="0"] [data-test-ai-message-content]')
      .includesText('Earlier response');
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

  test('bot-executed tool calls render compactly while host tool calls render full-size', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: false,
      minutesAgoForCreated: 2,
      minutesAgoForUpdated: 1,
      messageContent: 'Let me read that skill first.',
    });
    let scenario = testScenario as any;
    scenario.getActiveLLMModeForMessage = () => 'ask';
    scenario.isDisplayingCode = () => false;
    scenario.monacoSDK = { editor: { getEditors: () => [] } };
    scenario.message.tools = [
      new MessageTool(
        scenario.message,
        {
          id: 'bot-tool-1',
          name: 'readRealmFile',
          arguments: {
            urls: ['http://test-realm/skills/pirate-speak/SKILL.md'],
            description: 'Read file: pirate-speak/SKILL.md',
          },
          executedBy: AI_BOT_EXECUTOR,
        },
        undefined,
        'event-1',
        false,
        'Apply',
        'applied',
        undefined,
        this.owner,
      ),
      new MessageTool(
        scenario.message,
        {
          id: 'host-tool-1',
          name: 'someHostTool',
          arguments: { description: 'Do a thing' },
        },
        undefined,
        'event-1',
        true,
        'Apply',
        'ready',
        undefined,
        this.owner,
      ),
    ];
    await renderRoomMessageComponent(testScenario);

    assert.dom('[data-test-tool-call-id="bot-tool-1"]').hasClass('compact');
    assert
      .dom(
        '[data-test-tool-call-id="bot-tool-1"] [data-test-tool-call-apply="applied"]',
      )
      .exists();
    assert
      .dom('[data-test-tool-call-id="bot-tool-1"]')
      .containsText(
        'Read the pirate speak skill',
        'a skill read names the skill',
      );

    assert
      .dom('[data-test-tool-call-id="host-tool-1"]')
      .doesNotHaveClass('compact');
    assert
      .dom('[data-test-message-idx="0"]')
      .doesNotHaveClass('bot-tools-only');
  });

  async function setupHeldReadUrlScenario(owner: any) {
    let testScenario = await setupTestScenario({
      isStreaming: false,
      minutesAgoForCreated: 2,
      minutesAgoForUpdated: 1,
      messageContent: 'Let me look at their documentation.',
    });
    let scenario = testScenario as any;
    scenario.getActiveLLMModeForMessage = () => 'act';
    scenario.isDisplayingCode = () => false;
    scenario.monacoSDK = { editor: { getEditors: () => [] } };
    scenario.message.tools = [
      new MessageTool(
        scenario.message,
        {
          id: 'read-url-1',
          name: 'readUrl',
          arguments: {
            url: 'https://docs.example.com/guide?section=setup',
            reason: 'To check the setup steps for the library you asked about.',
            description:
              'Read web page: https://docs.example.com/guide?section=setup',
          },
          executedBy: AI_BOT_EXECUTOR,
          approvalRequired: true,
        },
        undefined,
        'event-1',
        false,
        'Approve',
        'applying',
        undefined,
        owner,
      ),
    ];
    return testScenario;
  }

  function sentReactions(roomId: string) {
    return mockMatrixUtils
      .getRoomEvents(roomId)
      .filter((event: any) => event.type === 'm.reaction') as any[];
  }

  function sentToolResults(roomId: string) {
    return mockMatrixUtils
      .getRoomEvents(roomId)
      .filter(
        (event: any) =>
          event.content?.commandRequestId === 'read-url-1' &&
          event.content?.['m.relates_to']?.key,
      ) as any[];
  }

  test('a readUrl call held for approval shows its full URL with Approve and Decline, even in act mode', async function (assert) {
    let testScenario = await setupHeldReadUrlScenario(this.owner);
    await renderRoomMessageComponent(testScenario);

    let tool = '[data-test-tool-call-id="read-url-1"]';
    assert.dom(tool).doesNotHaveClass('compact', 'shown in full');
    assert
      .dom(tool)
      .containsText(
        'Read web page: https://docs.example.com/guide?section=setup',
        'the full URL, query string included',
      );
    assert
      .dom(`${tool} [data-test-tool-call-apply="ready"]`)
      .exists('approval is never automatic');
    assert
      .dom(
        `${tool} [data-test-tool-call-approval] [data-test-pretui-tool-gate-action="apply"]`,
      )
      .hasText('Approve');
    assert
      .dom(`${tool} [data-test-tool-call-approval]`)
      .containsText(
        'To check the setup steps for the library you asked about.',
        "the assistant's reason is the gate's question",
      );
    assert
      .dom(
        `${tool} [data-test-tool-call-approval] [data-test-pretui-tool-gate-action="decline"]`,
      )
      .hasText('Decline', 'Decline sits beside Approve');
    assert
      .dom('[data-test-message-idx="0"]')
      .doesNotHaveClass('bot-tools-only');
  });

  test('approving a held readUrl call sends an approved result and a 👍 on its message', async function (assert) {
    let testScenario = await setupHeldReadUrlScenario(this.owner);
    await renderRoomMessageComponent(testScenario);

    await click(
      '[data-test-tool-call-id="read-url-1"] [data-test-pretui-tool-gate-action="apply"]',
    );
    await waitUntil(() => sentReactions(testScenario.roomId!).length > 0);

    let [approval] = sentReactions(testScenario.roomId!);
    assert.deepEqual(approval.content['m.relates_to'], {
      rel_type: 'm.annotation',
      event_id: 'event-1',
      key: '👍',
    });
    assert
      .dom(
        '[data-test-tool-call-id="read-url-1"] [data-test-tool-call-apply="ready"]',
      )
      .doesNotExist('an answered call offers no second approval');
    assert.strictEqual(
      sentReactions(testScenario.roomId!).length,
      1,
      'one approval is sent',
    );
    let [result] = sentToolResults(testScenario.roomId!);
    assert.strictEqual(
      result?.content['m.relates_to'].key,
      'approved',
      'the result is the answer ai-bot acts on; the reaction is the one people see',
    );

    let tool = (testScenario as any).message.tools[0] as MessageTool;
    tool.toolCallStatus = 'approved';
    await waitUntil(() =>
      document.querySelector(
        '[data-test-tool-call-id="read-url-1"] [data-test-tool-call-apply="applying"]',
      ),
    );
    assert
      .dom('[data-test-tool-call-id="read-url-1"]')
      .hasClass('compact', 'an approved call shows as a running indicator');
    assert.dom('[data-test-tool-call-approval]').doesNotExist();
  });

  test('an approval that fails to send offers the choice again', async function (assert) {
    let testScenario = await setupHeldReadUrlScenario(this.owner);
    let matrixService = this.owner.lookup('service:matrix-service') as any;
    let originalSend = matrixService.sendToolResultEvent;
    matrixService.sendToolResultEvent = async () => {
      throw new Error('the homeserver is unreachable');
    };
    try {
      await renderRoomMessageComponent(testScenario);
      await click(
        '[data-test-tool-call-id="read-url-1"] [data-test-pretui-tool-gate-action="apply"]',
      );
      await waitUntil(() =>
        document.querySelector(
          '[data-test-tool-call-id="read-url-1"] [data-test-tool-call-apply="ready"]',
        ),
      );
      assert
        .dom(
          '[data-test-tool-call-id="read-url-1"] [data-test-pretui-tool-gate-action="decline"]',
        )
        .exists('Approve and Decline are offered again');
    } finally {
      matrixService.sendToolResultEvent = originalSend;
    }
  });

  test('declining a held readUrl call sends an invalid result and a 👎 on its message', async function (assert) {
    let testScenario = await setupHeldReadUrlScenario(this.owner);
    await renderRoomMessageComponent(testScenario);

    await click(
      '[data-test-tool-call-id="read-url-1"] [data-test-pretui-tool-gate-action="decline"]',
    );
    await waitUntil(() => sentReactions(testScenario.roomId!).length > 0);

    let [decline] = sentReactions(testScenario.roomId!);
    assert.strictEqual(decline.content['m.relates_to'].key, '👎');
    let [result] = sentToolResults(testScenario.roomId!);
    assert.strictEqual(result?.content['m.relates_to'].key, 'invalid');
    assert.ok(
      result?.content.failureReason.includes(
        'The user declined this call (Read web page: https://docs.example.com/guide?section=setup)',
      ),
    );
  });

  test('a streaming compact tool call shows a spinner rather than the full-size "Working…" pill', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: true,
      minutesAgoForCreated: 2,
      minutesAgoForUpdated: 1,
      messageContent: 'Let me read that skill first.',
    });
    let scenario = testScenario as any;
    scenario.getActiveLLMModeForMessage = () => 'ask';
    scenario.isDisplayingCode = () => false;
    scenario.monacoSDK = { editor: { getEditors: () => [] } };
    scenario.message.tools = [
      new MessageTool(
        scenario.message,
        {
          id: 'bot-tool-1',
          name: 'readRealmFile',
          arguments: {
            urls: ['http://test-realm/skills/pirate-speak/SKILL.md'],
            description: 'Read file: pirate-speak/SKILL.md',
          },
          executedBy: AI_BOT_EXECUTOR,
        },
        undefined,
        'event-1',
        false,
        'Apply',
        'ready',
        undefined,
        this.owner,
      ),
    ];
    await renderRoomMessageComponent(testScenario);

    let row =
      '[data-test-tool-call-id="bot-tool-1"] [data-test-pretui-tool-row]';
    assert.dom('[data-test-tool-call-id="bot-tool-1"]').hasClass('compact');
    assert
      .dom(row)
      .hasAttribute('data-state', 'streaming', 'the call is still arriving');
    assert
      .dom(row)
      .doesNotContainText('Working', 'no full-size "Working…" pill');
  });

  test('a run-realm-code call that waits for the click names each risky call and why', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: false,
      minutesAgoForCreated: 2,
      minutesAgoForUpdated: 1,
      messageContent: 'Running a script.',
    });
    let scenario = testScenario as any;
    scenario.getActiveLLMModeForMessage = () => 'ask';
    scenario.isDisplayingCode = () => false;
    scenario.monacoSDK = { editor: { getEditors: () => [] } };
    // The calls are this tab's own, so this tab offers their click.
    scenario.message.agentId = (
      this.owner.lookup('service:matrix-service') as MatrixService
    ).agentId;
    let deleteCode = `await realm.workspaces.delete('http://test-realm/testuser/old/');`;
    let runCall = (
      id: string,
      code: string,
      status: 'ready' | 'applied' | 'invalid' = 'ready',
      failureReason?: string,
    ) =>
      new MessageTool(
        scenario.message,
        {
          id,
          name: 'run-realm-code_abcd',
          arguments: { attributes: { code } },
        },
        undefined,
        'event-1',
        true,
        'Run',
        status,
        undefined,
        this.owner,
        failureReason,
        {
          neverAutoExecutesFor:
            RunRealmCodeTool.neverAutoExecutesFor.bind(RunRealmCodeTool),
          clickReasonsFor: RunRealmCodeTool.clickReasonsFor,
        },
      );
    scenario.message.tools = [
      runCall('one-call', deleteCode),
      runCall(
        'two-calls',
        [
          `await realm.images.generate({ prompt: 'a cat' });`,
          `await realm.fs.download('https://example.com/a.png', 'a.png');`,
        ].join('\n'),
      ),
      runCall('no-calls', `await realm.fs.writeText('a.json', '{}');`),
      runCall('applied-call', deleteCode, 'applied'),
      runCall('invalid-call', deleteCode, 'invalid', 'Unexpected argument'),
    ];
    await renderRoomMessageComponent(testScenario);

    let reasons = (id: string) =>
      `[data-test-tool-call-id="${id}"] [data-test-tool-call-click-reason]`;
    assert.dom(reasons('one-call')).exists({ count: 1 });
    assert
      .dom(
        `[data-test-tool-call-id="one-call"] [data-test-tool-call-click-reason="realm.workspaces.delete"]`,
      )
      .containsText('Deletes a workspace');

    assert.dom(reasons('two-calls')).exists({ count: 2 });
    assert
      .dom(
        `[data-test-tool-call-id="two-calls"] [data-test-tool-call-click-reason="realm.images.generate"]`,
      )
      .containsText('uses your credit');
    assert
      .dom(
        `[data-test-tool-call-id="two-calls"] [data-test-tool-call-click-reason="realm.fs.download"]`,
      )
      .containsText('outside URL');

    assert.dom(reasons('no-calls')).doesNotExist();

    assert
      .dom(reasons('applied-call'))
      .doesNotExist('a call that already ran offers no click');
    assert
      .dom(
        `[data-test-tool-call-id="invalid-call"] [data-test-tool-call-click-reason="realm.workspaces.delete"]`,
      )
      .exists('a call that offers Try Anyway still says what the click allows');
  });

  test('a message carrying only bot-executed tool calls is marked bot-tools-only', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: false,
      minutesAgoForCreated: 2,
      minutesAgoForUpdated: 1,
      messageContent: '',
    });
    let scenario = testScenario as any;
    scenario.getActiveLLMModeForMessage = () => 'ask';
    scenario.isDisplayingCode = () => false;
    scenario.monacoSDK = { editor: { getEditors: () => [] } };
    scenario.message.htmlParts = [];
    scenario.message.tools = [
      new MessageTool(
        scenario.message,
        {
          id: 'bot-tool-1',
          name: 'readRealmFile',
          arguments: {
            urls: ['http://test-realm/skills/pirate-speak/SKILL.md'],
            description: 'Read file: pirate-speak/SKILL.md',
          },
          executedBy: AI_BOT_EXECUTOR,
        },
        undefined,
        'event-1',
        false,
        'Apply',
        'applied',
        undefined,
        this.owner,
      ),
    ];
    await renderRoomMessageComponent(testScenario);

    assert.dom('[data-test-message-idx="0"]').hasClass('bot-tools-only');
  });

  // An assistant's message takes its header from the room's turn head; a
  // person's bubble carries its own name and time, so these read the
  // reader's messages.
  const testUser = {
    userId: '@testuser:localhost',
    displayName: 'Test User',
    name: 'Test User',
  };

  function followUpMessage(minutesAgoForCreated: number) {
    let now = Date.now();
    return {
      author: testUser,
      body: 'And one more thing…',
      created: new Date(now - minutesAgoForCreated * 60 * 1000),
      updated: new Date(now - minutesAgoForCreated * 60 * 1000),
      roomId: 'unused',
      eventId: 'event-2',
      htmlParts: parseHtmlContent('And one more thing…', '!abcd', '5678'),
      attachedFiles: [],
      attachedCardsAsFiles: [],
      commands: [],
      isStreamingFinished: true,
    };
  }

  let header =
    '[data-test-message-idx="1"] [data-test-pretui-user-bubble-author]';

  test('it hides the name and time when the previous message has the same author less than 2 minutes earlier', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: false,
      minutesAgoForCreated: 5,
      minutesAgoForUpdated: 5,
      messageContent: 'A user question',
      renderIndex: 1,
      extraMessages: [followUpMessage(4)],
    });
    (testScenario as any).message.author = testUser;
    await renderRoomMessageComponent(testScenario);

    assert.dom(header).doesNotExist();
  });

  test('it shows the name and time when the previous message is from a different author', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: false,
      minutesAgoForCreated: 5,
      minutesAgoForUpdated: 5,
      messageContent: 'An answer',
      renderIndex: 1,
      extraMessages: [followUpMessage(4)],
    });
    await renderRoomMessageComponent(testScenario);

    assert.dom(header).exists();
  });

  test('it shows the name and time when the previous message from the same author is more than 2 minutes older', async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: false,
      minutesAgoForCreated: 5,
      minutesAgoForUpdated: 5,
      messageContent: 'A user question',
      renderIndex: 1,
      extraMessages: [followUpMessage(2)],
    });
    (testScenario as any).message.author = testUser;
    await renderRoomMessageComponent(testScenario);

    assert.dom(header).exists();
  });

  test("hovering or focusing a person's message time shows its full date", async function (assert) {
    let testScenario = await setupTestScenario({
      isStreaming: false,
      minutesAgoForCreated: 5,
      minutesAgoForUpdated: 5,
      messageContent: 'A user question',
      renderIndex: 1,
      extraMessages: [followUpMessage(2)],
    });
    (testScenario as any).message.author = testUser;
    await renderRoomMessageComponent(testScenario);

    // the message at index 1 is the follow-up; its time is what shows
    let created = (testScenario as any).messages[1].created as Date;
    let time = `${header} [data-test-pretui-speaker-time]`;
    let tip = `${header} [role="tooltip"]`;
    let fullDate = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(created);

    let shortTime = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(created);

    assert.dom(time).hasText(shortTime);
    assert.dom(time).hasAttribute('datetime', created.toISOString());
    assert.dom(tip).hasText(fullDate);
    assert
      .dom(tip)
      .doesNotHaveAttribute(
        'data-open',
        'the full date is hidden until asked for',
      );
    let tipId = document.querySelector(tip)!.id;
    assert
      .dom(time)
      .hasAttribute('aria-describedby', tipId, 'the time is described by it');

    await triggerEvent(`${header} [data-test-pretui-tooltip]`, 'mouseenter');
    assert
      .dom(tip)
      .hasAttribute(
        'data-open',
        'true',
        'hovering the time shows the full date',
      );
    await triggerEvent(`${header} [data-test-pretui-tooltip]`, 'mouseleave');
    assert.dom(tip).doesNotHaveAttribute('data-open');

    await focus(time);
    assert
      .dom(tip)
      .hasAttribute('data-open', 'true', 'keyboard focus shows the full date');
  });
});
