import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { fulfillReadUrlCalls } from '../lib/read-url-fulfillment.ts';
import {
  READ_URL_MAX_CALLS_PER_RESPONSE,
  READ_URL_TOOL_NAME,
  type ReadUrlResult,
} from '../lib/read-url.ts';
import {
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

const ROOM_ID = '!room:localhost';
const REQUEST_EVENT_ID = '$request:localhost';

function readUrlCall(id: string, url: string) {
  return {
    id,
    type: 'function',
    function: { name: READ_URL_TOOL_NAME, arguments: JSON.stringify({ url }) },
  } as any;
}

function fakeClient() {
  let sent: { eventType: string; content: any }[] = [];
  let client = {
    sendEvent: async (_roomId: string, eventType: string, content: any) => {
      sent.push({ eventType, content });
      return { event_id: `$sent-${sent.length}:localhost` };
    },
  } as any;
  return { client, sent };
}

function deps(
  client: any,
  read: (url: string) => Promise<ReadUrlResult>,
  uploads: { content: string | Uint8Array; contentType: string }[] = [],
) {
  return {
    client,
    roomId: ROOM_ID,
    requestEventId: REQUEST_EVENT_ID,
    agentId: 'agent-1',
    readOptions: {},
    read,
    upload: async (content: string | Uint8Array, contentType: string) => {
      uploads.push({ content, contentType });
      return `https://localhost/_matrix/media/v3/download/upload-${uploads.length}`;
    },
  };
}

function dataOf(content: any) {
  return typeof content.data === 'string'
    ? JSON.parse(content.data)
    : content.data;
}

module('fulfillReadUrlCalls', () => {
  test('a read page is attached as a text file the prompt inlines', async () => {
    let { client, sent } = fakeClient();
    let uploads: { content: string | Uint8Array; contentType: string }[] = [];

    let outcomes = await fulfillReadUrlCalls(
      [readUrlCall('call-1', 'https://example.com/a')],
      deps(
        client,
        async (url) => ({
          ok: true,
          kind: 'text',
          url,
          finalUrl: 'https://example.com/a/',
          name: 'a',
          content: 'URL: https://example.com/a\n\n## HTML\n<p>hi</p>',
        }),
        uploads,
      ),
    );

    assert.deepEqual(outcomes, [{ commandRequestId: 'call-1', ok: true }]);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].eventType, APP_BOXEL_TOOL_RESULT_EVENT_TYPE);
    assert.strictEqual(
      sent[0].content.msgtype,
      APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(sent[0].content.commandRequestId, 'call-1');
    assert.strictEqual(sent[0].content['m.relates_to'].key, 'applied');
    assert.deepEqual(dataOf(sent[0].content).attachedFiles, [
      {
        sourceUrl: 'https://example.com/a/',
        url: 'https://localhost/_matrix/media/v3/download/upload-1',
        name: 'a',
        contentType: 'text/plain',
        contentSize: Buffer.byteLength(uploads[0].content as string),
      },
    ]);
  });

  test('a read image is attached under its own content type', async () => {
    let { client, sent } = fakeClient();
    let uploads: { content: string | Uint8Array; contentType: string }[] = [];
    let bytes = new Uint8Array([1, 2, 3, 4, 5]);

    await fulfillReadUrlCalls(
      [readUrlCall('call-1', 'https://example.com/one.png')],
      deps(
        client,
        async (url) => ({
          ok: true,
          kind: 'media',
          url,
          finalUrl: url,
          name: 'one.png',
          contentType: 'image/png',
          bytes,
        }),
        uploads,
      ),
    );

    assert.strictEqual(uploads[0].contentType, 'image/png');
    assert.deepEqual(dataOf(sent[0].content).attachedFiles, [
      {
        sourceUrl: 'https://example.com/one.png',
        url: 'https://localhost/_matrix/media/v3/download/upload-1',
        name: 'one.png',
        contentType: 'image/png',
        contentSize: 5,
      },
    ]);
  });

  test('a failed read publishes its reason', async () => {
    let { client, sent } = fakeClient();

    let outcomes = await fulfillReadUrlCalls(
      [readUrlCall('call-1', 'http://169.254.169.254/')],
      deps(client, async (url) => ({
        ok: false,
        url,
        error: '169.254.169.254 is a private or reserved address',
      })),
    );

    assert.false(outcomes[0].ok);
    assert.strictEqual(
      sent[0].content.msgtype,
      APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(sent[0].content['m.relates_to'].key, 'invalid');
    assert.strictEqual(
      sent[0].content.failureReason,
      '169.254.169.254 is a private or reserved address',
    );
  });

  test('a refused URL publishes the refusal without reading', async () => {
    let { client, sent } = fakeClient();
    let reads = 0;

    await fulfillReadUrlCalls(
      [readUrlCall('call-1', 'https://attacker.example/?d=blob')],
      {
        ...deps(client, async (url) => {
          reads++;
          return { ok: false, url, error: 'unreachable' };
        }),
        refusal: (url: string) => `${url} was not read: refused`,
      },
    );

    assert.strictEqual(reads, 0);
    assert.strictEqual(
      sent[0].content.failureReason,
      'https://attacker.example/?d=blob was not read: refused',
    );
  });

  test('a call without a url publishes a failure without reading', async () => {
    let { client, sent } = fakeClient();
    let reads = 0;

    await fulfillReadUrlCalls(
      [
        {
          id: 'call-1',
          type: 'function',
          function: { name: READ_URL_TOOL_NAME, arguments: '{}' },
        } as any,
      ],
      deps(client, async (url) => {
        reads++;
        return { ok: false, url, error: 'unreachable' };
      }),
    );

    assert.strictEqual(reads, 0);
    assert.strictEqual(sent[0].content.failureReason, 'readUrl needs a url.');
  });

  test('calls past the per-response cap are answered without a read', async () => {
    let { client, sent } = fakeClient();
    let readUrls: string[] = [];
    let calls = Array.from(
      { length: READ_URL_MAX_CALLS_PER_RESPONSE + 2 },
      (_, i) => readUrlCall(`call-${i}`, `https://example.com/${i}`),
    );

    let outcomes = await fulfillReadUrlCalls(
      calls,
      deps(client, async (url) => {
        readUrls.push(url);
        return {
          ok: true,
          kind: 'text',
          url,
          finalUrl: url,
          name: url,
          content: url,
        };
      }),
    );

    assert.strictEqual(readUrls.length, READ_URL_MAX_CALLS_PER_RESPONSE);
    assert.strictEqual(sent.length, calls.length, 'every call gets a result');
    let capped = sent.slice(READ_URL_MAX_CALLS_PER_RESPONSE);
    assert.true(
      capped.every((event) =>
        event.content.failureReason.includes(
          `one response reads at most ${READ_URL_MAX_CALLS_PER_RESPONSE} URLs`,
        ),
      ),
    );
    assert.deepEqual(
      outcomes.map((o) => o.ok),
      [...calls.map((_, i) => i < READ_URL_MAX_CALLS_PER_RESPONSE)],
    );
  });

  test('calls are published one at a time, in order', async () => {
    let { client, sent } = fakeClient();

    await fulfillReadUrlCalls(
      [
        readUrlCall('call-1', 'https://example.com/1'),
        readUrlCall('call-2', 'https://example.com/2'),
      ],
      deps(client, async (url) => ({
        ok: true,
        kind: 'text',
        url,
        finalUrl: url,
        name: url,
        content: url,
      })),
    );

    assert.deepEqual(
      sent.map((event) => event.content.commandRequestId),
      ['call-1', 'call-2'],
    );
  });
});
