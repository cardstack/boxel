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
import { isApprovalResult } from '@cardstack/runtime-common/ai';
import {
  collectPreapprovedUrls,
  readUrlCallReleasedByApproval,
  urlsInText,
  READ_URL_TOOL_NAME,
} from '../lib/read-url.ts';
import { toCommandRequest } from '../lib/matrix/response-publisher.ts';

const BOT = '@aibot:localhost';
const USER = '@user:localhost';

function humanMessage(body: string, id = '$human'): DiscreteMatrixEvent {
  return {
    type: 'm.room.message',
    event_id: id,
    sender: USER,
    content: { msgtype: 'app.boxel.message', body },
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

  test('an approval releases the held readUrl call it names', () => {
    let history = [
      humanMessage('Find their docs'),
      botMessage([readUrlRequest('read-1', 'https://docs.example.com/', true)]),
    ];
    let released = readUrlCallReleasedByApproval(
      history,
      result('read-1', 'approved', USER) as any,
      BOT,
    );
    assert.deepEqual(released, {
      call: {
        id: 'read-1',
        type: 'function',
        function: {
          name: READ_URL_TOOL_NAME,
          arguments: JSON.stringify({ url: 'https://docs.example.com/' }),
        },
      },
      requestEventId: '$bot',
    });
  });

  test('an approval releases nothing unless a human approves a held, unsettled readUrl', () => {
    let held = botMessage([
      readUrlRequest('held', 'https://a.example/', true),
      readUrlRequest('not-held', 'https://b.example/'),
      { id: 'host-tool', name: 'patchCard_ab12', arguments: '{}' },
    ]);
    let cases: [string, DiscreteMatrixEvent[], DiscreteMatrixEvent][] = [
      ['sent by the bot', [held], result('held', 'approved', BOT)],
      ['not an approval', [held], result('held', 'applied', USER)],
      [
        'a call not held for approval',
        [held],
        result('not-held', 'approved', USER),
      ],
      ['a host tool', [held], result('host-tool', 'approved', USER)],
      [
        'a call already read',
        [held, result('held', 'applied', BOT)],
        result('held', 'approved', USER),
      ],
      [
        'a call already declined',
        [held, result('held', 'invalid', USER)],
        result('held', 'approved', USER),
      ],
    ];
    for (let [label, history, approval] of cases) {
      assert.strictEqual(
        readUrlCallReleasedByApproval(history, approval as any, BOT),
        undefined,
        label,
      );
    }
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

  test('isApprovalResult recognises only the approved key', () => {
    assert.true(isApprovalResult(result('x', 'approved', USER) as any));
    assert.false(isApprovalResult(result('x', 'applied', BOT) as any));
  });
});
