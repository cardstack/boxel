import { module, test, assert } from 'qunit';
import { getModifyPrompt } from '../helpers';
import { IRoomEvent } from 'matrix-js-sdk';

module('getModifyPrompt', () => {
  test('should generate a prompt from the user', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey',
        },
        sender: '@user:localhost',
      },
    ];

    const result = getModifyPrompt(history, '@ai-bot:localhost');

    // Should have a system prompt and a user prompt
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'user');
    assert.equal(result[1].content, 'Hey');
  });

  test('should generate a more strucutred response if the user uploads a ', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.card',
          body: 'Hey',
          instance: {
            data: {
              type: 'card',
              id: 'http://localhost:4201/drafts/Author/1',
              attributes: {
                firstName: 'Terry',
                lastName: 'Pratchett',
              },
              meta: {
                adoptsFrom: {
                  module: '../author',
                  name: 'Author',
                },
              },
            },
          },
        },
        sender: '@user:localhost',
      },
    ];

    const result = getModifyPrompt(history, '@ai-bot:localhost');

    // Should include the body as well as the card
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'user');
    assert.true(result[1].content?.includes('Hey'));
    assert.true(
      result[1].content?.includes(
        JSON.stringify(history[0].content.instance.data),
      ),
    );
  });

  test('should generate a prompt from the user', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          body: 'Hey',
        },
        sender: '@user:localhost',
      },
    ];

    // Assert raises an exception when we don't use a full id
    assert.throws(() => {
      getModifyPrompt(history, 'ai-bot');
    });
  });
});
