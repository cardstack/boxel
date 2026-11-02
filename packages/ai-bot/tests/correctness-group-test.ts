import QUnit from 'qunit';
const { module, test, assert } = QUnit;
import { EventStatus } from 'matrix-js-sdk';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
  APP_BOXEL_TOOL_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';
import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import type { OpenAIPromptMessage } from '@cardstack/runtime-common/ai/types';
import { getPromptParts } from '@cardstack/runtime-common/ai';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';

const roomId = '!room:localhost';
const aiBotUserId = '@aibot:localhost';
const card = (n: number) => `http://localhost/cards/Product/${n}`;

interface TargetResult {
  targetType: string;
  targetRef: string;
  errors?: string[];
  warnings?: string[];
}

// Builds a room's history the way the ai-bot, the user and the host write it:
// replies that patch cards, the correctness events that check them, and the
// host's results.
class Room {
  events: DiscreteMatrixEvent[] = [];
  private ts = 0;

  private push(event: Record<string, unknown>) {
    this.events.push({
      room_id: roomId,
      origin_server_ts: ++this.ts,
      unsigned: { age: 0, transaction_id: event.event_id },
      status: EventStatus.SENT,
      ...event,
    } as unknown as DiscreteMatrixEvent);
  }

  userMessage(eventId: string, body = 'Raise every price by 10%') {
    this.push({
      type: 'm.room.message',
      event_id: eventId,
      sender: '@user:localhost',
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body,
        format: 'org.matrix.custom.html',
        data: { context: { tools: [], functions: [] } },
      },
    });
  }

  // A bot reply that patched the given cards, each patch applied.
  reply(eventId: string, cardIds: string[]) {
    this.push({
      type: 'm.room.message',
      event_id: eventId,
      sender: aiBotUserId,
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body: 'Updated the prices.',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        data: { context: { agentId: 'agent-1', tools: [], functions: [] } },
        [APP_BOXEL_TOOL_REQUESTS_KEY]: cardIds.map((cardId, index) => ({
          id: `${eventId}-patch-${index}`,
          name: 'patchCardInstance',
          arguments: JSON.stringify({
            description: 'Update the price',
            attributes: { cardId, patch: { attributes: { price: 11 } } },
          }),
        })),
      },
    });
    cardIds.forEach((_, index) =>
      this.push({
        type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
        event_id: `${eventId}-patch-result-${index}`,
        sender: '@user:localhost',
        content: {
          msgtype: APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
          commandRequestId: `${eventId}-patch-${index}`,
          'm.relates_to': {
            event_id: eventId,
            key: 'applied',
            rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
          },
        },
      }),
    );
  }

  // One correctness event of a reply's group, with one batched check.
  check(
    eventId: string,
    replyEventId: string,
    targets: { ref: string; attempt?: number }[],
  ) {
    this.push({
      type: 'm.room.message',
      event_id: eventId,
      sender: aiBotUserId,
      content: {
        msgtype: APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
        body: '',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        'm.relates_to': {
          rel_type: APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
          event_id: replyEventId,
        },
        data: { context: { agentId: 'agent-1' } },
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [
          {
            id: `${eventId}-request`,
            name: 'checkCorrectness',
            arguments: JSON.stringify({
              description: `Check ${targets.length} cards`,
              attributes: {
                targets: targets.map(({ ref, attempt }) => ({
                  type: 'card',
                  ref,
                  ...(attempt ? { attempt } : {}),
                })),
              },
            }),
          },
        ],
      },
    });
  }

  // The older shape: one check per target, each naming its room and reply.
  legacyCheck(
    eventId: string,
    replyEventId: string,
    cardId: string,
    attempt: number,
  ) {
    this.push({
      type: 'm.room.message',
      event_id: eventId,
      sender: aiBotUserId,
      content: {
        msgtype: APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
        body: '',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        'm.relates_to': {
          rel_type: APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
          event_id: replyEventId,
        },
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [
          {
            id: `${eventId}-request`,
            name: 'checkCorrectness',
            arguments: JSON.stringify({
              description: `Check correctness of ${cardId}`,
              attributes: {
                targetType: 'card',
                targetRef: cardId,
                roomId,
                targetEventId: replyEventId,
                correctnessCheckAttempt: attempt,
              },
            }),
          },
        ],
      },
    });
  }

  // A check that failed before it could produce a result card, as a tab
  // that predates batched checks answers one.
  failedResult(checkEventId: string, failureReason: string) {
    this.push({
      type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
      event_id: `${checkEventId}-result`,
      sender: '@user:localhost',
      content: {
        msgtype: APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
        commandRequestId: `${checkEventId}-request`,
        failureReason,
        'm.relates_to': {
          event_id: checkEventId,
          key: 'failed',
          rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        },
      },
    });
  }

  // The host's answer to a correctness event's check.
  result(
    checkEventId: string,
    {
      status = 'applied',
      targetResults = [],
      errors,
      legacy = false,
    }: {
      status?: string;
      targetResults?: TargetResult[];
      errors?: string[];
      legacy?: boolean;
    } = {},
  ) {
    let allErrors =
      errors ?? targetResults.flatMap((result) => result.errors ?? []);
    let attributes: Record<string, unknown> = {
      correct: allErrors.length === 0,
      errors: allErrors,
      warnings: targetResults.flatMap((result) => result.warnings ?? []),
    };
    if (!legacy) {
      attributes.targetResults = targetResults.map((result) => ({
        errors: [],
        warnings: [],
        ...result,
      }));
    }
    this.push({
      type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
      event_id: `${checkEventId}-result`,
      sender: '@user:localhost',
      content: {
        msgtype: APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
        commandRequestId: `${checkEventId}-request`,
        'm.relates_to': {
          event_id: checkEventId,
          key: status,
          rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        },
        data: {
          card: {
            sourceUrl: `http://localhost/correctness/${checkEventId}.json`,
            url: `http://localhost/correctness/${checkEventId}.json`,
            name: `${checkEventId}.json`,
            contentType: 'application/json',
            content: JSON.stringify({ data: { attributes } }),
          },
        },
      },
    });
  }
}

