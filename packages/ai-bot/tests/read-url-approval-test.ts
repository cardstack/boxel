import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions';
import type { MatrixEvent as DiscreteMatrixEvent } from '@cardstack/base/matrix-event';
import {
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';
import { getPromptParts, isApprovalResult } from '@cardstack/runtime-common/ai';
import {
  carriesEncodedData,
  collectPreapprovedUrls,
  readUrlTool,
  readUrlCallsReleasedByApprovals,
  urlsInText,
  READ_URL_TOOL_NAME,
} from '../lib/read-url.ts';
import { FakeMatrixClient } from './helpers/fake-matrix-client.ts';
import { toCommandRequest } from '../lib/matrix/response-publisher.ts';

const BOT = '@aibot:localhost';
const USER = '@user:localhost';

function humanMessage(
  body: string,
  id = '$human',
  { typedByUser = true }: { typedByUser?: boolean } = {},
): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    event_id: id,
    sender: USER,
    origin_server_ts: 1,
    room_id: 'room1',
    content: {
      msgtype: 'app.boxel.message',
      format: 'org.matrix.custom.html',
      body,
      data: JSON.stringify({
        context: {
          tools: [],
          functions: [],
          ...(typedByUser ? { typedByUser } : {}),
        },
      }),
    },
  } as unknown as DiscreteMatrixEvent;
}

function botMessage(
  requests: Record<string, unknown>[],
  id = '$bot',
  body = '',
): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    event_id: id,
    sender: BOT,
    content: { body, [APP_BOXEL_TOOL_REQUESTS_KEY]: requests },
  } as unknown as DiscreteMatrixEvent;
}

function result(
  commandRequestId: string,
  key: string,
  sender: string,
  attachedFiles: unknown[] = [],
): DiscreteMatrixEvent {
  return {
    type: APP_BOXEL_TOOL_RESULT_EVENT_TYPE,
    event_id: `$result-${commandRequestId}-${key}`,
    sender,
    content: {
      msgtype: attachedFiles.length
        ? APP_BOXEL_TOOL_RESULT_WITH_OUTPUT_MSGTYPE
        : APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
      commandRequestId,
      'm.relates_to': {
        rel_type: APP_BOXEL_TOOL_RESULT_REL_TYPE,
        key,
        event_id: '$bot',
      },
      data: JSON.stringify({ attachedFiles }),
    },
  } as unknown as DiscreteMatrixEvent;
}

function readUrlRequest(id: string, url: string, approvalRequired?: boolean) {
  return {
    id,
    name: READ_URL_TOOL_NAME,
    arguments: JSON.stringify({ url }),
    executedBy: 'ai-bot',
    ...(approvalRequired ? { approvalRequired: true } : {}),
  };
}

