import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import { MAX_TOOL_RESULT_MEDIA_FILE_BYTES } from '@cardstack/runtime-common/ai';
import { fulfillViewAttachmentCall } from '../lib/bot-tools/view-attachment/fulfillment.ts';
import {
  roomAttachments,
  VIEW_ATTACHMENT_MAX_URLS,
  VIEW_ATTACHMENT_TOOL_NAME,
  viewAttachmentLabel,
} from '../lib/bot-tools/view-attachment/view.ts';

const BOT = '@aibot:localhost';
const USER = '@user:localhost';
const ROOM_ID = '!room:localhost';
const REQUEST_EVENT_ID = '$request:localhost';
const AGENT_ID = 'agent-1';

type AttachedFile = {
  sourceUrl?: string;
  url?: string;
  name?: string;
  contentType?: string;
  contentSize?: number;
};

function photo(name: string, extra: Partial<AttachedFile> = {}): AttachedFile {
  return {
    sourceUrl: `boxel-local://3f2a/${encodeURIComponent(name)}`,
    url: `https://matrix.example/_matrix/client/v1/media/download/localhost/${name.replace(/[^A-Za-z0-9_-]/g, '_')}`,
    name,
    contentType: 'image/jpeg',
    contentSize: 2048,
    ...extra,
  };
}

let eventCount = 0;

function message(
  sender: string,
  attachedFiles: AttachedFile[],
  { serialized = false }: { serialized?: boolean } = {},
): DiscreteMatrixEvent {
  let data = { context: {}, attachedFiles };
  return {
    type: 'm.room.message',
    event_id: `$message-${++eventCount}`,
    sender,
    content: {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'look',
      data: serialized ? JSON.stringify(data) : data,
    },
  } as unknown as DiscreteMatrixEvent;
}

function toolResult(
  sender: string,
  attachedFiles: AttachedFile[],
): DiscreteMatrixEvent {
  return {
    type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
    event_id: `$result-${++eventCount}`,
    sender,
    content: {
      msgtype: APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
      commandRequestId: `call-${eventCount}`,
      'm.relates_to': {
        rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        key: 'applied',
        event_id: '$bot',
      },
      data: { attachedFiles },
    },
  } as unknown as DiscreteMatrixEvent;
}

function viewCall(urls: unknown, id = 'call-1') {
  return {
    id,
    type: 'function' as const,
    function: {
      name: VIEW_ATTACHMENT_TOOL_NAME,
      arguments: JSON.stringify({ urls }),
    },
  };
}

// A fake Matrix client that records the events sent and fails any upload or
// download: the tool attaches stored files and fetches nothing itself.
function fakeClient() {
  let sent: { eventType: string; content: any }[] = [];
  let client = {
    sendEvent: async (_roomId: string, eventType: string, content: any) => {
      sent.push({ eventType, content });
      return { event_id: `$sent-${sent.length}:localhost` };
    },
    uploadContent: async () => {
      throw new Error('viewAttachment must not upload');
    },
  } as any;
  return { client, sent };
}

async function view(history: DiscreteMatrixEvent[], urls: unknown) {
  let { client, sent } = fakeClient();
  let outcome = await fulfillViewAttachmentCall(viewCall(urls), {
    client,
    roomId: ROOM_ID,
    requestEventId: REQUEST_EVENT_ID,
    agentId: AGENT_ID,
    attachments: roomAttachments(history, BOT),
  });
  assert.strictEqual(sent.length, 1, 'the call publishes one result');
  let { eventType, content } = sent[0];
  // sendMatrixEvent serializes data on the way out.
  return {
    outcome,
    eventType,
    content,
    data: JSON.parse(content.data),
  };
}

