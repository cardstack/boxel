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
});
