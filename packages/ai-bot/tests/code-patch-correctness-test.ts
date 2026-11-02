import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { publishCodePatchCorrectnessMessage } from '../lib/code-patch-correctness.ts';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';
import type { PendingCodePatchCorrectnessCheck } from '@cardstack/runtime-common/ai/types';
import {
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
  APP_BOXEL_TOOL_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';
import {
  decodeToolRequest,
  type ToolRequest,
} from '@cardstack/runtime-common/commands';

function requestsOf(content: Record<string, any>): Partial<ToolRequest>[] {
  return (content[APP_BOXEL_TOOL_REQUESTS_KEY] ?? []).map((request: any) =>
    decodeToolRequest(request),
  );
}

function targetsOf(content: Record<string, any>) {
  return requestsOf(content).flatMap(
    (request) => request.arguments?.attributes?.targets ?? [],
  );
}

module('code patch correctness helpers', () => {
  test('publishCodePatchCorrectnessMessage checks every changed file and card in one request', async function () {
    let client = new FakeMatrixClient();
    let summary: PendingCodePatchCorrectnessCheck = {
      targetEventId: 'ai-message',
      roomId: '!room:localhost',
      context: {
        agentId: 'agent-1',
        realmUrl: 'http://localhost:4201/test',
        submode: 'code',
        tools: [{ type: 'function', function: { name: 'big-tool' } }],
        functions: [],
      } as any,
      files: [
        {
          sourceUrl: 'http://localhost/files/notes.md',
          displayName: 'files/notes.md',
        },
        {
          sourceUrl: 'http://localhost/files/src/components/button.gts',
          displayName: 'files/src/components/button.gts',
        },
      ],
      cards: [
        { cardId: 'http://localhost/cards/Profile/1' },
        { cardId: 'http://localhost/cards/Profile/2' },
      ],
      attemptsByTargetKey: {
        'card:http://localhost/cards/Profile/2|event:ai-message': 2,
      },
    };

    await publishCodePatchCorrectnessMessage(summary, client);

    let sentEvents = client.getSentEvents();
    assert.strictEqual(sentEvents.length, 1, 'Should send one message');
    let [event] = sentEvents;
    assert.strictEqual(event.eventType, 'm.room.message');
    let content = event.content;
    assert.strictEqual(
      content.msgtype,
      APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
    );
    assert.deepEqual(
      content['m.relates_to'],
      {
        rel_type: APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
        event_id: summary.targetEventId,
      },
      'Correctness message should reference the patched event',
    );
    assert.strictEqual(content.body, '');
    assert.true(content.isStreamingFinished, 'Message should be finalized');
    assert.deepEqual(
      content.data,
      { context: { agentId: 'agent-1' } },
      'Only the agent id of the context rides along',
    );

    let requests = requestsOf(content);
    assert.strictEqual(requests.length, 1, 'One request covers every target');
    assert.strictEqual(requests[0].name, 'checkCorrectness');
    assert.deepEqual(
      requests[0].arguments,
      {
        description: 'Check 2 cards and 2 files',
        attributes: {
          targets: [
            {
              type: 'file',
              ref: 'http://localhost/files/src/components/button.gts',
            },
            { type: 'file', ref: 'http://localhost/files/notes.md' },
            { type: 'card', ref: 'http://localhost/cards/Profile/1' },
            {
              type: 'card',
              ref: 'http://localhost/cards/Profile/2',
              attempt: 2,
            },
          ],
        },
      },
      'Modules come first, and an attempt is named only past the first',
    );
  });

  test('publishCodePatchCorrectnessMessage splits targets that do not fit one event across several', async function () {
    let client = new FakeMatrixClient();
    let cards = Array.from({ length: 60 }, (_, n) => ({
      cardId: `http://localhost/cards/Product/${n}`,
    }));
    let summary: PendingCodePatchCorrectnessCheck = {
      targetEventId: 'ai-message',
      roomId: '!room:localhost',
      files: [
        {
          sourceUrl: 'http://localhost/files/product.gts',
          displayName: 'files/product.gts',
        },
      ],
      cards,
    };
    let maxContentBytes = 2000;

    await publishCodePatchCorrectnessMessage(summary, client, maxContentBytes);

    let sentEvents = client.getSentEvents();
    assert.true(sentEvents.length > 1, 'Should send several events');
    for (let { content } of sentEvents) {
      assert.true(
        Buffer.byteLength(JSON.stringify(content)) <= maxContentBytes,
        'Each event fits the budget',
      );
      assert.strictEqual(
        content['m.relates_to']?.event_id,
        'ai-message',
        'Each event relates to the reply',
      );
      assert.strictEqual(requestsOf(content).length, 1);
    }
    let allRefs = sentEvents.flatMap(({ content }) =>
      targetsOf(content).map((target: any) => target.ref),
    );
    assert.deepEqual(
      allRefs,
      ['http://localhost/files/product.gts', ...cards.map((c) => c.cardId)],
      'Every target is checked once, the module in the first event',
    );
  });

  test('a target too large for an event of its own keeps the lint issues that fit', async function () {
    let client = new FakeMatrixClient();
    let lintIssues = Array.from(
      { length: 500 },
      (_, n) => `line ${n}: unexpected token`,
    );
    let summary: PendingCodePatchCorrectnessCheck = {
      targetEventId: 'ai-message',
      roomId: '!room:localhost',
      files: [
        {
          sourceUrl: 'http://localhost/files/product.gts',
          displayName: 'files/product.gts',
          lintIssues,
        },
      ],
      cards: [],
    };
    let maxContentBytes = 4000;

    await publishCodePatchCorrectnessMessage(summary, client, maxContentBytes);

    let [event, ...rest] = client.getSentEvents();
    assert.strictEqual(rest.length, 0, 'Should send one event');
    assert.true(
      Buffer.byteLength(JSON.stringify(event.content)) <= maxContentBytes,
      'It fits the budget',
    );
    let [target] = targetsOf(event.content);
    let kept: string[] = target.lintIssues;
    assert.true(kept.length > 1 && kept.length < lintIssues.length);
    assert.strictEqual(
      kept.at(-1),
      `…and ${lintIssues.length - (kept.length - 1)} more lint issues`,
      'The last line counts the issues left out',
    );
  });
});