module('viewAttachment', () => {
  test('a file the user attached comes back as the same stored file, with nothing uploaded', async () => {
    let jpg = photo('sample-photo.jpg');
    let { outcome, eventType, content, data } = await view(
      [message(USER, [jpg])],
      [jpg.sourceUrl],
    );

    assert.strictEqual(eventType, APP_BOXEL_TOOL_RESULT_EVENT_TYPE);
    assert.strictEqual(
      content.msgtype,
      APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(content.commandRequestId, 'call-1');
    assert.deepEqual(content['m.relates_to'], {
      rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
      key: 'applied',
      event_id: REQUEST_EVENT_ID,
    });
    assert.strictEqual(content.failureReason, undefined);
    assert.deepEqual(data.context, { agentId: AGENT_ID });
    assert.deepEqual(data.attachedFiles, [jpg]);
    assert.deepEqual(outcome, {
      commandRequestId: 'call-1',
      ok: true,
      published: true,
    });
  });

  test('a URL no message in the room attached is refused', async () => {
    let jpg = photo('trees.jpg');
    let { outcome, content, data } = await view(
      [message(USER, [jpg])],
      ['boxel-local://9999/someone-elses.jpg'],
    );

    assert.strictEqual(
      content.msgtype,
      APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
    );
    assert.strictEqual(content['m.relates_to'].key, 'invalid');
    assert.ok(
      content.failureReason.includes(
        'boxel-local://9999/someone-elses.jpg was not attached to a message in this conversation',
      ),
      content.failureReason,
    );
    assert.strictEqual(data.attachedFiles, undefined, 'nothing is attached');
    assert.false(outcome.ok);
  });

  test('a stored media URL that no message attached is refused, even on this homeserver', async () => {
    let jpg = photo('trees.jpg');
    let { content, data } = await view(
      [message(USER, [jpg])],
      ['mxc://localhost/another-rooms-media', jpg.url],
    );

    assert.strictEqual(content['m.relates_to'].key, 'invalid');
    assert.strictEqual(data.attachedFiles, undefined);
  });

  test('files the bot attached, and files attached to tool results, cannot be viewed', async () => {
    let fromBot = photo('from-bot.jpg');
    let fromBotResult = photo('read-from-web.jpg');
    let fromClientResult = photo('capture.jpg');
    let { content } = await view(
      [
        message(BOT, [fromBot]),
        toolResult(BOT, [fromBotResult]),
        toolResult(USER, [fromClientResult]),
      ],
      [fromBot.sourceUrl, fromBotResult.sourceUrl, fromClientResult.sourceUrl],
    );

    assert.strictEqual(content['m.relates_to'].key, 'invalid');
    for (let file of [fromBot, fromBotResult, fromClientResult]) {
      assert.ok(
        content.failureReason.includes(
          `${file.sourceUrl} was not attached to a message in this conversation`,
        ),
        `${file.name} is refused`,
      );
    }
  });

  test('a file attached more than once comes back as its newest attachment', async () => {
    let older = photo('logo.png', {
      sourceUrl: 'https://realm.example/user/jane/logo.png',
      url: 'mxc://localhost/logo-v1',
      contentType: 'image/png',
    });
    let newer = { ...older, url: 'mxc://localhost/logo-v2', contentSize: 4096 };
    let { data } = await view(
      [message(USER, [older]), message(USER, [newer])],
      [older.sourceUrl],
    );

    assert.deepEqual(data.attachedFiles, [newer]);
  });

  test('a message whose data arrives serialized is read', async () => {
    let jpg = photo('trees.jpg');
    let { data } = await view(
      [message(USER, [jpg], { serialized: true })],
      [jpg.sourceUrl],
    );

    assert.deepEqual(data.attachedFiles, [jpg]);
  });

  test('a URL is matched with its percent-encoding undone', async () => {
    let jpg = photo('my photo.jpg');
    assert.strictEqual(jpg.sourceUrl, 'boxel-local://3f2a/my%20photo.jpg');
    let { data } = await view(
      [message(USER, [jpg])],
      ['boxel-local://3f2a/my photo.jpg'],
    );

    assert.deepEqual(data.attachedFiles, [jpg]);
  });

  test('a text attachment is refused: its content is already in history', async () => {
    let notes = photo('notes.md', { contentType: 'text/markdown' });
    let { content } = await view([message(USER, [notes])], [notes.sourceUrl]);

    assert.strictEqual(content['m.relates_to'].key, 'invalid');
    assert.ok(
      content.failureReason.includes(
        `${notes.sourceUrl} is a text file: its content is already in the message that attached it.`,
      ),
      content.failureReason,
    );
  });

  test('an attachment that is not stored as Matrix media is refused', async () => {
    let jpg = photo('elsewhere.jpg', {
      url: 'https://cdn.example/elsewhere.jpg',
    });
    let { content } = await view([message(USER, [jpg])], [jpg.sourceUrl]);

    assert.strictEqual(content['m.relates_to'].key, 'invalid');
    assert.ok(
      content.failureReason.includes(
        `${jpg.sourceUrl} can't be shown: it is not a file stored in this conversation. Ask the user to attach it again if you need it.`,
      ),
      content.failureReason,
    );
  });

  test('an attachment the prompt could never send as tool-result media is refused at call time', async () => {
    let sizeless = photo('sizeless.jpg', { contentSize: undefined });
    let large = photo('large.jpg', {
      contentSize: MAX_TOOL_RESULT_MEDIA_FILE_BYTES + 1,
    });
    let atLimit = photo('at-limit.jpg', {
      contentSize: MAX_TOOL_RESULT_MEDIA_FILE_BYTES,
    });
    let { content, data } = await view(
      [message(USER, [sizeless, large, atLimit])],
      [sizeless.sourceUrl, large.sourceUrl, atLimit.sourceUrl],
    );

    assert.deepEqual(
      data.attachedFiles,
      [atLimit],
      'a file at the limit is shown',
    );
    assert.ok(
      content.failureReason.includes(
        `${sizeless.sourceUrl} can't be shown: its size is unknown.`,
      ),
      content.failureReason,
    );
    assert.ok(
      content.failureReason.includes(
        `${large.sourceUrl} can't be shown: it is larger than 3.75 MiB.`,
      ),
      content.failureReason,
    );
  });

  test('a call that finds some files attaches them and names the rest', async () => {
    let jpg = photo('trees.jpg');
    let { outcome, content, data } = await view(
      [message(USER, [jpg])],
      [jpg.sourceUrl, 'boxel-local://9999/missing.jpg'],
    );

    assert.strictEqual(content['m.relates_to'].key, 'applied');
    assert.deepEqual(data.attachedFiles, [jpg]);
    assert.ok(
      content.failureReason.includes(
        'boxel-local://9999/missing.jpg was not attached to a message in this conversation',
      ),
      content.failureReason,
    );
    assert.false(outcome.ok);
  });

  test('a call names at most the per-turn tool-result media count, and the rest are named back', async () => {
    let files = Array.from({ length: VIEW_ATTACHMENT_MAX_URLS + 2 }, (_, i) =>
      photo(`photo-${i}.jpg`),
    );
    let { content, data } = await view(
      [message(USER, files)],
      files.map((file) => file.sourceUrl),
    );

    assert.strictEqual(data.attachedFiles.length, VIEW_ATTACHMENT_MAX_URLS);
    assert.ok(
      content.failureReason.includes(
        `2 of the ${VIEW_ATTACHMENT_MAX_URLS + 2} urls in this call were not viewed`,
      ),
      content.failureReason,
    );
    assert.ok(
      content.failureReason.includes(
        files[VIEW_ATTACHMENT_MAX_URLS + 1].sourceUrl!,
      ),
    );
  });

  test('a call without urls is answered as invalid', async () => {
    let { content } = await view([message(USER, [photo('trees.jpg')])], []);

    assert.strictEqual(content['m.relates_to'].key, 'invalid');
    assert.strictEqual(
      content.failureReason,
      `${VIEW_ATTACHMENT_TOOL_NAME} needs a non-empty list of urls.`,
    );
  });

  test('the timeline label names the files, from partial arguments too', () => {
    assert.strictEqual(
      viewAttachmentLabel(
        JSON.stringify({ urls: ['boxel-local://3f2a/my%20photo.jpg'] }),
      ),
      'View attachment: my photo.jpg',
    );
    assert.strictEqual(
      viewAttachmentLabel(
        JSON.stringify({
          urls: ['boxel-local://3f2a/a.jpg', 'https://realm.example/b.png'],
        }),
      ),
      'View attachments: a.jpg, b.png',
    );
    assert.strictEqual(
      viewAttachmentLabel('{"urls":["boxel-lo'),
      'View attachments',
    );
  });
});
