import { waitFor, waitUntil, click, triggerEvent } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import { BOTTOM_THRESHOLD } from '@cardstack/host/components/ai-assistant/message';
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
import {
  CardDef,
  Component,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | scrolling', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);

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
    now: (() => {
      // deterministic clock so that, for example, screenshots
      // have consistent content
      let clock = new Date(2024, 8, 19).getTime();
      return () => (clock += 10);
    })(),
  });

  let { createAndJoinRoom, simulateRemoteMessage, setReadReceipt } =
    mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName[0];
        },
      });
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
        </template>
      };
    }

    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'Person/fadhlan.json': new Person({
            firstName: 'Fadhlan',
          }),
          'realm.json': realmConfigCardJSON({ name: realmName }),
        },
      });
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

  async function renderAiAssistantPanel(id?: string) {
    setCardInOperatorModeState(id);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  async function scrollAiAssistantToBottom() {
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;
    conversationElement.scrollTop =
      conversationElement.scrollHeight - conversationElement.clientHeight;
    await triggerEvent('[data-test-ai-assistant-conversation]', 'scroll');
    await new Promise((r) => setTimeout(r, 500)); // wait for the 500ms throttle on the scroll event handler
  }

  async function scrollAiAssistantToTop() {
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;
    conversationElement.scrollTop = 0;
    await triggerEvent('[data-test-ai-assistant-conversation]', 'scroll');
    await new Promise((r) => setTimeout(r, 500)); // wait for the 500ms throttle on the scroll event handler
  }

  function isAiAssistantScrolledToBottom() {
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;

    return (
      Math.abs(
        conversationElement.scrollHeight -
          conversationElement.clientHeight -
          conversationElement.scrollTop,
        // we'll use a threshold for considering the ai assistant scrolled
        // all the way to the bottom
      ) < BOTTOM_THRESHOLD
    );
  }
  function isAiAssistantScrolledToTop() {
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;

    return conversationElement.scrollTop < 20;
  }

  // A scroll position that ends up in the wrong place is only diagnosable from
  // how it got there. The conversation's viewport height, its content height,
  // and its scroll offset each move independently, and which of them moved last
  // is what separates a scroll that never ran from one that ran and was then
  // invalidated by a later layout change. So record every distinct geometry the
  // conversation passes through and report the sequence on failure.
  //
  // This samples per frame rather than off `scroll` and `resize` events because
  // the sequence worth seeing starts before the panel opens — the interesting
  // failure is one where the conversation is already scrolled by the time it
  // first renders — and because it has to capture layout as painted, which is
  // what the rule below otherwise guards against.
  const MAX_GEOMETRY_SAMPLES = 40;
  let scrollGeometryLog: string[] = [];
  let stopSamplingScrollGeometry: (() => void) | undefined;

  hooks.beforeEach(function () {
    scrollGeometryLog = [];
    let startedAt = performance.now();
    let previousGeometry: string | undefined;
    let sampling = true;
    let sample = () => {
      if (!sampling) {
        return;
      }
      let conversationElement = document.querySelector(
        '[data-test-ai-assistant-conversation]',
      );
      if (conversationElement) {
        let { scrollHeight, clientHeight } = conversationElement;
        let scrollTop = Math.round(conversationElement.scrollTop);
        let geometry = `scrollHeight=${scrollHeight} clientHeight=${clientHeight} scrollTop=${scrollTop}`;
        if (
          geometry !== previousGeometry &&
          scrollGeometryLog.length < MAX_GEOMETRY_SAMPLES
        ) {
          previousGeometry = geometry;
          scrollGeometryLog.push(
            `+${Math.round(
              performance.now() - startedAt,
            )}ms ${geometry} distanceFromBottom=${
              scrollHeight - clientHeight - scrollTop
            }`,
          );
        }
      }
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
      requestAnimationFrame(sample);
    };
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state
    requestAnimationFrame(sample);
    stopSamplingScrollGeometry = () => (sampling = false);
  });

  hooks.afterEach(function () {
    stopSamplingScrollGeometry?.();
    stopSamplingScrollGeometry = undefined;
  });

  function describeScrollPosition() {
    let history = scrollGeometryLog.length
      ? `\n  conversation geometry through this test:\n    ${scrollGeometryLog.join(
          '\n    ',
        )}`
      : '';
    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    );
    if (!conversationElement) {
      return `no [data-test-ai-assistant-conversation] element${history}`;
    }
    let { scrollHeight, clientHeight, scrollTop } = conversationElement;
    // Signed: positive means content still sits below the fold (not scrolled
    // far enough down), negative means scrolled past the bottom. The
    // scrolled-to-bottom check compares the absolute value against the
    // threshold, so the sign is diagnostic-only.
    let distanceFromBottom = scrollHeight - clientHeight - scrollTop;
    return `scrollHeight=${scrollHeight} clientHeight=${clientHeight} scrollTop=${scrollTop} distanceFromBottom=${distanceFromBottom} bottomThreshold=${BOTTOM_THRESHOLD}${history}`;
  }

  // The panel scrolls to the newest message when the last message registers its
  // scroller, re-scrolls when that message's subtree mutates, and re-pins when
  // the conversation's viewport resizes under it. Any of those can land after
  // the test runloop has otherwise settled, so poll until the conversation
  // reaches the target position rather than reading it once. On timeout, report
  // the geometry and the sequence it moved through.
  async function assertScrolledToBottom(
    assert: Assert,
    message = 'AI assistant is scrolled to bottom',
  ) {
    try {
      await waitUntil(() => isAiAssistantScrolledToBottom(), { timeout: 2000 });
      assert.ok(true, message);
    } catch (e) {
      let reason = e instanceof Error ? e.message : String(e);
      assert.ok(false, `${message} — ${describeScrollPosition()} (${reason})`);
    }
  }

  async function assertScrolledToTop(
    assert: Assert,
    message = 'AI assistant is scrolled to top',
  ) {
    try {
      await waitUntil(() => isAiAssistantScrolledToTop(), { timeout: 2000 });
      assert.ok(true, message);
    } catch (e) {
      let reason = e instanceof Error ? e.message : String(e);
      assert.ok(false, `${message} — ${describeScrollPosition()} (${reason})`);
    }
  }

  function fillRoomWithReadMessages(
    roomId: string,
    messagesHaveBeenRead = true,
  ) {
    for (let i = 0; i < 20; i++) {
      simulateRemoteMessage(roomId, '@testuser:localhost', {
        body: `question #${i + 1}`,
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      });
      let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
        body: `answer #${i + 1}`,
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      });
      if (messagesHaveBeenRead) {
        setReadReceipt(roomId, eventId, '@testuser:localhost');
      }
    }
  }

  test('it shows unread message indicator when new message received and not scrolled to bottom', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    fillRoomWithReadMessages(roomId);

    await waitFor('[data-test-message-idx="39"]');
    await scrollAiAssistantToTop();
    assert
      .dom('[data-test-unread-messages-button]')
      .doesNotExist(
        'unread messages button does not exist when all messages have been read',
      );

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'This is an unread message',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="40"]');

    assert
      .dom('[data-test-unread-messages-button]')
      .exists('unread messages button exists when there are unread messages');
    assert
      .dom('[data-test-unread-messages-button]')
      .containsText('1 New Message');
  });

  test('clicking on unread message indicator scrolls to unread message', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    fillRoomWithReadMessages(roomId);

    await waitFor('[data-test-message-idx="39"]');
    await scrollAiAssistantToTop();
    assert
      .dom('[data-test-unread-messages-button]')
      .doesNotExist(
        'unread messages button does not exist when all messages have been read',
      );

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'This is an unread message',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="40"]');
    await click('[data-test-unread-messages-button]');
    // poll until the animated scroll completes and settles at the bottom
    await assertScrolledToBottom(assert);
  });

  test('it does not show unread message indicator when new message received and scrolled to bottom', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    fillRoomWithReadMessages(roomId);
    await scrollAiAssistantToBottom();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'This is an unread message',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="40"]');
    assert
      .dom('[data-test-unread-messages-button]')
      .doesNotExist(
        'unread messages button does not exist when scrolled to the bottom',
      );
  });

  // The conversation is the `1fr` row of the room's grid, so a taller footer
  // shrinks its viewport without touching `scrollHeight` or `scrollTop` —
  // widening the gap to the bottom by however much height the viewport lost.
  // Shrinking the room reproduces that without depending on which footer
  // control happens to render late.
  function shrinkConversationViewport(byPixels: number) {
    let roomElement = document.querySelector(
      '[data-test-room]',
    ) as HTMLElement | null;
    if (!roomElement) {
      throw new Error('Expected a room element');
    }
    roomElement.style.height = `${roomElement.clientHeight - byPixels}px`;
  }

  test('it stays at the bottom when the conversation viewport shrinks', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    fillRoomWithReadMessages(roomId);
    await waitFor('[data-test-message-idx="39"]');
    await scrollAiAssistantToBottom();

    shrinkConversationViewport(BOTTOM_THRESHOLD + 10);

    await assertScrolledToBottom(
      assert,
      'AI assistant stays at the bottom after the conversation viewport shrinks',
    );
  });

  test('it pins to the bottom when a viewport shrink makes a short conversation scrollable', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'question #1',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'answer #1',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    await waitFor('[data-test-message-idx="1"]');

    let conversationElement = document.querySelector(
      '[data-test-ai-assistant-conversation]',
    )!;
    // A conversation whose messages all fit reports `scrollHeight` clamped to
    // the padding box, so its distance from the bottom reads as zero rather
    // than as the unused height — which is what makes the re-pin treat a fully
    // visible conversation as pinned.
    assert.strictEqual(
      conversationElement.scrollHeight,
      conversationElement.clientHeight,
      'the conversation fits its viewport before the shrink',
    );

    shrinkConversationViewport(conversationElement.clientHeight - 80);

    await assertScrolledToBottom(
      assert,
      'AI assistant pins to the bottom when a viewport shrink makes the conversation scrollable',
    );
  });

  test('it holds its scroll position when the conversation viewport shrinks away from the bottom', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    fillRoomWithReadMessages(roomId);
    await waitFor('[data-test-message-idx="39"]');
    await scrollAiAssistantToTop();

    shrinkConversationViewport(BOTTOM_THRESHOLD + 10);

    await assertScrolledToTop(
      assert,
      'AI assistant holds its scroll position when the viewport shrinks and the conversation is not at the bottom',
    );
  });

  test('it scrolls to first unread message when opening a room with unread messages', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'test room 1',
    });
    fillRoomWithReadMessages(roomId, false);
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-message-idx="39"]');
    await assertScrolledToTop(
      assert,
      'AI assistant is scrolled to top (where the first unread message is)',
    );
  });

  test('it scrolls to last message when opening a room with no unread messages', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'test room 1',
    });
    fillRoomWithReadMessages(roomId);
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-message-idx="39"]');
    await assertScrolledToBottom(assert);
  });

  test('scrolling stays at the bottom if a message is streaming in', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-person="Fadhlan"]');
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'test room 1',
    });
    fillRoomWithReadMessages(roomId);
    await settled();
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-message-idx="39"]');
    await assertScrolledToBottom(assert);

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `thinking...`,
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: false,
    });
    assert.ok(
      isAiAssistantScrolledToBottom(),
      'AI assistant is scrolled to bottom',
    );
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: `Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`,
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      ['m.relates_to']: {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    assert.ok(
      isAiAssistantScrolledToBottom(),
      'AI assistant is scrolled to bottom',
    );
  });
});
