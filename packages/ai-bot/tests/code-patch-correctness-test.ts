import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { publishCodePatchCorrectnessMessage } from '../lib/code-patch-correctness.ts';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';
import { restoreExternalFields } from '@cardstack/runtime-common/ai/external-fields';
import type { PendingCodePatchCorrectnessCheck } from '@cardstack/runtime-common/ai/types';
import {
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
  APP_BOXEL_EXTERNAL_FIELDS_KEY,
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

// Keeps what it uploads, under mxc:// URLs a homeserver would hand out.
class MediaClient extends FakeMatrixClient {
  uploads = new Map<string, string>();
  async uploadContent(content: string): Promise<{ content_uri: string }> {
    let uri = `mxc://localhost/media-${this.uploads.size}`;
    this.uploads.set(uri, content);
    return { content_uri: uri };
  }
  mxcUrlToHttp(mxcUrl: string): string {
    return `https://example.com/_matrix/client/v1/media/download/${mxcUrl.slice('mxc://'.length)}`;
  }
}

function bulkSummary(count: number): PendingCodePatchCorrectnessCheck {
  return {
    targetEventId: 'ai-message',
    roomId: '!room:localhost',
    files: [],
    cards: Array.from({ length: count }, (_, n) => ({
      cardId: `http://localhost/cards/Product/${n}`,
    })),
  };
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

  test('an event over the budget carries its check request in Matrix media', async function () {
    let client = new MediaClient();
    let summary = bulkSummary(300);
    let maxContentBytes = 4000;

    await publishCodePatchCorrectnessMessage(summary, client, maxContentBytes);

    let [event, ...rest] = client.getSentEvents();
    assert.strictEqual(rest.length, 0, 'One event');
    assert.true(
      Buffer.byteLength(JSON.stringify(event.content)) <= maxContentBytes,
      'It fits the budget',
    );
    assert.strictEqual(
      event.content[APP_BOXEL_TOOL_REQUESTS_KEY],
      undefined,
      'The request is not inline',
    );
    let external = event.content[APP_BOXEL_EXTERNAL_FIELDS_KEY];
    assert.deepEqual(Object.keys(external), [APP_BOXEL_TOOL_REQUESTS_KEY]);

    let restored = { ...event.content };
    let errors = await restoreExternalFields(
      restored,
      async (url) => client.uploads.get(url)!,
    );
    assert.deepEqual(errors, []);
    assert.strictEqual(restored[APP_BOXEL_EXTERNAL_FIELDS_KEY], undefined);
    let [request, ...otherRequests] = requestsOf(restored);
    assert.strictEqual(otherRequests.length, 0, 'One request');
    assert.deepEqual(
      request.arguments?.attributes?.targets.map((target: any) => target.ref),
      summary.cards.map((card) => card.cardId),
      'Every target is in it',
    );
  });

  test('an event within the budget keeps its check request inline', async function () {
    let client = new MediaClient();

    await publishCodePatchCorrectnessMessage(bulkSummary(3), client);

    let [event] = client.getSentEvents();
    assert.strictEqual(client.uploads.size, 0, 'Nothing is uploaded');
    assert.strictEqual(event.content[APP_BOXEL_EXTERNAL_FIELDS_KEY], undefined);
    assert.strictEqual(requestsOf(event.content).length, 1);
  });

  test('AI_BOT_MAX_EVENT_CONTENT_BYTES lowers the budget', async function () {
    let original = process.env.AI_BOT_MAX_EVENT_CONTENT_BYTES;
    process.env.AI_BOT_MAX_EVENT_CONTENT_BYTES = '2000';
    try {
      let client = new MediaClient();
      await publishCodePatchCorrectnessMessage(bulkSummary(30), client);
      let [event] = client.getSentEvents();
      assert.strictEqual(client.uploads.size, 1, 'The request is uploaded');
      assert.true(Buffer.byteLength(JSON.stringify(event.content)) <= 2000);
    } finally {
      if (original === undefined) {
        delete process.env.AI_BOT_MAX_EVENT_CONTENT_BYTES;
      } else {
        process.env.AI_BOT_MAX_EVENT_CONTENT_BYTES = original;
      }
    }
  });

  test('an upload that fails throws, and nothing is sent', async function () {
    let client = new MediaClient();
    client.uploadContent = async () => {
      throw new Error('upload failed');
    };
    let error: unknown;
    try {
      await publishCodePatchCorrectnessMessage(bulkSummary(300), client, 4000);
    } catch (e) {
      error = e;
    }
    assert.strictEqual((error as Error | undefined)?.message, 'upload failed');
    assert.strictEqual(client.getSentEvents().length, 0);
  });
});

module('external fields', () => {
  test('a field outside Matrix media is not fetched', async function () {
    let fetched: string[] = [];
    let content: Record<string, any> = {
      [APP_BOXEL_EXTERNAL_FIELDS_KEY]: {
        [APP_BOXEL_TOOL_REQUESTS_KEY]: 'https://elsewhere.example/requests',
      },
    };
    let errors = await restoreExternalFields(content, async (url) => {
      fetched.push(url);
      return '[]';
    });
    assert.deepEqual(fetched, [], 'nothing is fetched');
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(content[APP_BOXEL_TOOL_REQUESTS_KEY], undefined);
  });

  test('a field that cannot be fetched stays listed, with the reason', async function () {
    let content: Record<string, any> = {
      [APP_BOXEL_EXTERNAL_FIELDS_KEY]: {
        [APP_BOXEL_TOOL_REQUESTS_KEY]: 'mxc://localhost/missing',
      },
    };
    let errors = await restoreExternalFields(content, async () => {
      throw new Error('not found');
    });
    assert.deepEqual(errors, [
      `could not load ${APP_BOXEL_TOOL_REQUESTS_KEY}: not found`,
    ]);
    assert.deepEqual(content[APP_BOXEL_EXTERNAL_FIELDS_KEY], {
      [APP_BOXEL_TOOL_REQUESTS_KEY]: 'mxc://localhost/missing',
    });
  });
});