function text(message: OpenAIPromptMessage | undefined): string {
  let content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  return (content ?? [])
    .map((part: any) => (part.type === 'text' ? part.text : ''))
    .join('');
}

async function promptParts(room: Room) {
  return await getPromptParts(room.events, aiBotUserId, new FakeMatrixClient());
}

function attemptOf(
  parts: Awaited<ReturnType<typeof promptParts>>,
  replyEventId: string,
  cardId: string,
) {
  return parts.pendingCodePatchCorrectnessChecks?.attemptsByTargetKey?.[
    `card:${cardId}|event:${replyEventId}`
  ];
}

const FIX = 'Fix the errors above';
const LIMIT = 'Automated correctness fixes have already been attempted';
const AT_LIMIT_NOTE = 'Leave the targets marked as at the attempt limit';
const SUCCESS = 'The write above passed its checks.';
const UNRESOLVED = 'at least one did not come back clean';

module('correctness groups', () => {
  test('the model is prompted only once every event of a group has a result, in any order', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2), card(3)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }, { ref: card(2) }]);
    room.check('check-2', 'reply-1', [{ ref: card(3) }]);

    room.result('check-2');
    let parts = await promptParts(room);
    assert.false(
      parts.shouldRespond,
      'a later event finishing first does not prompt the model',
    );
    assert.strictEqual(
      parts.pendingCodePatchCorrectnessChecks,
      undefined,
      'every target was already asked for, so nothing more is sent',
    );

    room.result('check-1');
    parts = await promptParts(room);
    assert.true(parts.shouldRespond, 'the whole group is in');
  });

  test('a group whose sending stopped partway sends only the targets it is missing', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2), card(3)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }, { ref: card(2) }]);
    room.result('check-1');

    let parts = await promptParts(room);
    assert.deepEqual(
      parts.pendingCodePatchCorrectnessChecks?.cards.map((c) => c.cardId),
      [card(3)],
      'only the card the group has not asked for is pending',
    );
    assert.strictEqual(
      parts.pendingCodePatchCorrectnessChecks?.targetEventId,
      'reply-1',
      'it joins the same group',
    );
  });

  test('an event sent after an earlier one already has its result is waited for', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }]);
    room.result('check-1');
    room.check('check-2', 'reply-1', [{ ref: card(2) }]);

    let parts = await promptParts(room);
    assert.false(parts.shouldRespond, 'the second event has no result yet');
    assert.strictEqual(
      parts.pendingCodePatchCorrectnessChecks,
      undefined,
      'every target was asked for, so nothing more is sent',
    );
  });

  test('a group is complete once anything else is said in the room', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }]);
    room.result('check-1');
    room.userMessage('user-2', 'Thanks, now rename them');

    let parts = await promptParts(room);
    assert.strictEqual(
      parts.pendingCodePatchCorrectnessChecks,
      undefined,
      'nothing is sent for an earlier reply',
    );
    assert.true(parts.shouldRespond, 'the user gets their answer');
  });

  test('a batched result names the failing card, and the group gets one instruction after its last event', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2), card(3)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }, { ref: card(2) }]);
    room.check('check-2', 'reply-1', [{ ref: card(3) }]);
    room.result('check-1', {
      targetResults: [
        {
          targetType: 'card',
          targetRef: card(2),
          errors: [`${card(2)}: price must be a number`],
        },
      ],
    });
    room.result('check-2');

    let parts = await promptParts(room);
    let messages = parts.messages ?? [];
    let toolMessages = messages.filter((m) => m.role === 'tool');
    let firstResult = text(toolMessages.at(-2));
    assert.true(
      firstResult.includes('found errors in 1 of 2 cards; the other 1 passed'),
      `the result counts the passes: ${firstResult}`,
    );
    assert.true(
      firstResult.includes(
        `card "${card(2)}" (automated fix attempts so far: 1 of 3)`,
      ),
      'the failing card is named with its attempt',
    );
    assert.true(
      firstResult.includes('price must be a number'),
      'with its error',
    );

    let fixIndexes = messages
      .map((m, index) =>
        m.role === 'user' && text(m).includes(FIX) ? index : -1,
      )
      .filter((index) => index >= 0);
    assert.strictEqual(
      fixIndexes.length,
      1,
      'one fix instruction for the group',
    );
    let lastToolIndex = messages.lastIndexOf(toolMessages.at(-1)!);
    assert.true(
      fixIndexes[0] > lastToolIndex,
      'it follows the results of the group’s last event',
    );
    assert.false(
      messages.some((m) => text(m).includes(SUCCESS)),
      'the passing event adds no success note next to the fix',
    );
  });

  test('a fix round re-checks only the failing card, with its attempt carried on', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }, { ref: card(2) }]);
    room.result('check-1', {
      targetResults: [
        { targetType: 'card', targetRef: card(2), errors: ['bad price'] },
      ],
    });
    room.reply('fix-1', [card(2)]);

    let parts = await promptParts(room);
    assert.deepEqual(
      parts.pendingCodePatchCorrectnessChecks?.cards.map((c) => c.cardId),
      [card(2)],
      'only the card the fix edited is checked',
    );
    assert.strictEqual(attemptOf(parts, 'fix-1', card(2)), 2);
  });

  test('a card that passed in a batch starts its attempts over', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2)]);
    room.check('check-1', 'reply-1', [
      { ref: card(1), attempt: 2 },
      { ref: card(2), attempt: 2 },
    ]);
    room.result('check-1', {
      targetResults: [
        { targetType: 'card', targetRef: card(2), errors: ['bad price'] },
      ],
    });
    room.reply('fix-1', [card(1), card(2)]);

    let parts = await promptParts(room);
    assert.strictEqual(attemptOf(parts, 'fix-1', card(1)), 1, 'card 1 passed');
    assert.strictEqual(attemptOf(parts, 'fix-1', card(2)), 3, 'card 2 failed');
  });

  test('attempts carry from a single-target check in an older room into a batched one', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1)]);
    room.legacyCheck('check-1', 'reply-1', card(1), 1);
    room.result('check-1', { errors: ['bad price'], legacy: true });
    room.reply('fix-1', [card(1)]);

    let parts = await promptParts(room);
    assert.strictEqual(attemptOf(parts, 'fix-1', card(1)), 2);
  });

  test('a batched check that failed to run counts against every target', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }, { ref: card(2) }]);
    room.result('check-1', { status: 'failed' });
    room.reply('fix-1', [card(1), card(2)]);

    let parts = await promptParts(room);
    assert.strictEqual(attemptOf(parts, 'fix-1', card(1)), 2);
    assert.strictEqual(attemptOf(parts, 'fix-1', card(2)), 2);
  });

  test('a part an older tab could not run leaves its cards unresolved, not passed', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2), card(3)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }, { ref: card(2) }]);
    room.check('check-2', 'reply-1', [{ ref: card(3) }]);
    room.result('check-1');
    room.failedResult(
      'check-2',
      'Target type and reference are required for correctness checks.',
    );

    let parts = await promptParts(room);
    assert.true(parts.shouldRespond, 'the whole group is in');
    let messages = parts.messages ?? [];
    let toolMessages = messages.filter((m) => m.role === 'tool').map(text);
    assert.true(
      toolMessages.some((m) =>
        m.includes('Check correctness was marked as failed for 1 card'),
      ),
      'the model is told the second part did not run',
    );
    assert.false(
      messages.some((m) => text(m).includes(SUCCESS)),
      'the group is not reported as passing',
    );
    assert.false(
      messages.some((m) => text(m).includes(FIX)),
      'there is no error to fix',
    );
    assert.true(
      messages.some((m) => text(m).includes(UNRESOLVED)),
      'the model notes that a check did not come back clean',
    );

    room.reply('fix-1', [card(1), card(3)]);
    parts = await promptParts(room);
    assert.strictEqual(attemptOf(parts, 'fix-1', card(1)), 1, 'card 1 passed');
    assert.strictEqual(
      attemptOf(parts, 'fix-1', card(3)),
      2,
      'the check that did not run counts against card 3',
    );
  });

  test('cards at the attempt limit are marked, and the fix instruction says to leave them', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2)]);
    room.check('check-1', 'reply-1', [
      { ref: card(1), attempt: 3 },
      { ref: card(2), attempt: 2 },
    ]);
    room.result('check-1', {
      targetResults: [
        { targetType: 'card', targetRef: card(1), errors: ['still bad'] },
        { targetType: 'card', targetRef: card(2), errors: ['also bad'] },
      ],
    });

    let messages = (await promptParts(room)).messages ?? [];
    let toolMessage = text(messages.filter((m) => m.role === 'tool').at(-1));
    assert.true(
      toolMessage.includes(
        `card "${card(1)}" (automated fix attempts so far: 3 of 3, at the attempt limit)`,
      ),
      'the card at the limit is marked',
    );
    let fix = messages.find((m) => m.role === 'user' && text(m).includes(FIX));
    assert.true(
      text(fix).includes(AT_LIMIT_NOTE),
      'the fix instruction says to leave it',
    );
    assert.false(
      messages.some((m) => text(m).includes(LIMIT)),
      'no stop instruction while a card has attempts left',
    );
  });

  test('when every failing card is at the limit the model is told to stop', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2)]);
    room.check('check-1', 'reply-1', [
      { ref: card(1), attempt: 3 },
      { ref: card(2) },
    ]);
    room.result('check-1', {
      targetResults: [
        { targetType: 'card', targetRef: card(1), errors: ['still bad'] },
      ],
    });

    let messages = (await promptParts(room)).messages ?? [];
    assert.true(messages.some((m) => text(m).includes(LIMIT)));
    assert.false(
      messages.some((m) => m.role === 'user' && text(m).includes(FIX)),
    );
  });

  test('when every edited card is past the limit nothing is sent, and the bot answers', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1)]);
    room.check('check-1', 'reply-1', [{ ref: card(1), attempt: 3 }]);
    room.result('check-1', {
      targetResults: [
        { targetType: 'card', targetRef: card(1), errors: ['still bad'] },
      ],
    });
    room.reply('fix-1', [card(1)]);

    let parts = await promptParts(room);
    assert.strictEqual(parts.pendingCodePatchCorrectnessChecks, undefined);
    assert.true(parts.shouldRespond);
  });

  test('a batch whose cards all pass gets the success note', async function () {
    let room = new Room();
    room.userMessage('user-1');
    room.reply('reply-1', [card(1), card(2)]);
    room.check('check-1', 'reply-1', [{ ref: card(1) }, { ref: card(2) }]);
    room.result('check-1');

    let messages = (await promptParts(room)).messages ?? [];
    let toolMessage = text(messages.filter((m) => m.role === 'tool').at(-1));
    assert.true(toolMessage.includes('Check correctness passed for 2 cards.'));
    assert.true(messages.some((m) => text(m).includes(SUCCESS)));
  });
});
