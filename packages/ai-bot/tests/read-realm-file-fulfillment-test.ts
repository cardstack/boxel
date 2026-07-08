import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import { fulfillReadRealmFileCalls } from '../lib/read-realm-file-fulfillment.ts';
import { READ_REALM_FILE_TOOL_NAME } from '../lib/read-realm-file.ts';
import {
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

const ON_BEHALF_OF = '@user:localhost';
const AGENT_ID = 'agent-1';
const ROOM_ID = '!room:localhost';
const REQUEST_EVENT_ID = '$request:localhost';
const FILE_URL =
  'https://localhost:4201/user/jane/skills/trip-planner/SKILL.md';

function readRealmFileCall(id: string, args: object) {
  return {
    id,
    type: 'function',
    function: {
      name: READ_REALM_FILE_TOOL_NAME,
      arguments: JSON.stringify(args),
    },
  } as any;
}

// A fake Matrix client that records sent events and uploads. sendMatrixEvent
// JSON-stringifies content.data on the way out, so the recorded data is a
// string — tests parse it back.
function fakeClient() {
  let sent: { eventType: string; content: any }[] = [];
  let uploads: { content: any; opts: any }[] = [];
  let client = {
    sendEvent: async (_roomId: string, eventType: string, content: any) => {
      sent.push({ eventType, content });
      return { event_id: `$sent-${sent.length}:localhost` };
    },
    uploadContent: async (content: any, opts: any) => {
      uploads.push({ content, opts });
      return { content_uri: `mxc://localhost/upload-${uploads.length}` };
    },
    mxcUrlToHttp: (uri: string) =>
      `https://localhost/_matrix/media/v3/download/${uri.replace(
        'mxc://',
        '',
      )}`,
  } as any;
  return { client, sent, uploads };
}

function sessions() {
  return {
    getToken: async () => 'tok',
    invalidate: () => {},
  };
}

function baseDeps(client: any, extra: object = {}) {
  return {
    client,
    roomId: ROOM_ID,
    requestEventId: REQUEST_EVENT_ID,
    agentId: AGENT_ID,
    onBehalfOf: ON_BEHALF_OF,
    delegatedUserRealmSessions: sessions(),
    ...extra,
  };
}

// Reads the (stringified) data payload back off a recorded event.
function dataOf(sentEvent: { content: any }) {
  return JSON.parse(sentEvent.content.data);
}

module('fulfillReadRealmFileCalls', () => {
  test('a successful read attaches the file to an applied command-result event', async () => {
    let { client, sent } = fakeClient();
    let fetch = (async () =>
      new Response('# Trip Planner', {
        status: 200,
      })) as unknown as typeof globalThis.fetch;

    let outcomes = await fulfillReadRealmFileCalls(
      [readRealmFileCall('c1', { url: FILE_URL })],
      baseDeps(client, {
        fetch,
        // Inject the uploader so this case doesn't touch the dedup cache.
        uploadText: async () => 'https://localhost/media/trip-planner',
      }),
    );

    assert.deepEqual(outcomes, [{ commandRequestId: 'c1', ok: true }]);
    assert.strictEqual(sent.length, 1, 'one command-result event posted');
    let { eventType, content } = sent[0];
    assert.strictEqual(eventType, APP_BOXEL_COMMAND_RESULT_EVENT_TYPE);
    assert.strictEqual(
      content.msgtype,
      APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(content.commandRequestId, 'c1');
    assert.strictEqual(content['m.relates_to'].key, 'applied');
    assert.strictEqual(content['m.relates_to'].event_id, REQUEST_EVENT_ID);
    let data = dataOf(sent[0]);
    assert.strictEqual(data.attachedFiles.length, 1);
    assert.strictEqual(
      data.attachedFiles[0].sourceUrl,
      FILE_URL,
      'attachment keeps the realm source url for scoping/supersession',
    );
    assert.strictEqual(
      data.attachedFiles[0].url,
      'https://localhost/media/trip-planner',
      'attachment points at the uploaded media url',
    );
    assert.strictEqual(data.context.agentId, AGENT_ID);
  });

  test('a failed read posts an invalid result carrying the reason, no attachment', async () => {
    let { client, sent } = fakeClient();
    let fetch = (async () =>
      new Response('nope', {
        status: 404,
      })) as unknown as typeof globalThis.fetch;

    let outcomes = await fulfillReadRealmFileCalls(
      [readRealmFileCall('c1', { url: FILE_URL })],
      baseDeps(client, { fetch }),
    );

    assert.false(outcomes[0].ok, 'a 404 read is reported as failed');
    assert.strictEqual(sent.length, 1);
    let { content } = sent[0];
    assert.strictEqual(
      content.msgtype,
      APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(content['m.relates_to'].key, 'invalid');
    assert.true(
      content.failureReason.includes('404'),
      'the reason rides along so the user sees why it failed',
    );
    assert.strictEqual(dataOf(sent[0]).attachedFiles, undefined);
  });

  test('malformed arguments fail without fetching', async () => {
    let { client, sent } = fakeClient();
    let fetched = false;
    let fetch = (async () => {
      fetched = true;
      return new Response('x', { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    let outcomes = await fulfillReadRealmFileCalls(
      [
        {
          id: 'c1',
          type: 'function',
          function: {
            name: READ_REALM_FILE_TOOL_NAME,
            arguments: '{not json',
          },
        } as any,
      ],
      baseDeps(client, { fetch }),
    );

    assert.false(outcomes[0].ok);
    assert.false(fetched, 'never fetched for malformed arguments');
    assert.strictEqual(sent[0].content['m.relates_to'].key, 'invalid');
  });

  test('identical content is uploaded once and re-referenced (dedup)', async () => {
    let { client, sent, uploads } = fakeClient();
    // Content unique to this test so the module-level hash cache is exercised
    // cleanly regardless of other tests (this is the only test that uploads via
    // the real, caching uploader).
    let body = '# Dedup Fixture — reuse-me-across-rooms';
    let fetch = (async () =>
      new Response(body, {
        status: 200,
      })) as unknown as typeof globalThis.fetch;

    await fulfillReadRealmFileCalls(
      [readRealmFileCall('c1', { url: FILE_URL })],
      baseDeps(client, { fetch }),
    );
    await fulfillReadRealmFileCalls(
      [readRealmFileCall('c2', { url: FILE_URL })],
      baseDeps(client, { fetch }),
    );

    assert.strictEqual(sent.length, 2, 'both reads post their own result');
    assert.strictEqual(
      uploads.length,
      1,
      'the same bytes are uploaded to Matrix only once',
    );
    // Both results point at the same uploaded media url.
    assert.strictEqual(
      dataOf(sent[0]).attachedFiles[0].url,
      dataOf(sent[1]).attachedFiles[0].url,
    );
  });
});