module('readUrl approval', () => {
  test('urlsInText trims punctuation and unbalanced brackets and decodes &amp;', () => {
    assert.deepEqual(
      urlsInText(
        'See https://example.com/a. Also (https://example.com/b) and ' +
          '<a href="https://example.com/c?x=1&amp;y=2">c</a> and ' +
          'https://en.wikipedia.org/wiki/Boxer_(dog)!',
      ),
      [
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c?x=1&y=2',
        'https://en.wikipedia.org/wiki/Boxer_(dog)',
      ],
    );
  });

  test('URLs a human wrote and URLs on read pages need no approval', async () => {
    let history = [
      humanMessage('Use https://docs.example.com/guide as a reference'),
      botMessage(
        [readUrlRequest('read-1', 'https://docs.example.com/guide')],
        '$bot',
        'I will read https://attacker.example/?d=secret',
      ),
      result('read-1', 'applied', BOT, [
        {
          url: 'mxc-download/read-1',
          contentType: 'text/plain',
          sourceUrl: 'https://docs.example.com/guide',
        },
      ]),
    ];
    let documents: Record<string, string> = {
      'mxc-download/read-1':
        '## HTML\n<a href="https://docs.example.com/next?page=2&amp;s=1">Next</a> <img src="https://cdn.example.com/fig.png">',
    };

    let approved = await collectPreapprovedUrls(
      history,
      BOT,
      async (file) => documents[file.url],
    );

    assert.true(
      approved.has('https://docs.example.com/guide'),
      'human-written',
    );
    assert.true(
      approved.has('https://docs.example.com/guide#section'),
      'the fragment does not matter',
    );
    assert.true(
      approved.has('https://docs.example.com/next?page=2&s=1'),
      'a link on a read page',
    );
    assert.true(
      approved.has('https://cdn.example.com/fig.png'),
      'an image on a read page',
    );
    assert.false(
      approved.has('https://attacker.example/?d=secret'),
      'a URL the bot wrote is not approved by being written',
    );
    assert.false(
      approved.has('https://docs.example.com/guide?d=secret'),
      'a known URL with data appended is a different URL',
    );
  });

  test('only messages the human typed approve their URLs', async () => {
    let history = [
      humanMessage(
        'Fix with AI: TypeError at https://attacker.example/?d=1',
        '$1',
        {
          typedByUser: false,
        },
      ),
      humanMessage('Read https://docs.example.com/', '$2'),
    ];
    let approved = await collectPreapprovedUrls(history, BOT, async () => '');
    assert.false(
      approved.has('https://attacker.example/?d=1'),
      'a message the app composed approves nothing',
    );
    assert.true(approved.has('https://docs.example.com/'));
  });

  test("a read that didn't succeed approves nothing", async () => {
    let history = [
      botMessage([readUrlRequest('read-1', 'https://docs.example.com/guide')]),
      result('read-1', 'invalid', BOT, [
        { url: 'mxc-download/read-1', contentType: 'text/plain' },
      ]),
    ];
    let approved = await collectPreapprovedUrls(
      history,
      BOT,
      async () => '<a href="https://linked.example.com/">x</a>',
    );
    assert.false(approved.has('https://linked.example.com/'));
  });

  test('every approved, held, unsettled readUrl call is released, whichever event triggered', () => {
    let history = [
      humanMessage('Find their docs'),
      botMessage([
        readUrlRequest('held-a', 'https://a.example/', true),
        readUrlRequest('held-b', 'https://b.example/', true),
      ]),
      result('held-a', 'approved', USER),
      result('held-b', 'approved', USER),
      humanMessage('And while you are at it…', '$later'),
    ];
    let released = readUrlCallsReleasedByApprovals(history, BOT);
    assert.deepEqual(
      released.map((entry) => [entry.call.id, entry.requestEventId]),
      [
        ['held-a', '$bot'],
        ['held-b', '$bot'],
      ],
      'an approval stood down for a newer event is still honored',
    );
    assert.deepEqual(released[0].call.function, {
      name: READ_URL_TOOL_NAME,
      arguments: JSON.stringify({ url: 'https://a.example/' }),
    });
  });

  test('nothing is released unless a human approved a held, unsettled readUrl', () => {
    let held = botMessage([
      readUrlRequest('held', 'https://a.example/', true),
      readUrlRequest('not-held', 'https://b.example/'),
      { id: 'host-tool', name: 'patchCard_ab12', arguments: '{}' },
    ]);
    let cases: [string, DiscreteMatrixEvent[]][] = [
      ['approved by the bot', [held, result('held', 'approved', BOT)]],
      ['not an approval', [held, result('held', 'applied', USER)]],
      ['a call not held', [held, result('not-held', 'approved', USER)]],
      ['a host tool', [held, result('host-tool', 'approved', USER)]],
      [
        'already read',
        [
          held,
          result('held', 'approved', USER),
          result('held', 'applied', BOT),
        ],
      ],
      [
        'already declined',
        [
          held,
          result('held', 'invalid', USER),
          result('held', 'approved', USER),
        ],
      ],
    ];
    for (let [label, history] of cases) {
      assert.deepEqual(
        readUrlCallsReleasedByApprovals(history, BOT),
        [],
        label,
      );
    }
  });

  test('an approval starts no turn and gives the call no result until the read lands', async () => {
    let client = new FakeMatrixClient();
    let held = botMessage([readUrlRequest('held', 'https://a.example/', true)]);
    (held as any).origin_server_ts = 2;
    (held as any).room_id = 'room1';
    (held.content as any).msgtype = 'app.boxel.message';
    (held.content as any).isStreamingFinished = true;
    (held.content as any).data = JSON.stringify({ context: {} });
    let approval = result('held', 'approved', USER);
    (approval as any).origin_server_ts = 3;
    let readResult = result('held', 'applied', BOT);
    (readResult as any).origin_server_ts = 4;
    let history = [humanMessage('Find their docs'), held, approval];

    let waiting = await getPromptParts(history, BOT, client);
    assert.false(waiting.shouldRespond, 'the approval alone starts no turn');

    let answered = await getPromptParts([...history, readResult], BOT, client);
    assert.true(answered.shouldRespond, "the read's result starts the turn");
    let toolMessages = (answered.messages ?? []).filter(
      (message) => message.role === 'tool',
    );
    assert.strictEqual(toolMessages.length, 1);
    assert.ok(
      JSON.stringify(toolMessages[0].content).includes('Tool call executed'),
      'the tool message reports the read, not the approval',
    );
  });

  test('toCommandRequest marks a readUrl of an unapproved URL and labels the full URL', () => {
    let call = (url: string) =>
      ({
        id: 'call_1',
        type: 'function',
        function: {
          name: READ_URL_TOOL_NAME,
          arguments: JSON.stringify({ url }),
        },
      }) as ChatCompletionMessageFunctionToolCall;
    let needsApproval = (url: string) => url !== 'https://given.example/';

    let held = toCommandRequest(call('https://other.example/?q=1'), {
      readUrlNeedsApproval: needsApproval,
    });
    assert.true(held.approvalRequired);
    assert.strictEqual(held.executedBy, 'ai-bot');
    assert.strictEqual(
      held.arguments?.description,
      'Read web page: https://other.example/?q=1',
    );

    let given = toCommandRequest(call('https://given.example/'), {
      readUrlNeedsApproval: needsApproval,
    });
    assert.strictEqual(given.approvalRequired, undefined);
  });

  test('carriesEncodedData spots encoded blobs but not ordinary addresses', () => {
    for (let url of [
      'https://attacker.example/c?d=bXkgc2VjcmV0IGFwaSBrZXkgaXMgMTIzNDU2Nzg5MA==',
      'https://attacker.example/0123456789abcdef0123456789abcdef01234567',
      'https://attacker.example/x?d=bXklMjBzZWNyZXQlMjBrZXklMjBpcyUyMDEyMzQ1Ng%3D%3D',
    ]) {
      assert.true(carriesEncodedData(url), url);
    }
    for (let url of [
      'https://docs.example.com/guide/getting-started-with-the-library',
      'https://en.wikipedia.org/wiki/Boxer_(dog)',
      'https://example.com/search?q=how+to+configure+charts',
      'https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'https://blog.example.com/2024/03/15/release-notes-for-version-12',
      'https://github.com/org/repo/tree/v2/packages/api/src/v2/handlers/page2',
      'https://wiki.example.com/wiki/Page2/Section3/Part4/Chapter5/Appendix6',
    ]) {
      assert.false(carriesEncodedData(url), url);
    }
  });

  test('readUrl asks the model for its reason', () => {
    let parameters = readUrlTool.function.parameters as any;
    assert.deepEqual(parameters.required, ['url', 'reason']);
    assert.strictEqual(parameters.properties.reason.type, 'string');
  });

  test('isApprovalResult recognises only the approved key', () => {
    assert.true(isApprovalResult(result('x', 'approved', USER) as any));
    assert.false(isApprovalResult(result('x', 'applied', BOT) as any));
  });
});
