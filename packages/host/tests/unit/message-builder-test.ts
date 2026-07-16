import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_TOOL_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import { RoomMember } from '@cardstack/host/lib/matrix-classes/member';
import MessageBuilder from '@cardstack/host/lib/matrix-classes/message-builder';

import type { CardMessageEvent } from '@cardstack/base/matrix-event';

module('Unit | matrix | message-builder', function (hooks) {
  setupTest(hooks);

  function builderContext() {
    return {
      roomId: '!room:localhost',
      effectiveEventId: 'event-1',
      author: new RoomMember({ userId: '@aibot:localhost' }),
      index: 0,
      skills: [],
      events: [],
    };
  }

  const streamingEvent = {
    type: 'm.room.message',
    event_id: 'event-1',
    origin_server_ts: 1000,
    sender: '@aibot:localhost',
    status: null,
    content: {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      body: 'Switching to code mode now!',
      isStreamingFinished: false,
    },
  } as unknown as CardMessageEvent;

  test('overlapping updateMessage passes build one MessageTool per tool request', async function (assert) {
    let message = await new MessageBuilder(
      streamingEvent,
      this.owner,
      builderContext(),
    ).buildMessage();
    assert.strictEqual(message.tools.length, 0, 'no tools before the replace');

    let replaceEvent = {
      ...streamingEvent,
      origin_server_ts: 2000,
      content: {
        ...streamingEvent.content,
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [
          {
            id: 'one-request',
            name: 'switch-submode_dd88',
            arguments: JSON.stringify({
              description: 'Switch to code mode',
              attributes: { submode: 'code' },
            }),
          },
        ],
      },
    } as unknown as CardMessageEvent;

    // Two builder passes for the same replace can interleave: each checks
    // for an existing MessageTool for the request id, then awaits
    // buildMessageCommand (which can span network loads resolving the
    // tool's declaring skill) before pushing. Both passes here miss the
    // initial lookup; without the post-await re-check both push, and the
    // duplicate MessageTool never receives its result — results attach to
    // the first match — so its pill spins forever.
    await Promise.all([
      new MessageBuilder(
        replaceEvent,
        this.owner,
        builderContext(),
      ).updateMessage(message),
      new MessageBuilder(
        replaceEvent,
        this.owner,
        builderContext(),
      ).updateMessage(message),
    ]);

    assert.strictEqual(
      message.tools.length,
      1,
      'exactly one MessageTool exists for the request',
    );
    assert.strictEqual(message.tools[0].toolRequest.id, 'one-request');
  });

  test('a tool request chunk without an id yet is not built into a MessageTool', async function (assert) {
    let message = await new MessageBuilder(
      streamingEvent,
      this.owner,
      builderContext(),
    ).buildMessage();

    // The first streamed chunk of a request can arrive before its id. It
    // can't be matched to later chunks or to its result, so building it
    // would strand a permanently-unresolved MessageTool; a later replace
    // always carries the id.
    let idlessReplaceEvent = {
      ...streamingEvent,
      origin_server_ts: 2000,
      content: {
        ...streamingEvent.content,
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [{ name: 'switch-submode_dd88' }],
      },
    } as unknown as CardMessageEvent;

    await new MessageBuilder(
      idlessReplaceEvent,
      this.owner,
      builderContext(),
    ).updateMessage(message);

    assert.strictEqual(
      message.tools.length,
      0,
      'no MessageTool is built until the request has an id',
    );
  });

  test('an id-less tool request chunk is also skipped on the initial build path', async function (assert) {
    // A reload can make the streaming edit the first loaded event for the
    // message, so buildMessage sees the id-less chunk directly.
    let idlessEvent = {
      ...streamingEvent,
      content: {
        ...streamingEvent.content,
        [APP_BOXEL_TOOL_REQUESTS_KEY]: [{ name: 'switch-submode_dd88' }],
      },
    } as unknown as CardMessageEvent;

    let message = await new MessageBuilder(
      idlessEvent,
      this.owner,
      builderContext(),
    ).buildMessage();

    assert.strictEqual(
      message.tools.length,
      0,
      'no MessageTool is built from an id-less chunk on initial build',
    );
  });

  test('an older pass finishing late cannot regress a tool request to stale chunk data', async function (assert) {
    let message = await new MessageBuilder(
      streamingEvent,
      this.owner,
      builderContext(),
    ).buildMessage();

    function replaceEventAt(ts: number, submode: string) {
      return {
        ...streamingEvent,
        origin_server_ts: ts,
        content: {
          ...streamingEvent.content,
          [APP_BOXEL_TOOL_REQUESTS_KEY]: [
            {
              id: 'one-request',
              name: 'switch-submode_dd88',
              arguments: JSON.stringify({
                description: 'Switch submode',
                attributes: { submode },
              }),
            },
          ],
        },
      } as unknown as CardMessageEvent;
    }

    // The newer pass is started first, so it pushes the MessageTool while
    // the older pass is still parked in buildMessageCommand; the older
    // pass's re-check must not overwrite the newer chunk with stale data.
    await Promise.all([
      new MessageBuilder(
        replaceEventAt(3000, 'code'),
        this.owner,
        builderContext(),
      ).updateMessage(message),
      new MessageBuilder(
        replaceEventAt(2000, 'interact'),
        this.owner,
        builderContext(),
      ).updateMessage(message),
    ]);
    assert.strictEqual(message.tools.length, 1, 'still a single MessageTool');
    assert.strictEqual(
      message.tools[0].toolRequest.arguments?.attributes?.submode,
      'code',
      'the newer chunk survives an older overlapping pass',
    );

    // Same for the sequential path: an older event applied after a newer
    // one (out-of-order delivery) must not regress the request either.
    await new MessageBuilder(
      replaceEventAt(1500, 'interact'),
      this.owner,
      builderContext(),
    ).updateMessage(message);
    assert.strictEqual(
      message.tools[0].toolRequest.arguments?.attributes?.submode,
      'code',
      'the newer chunk survives a late-delivered older event',
    );
  });
});
