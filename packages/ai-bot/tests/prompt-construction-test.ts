import { module, test, assert } from 'qunit';
import {
  getPatchTool,
  getSearchTool,
} from '@cardstack/runtime-common/helpers/ai';

import {
  getModifyPrompt,
  getPromptParts,
  getRelevantCards,
  getTools,
  SKILL_INSTRUCTIONS_MESSAGE,
} from '../helpers';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  DEFAULT_LLM,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import type {
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
  CardMessageContent,
} from 'https://cardstack.com/base/matrix-event';
import { EventStatus } from 'matrix-js-sdk';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { readFileSync } from 'fs-extra';
import * as path from 'path';

function oldPatchTool(card: CardDef, properties: any): Tool {
  return {
    type: 'function',
    function: {
      name: 'patchCard',
      description: 'description',
      parameters: {
        type: 'object',
        properties: {
          card_id: {
            type: 'string',
            const: card.id,
          },
          description: {
            type: 'string',
          },
          attributes: {
            type: 'object',
            properties: properties,
          },
        },
        required: ['card_id', 'attributes', 'description'],
      },
    },
  };
}

module('getModifyPrompt', () => {
  test('should generate a prompt from the user', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          isStreamingFinished: true,
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
    ];

    const result = await getModifyPrompt(history, '@ai-bot:localhost');

    // Should have a system prompt and a user prompt
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'user');
    assert.equal(
      result[1].content,
      'User message: Hey\n          Context: the user has no open cards.',
    );
  });

  test('should generate a more structured response if the user uploads a card', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          data: {
            context: {
              tools: [],
              submode: undefined,
            },
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Author/1',
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
            ],
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
    ];

    const result = await getModifyPrompt(history, '@ai-bot:localhost');

    // Should include the body as well as the card
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'user');
    assert.true(result[1].content?.includes('Hey'));
    if (
      history[0].type === 'm.room.message' &&
      history[0].content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE
    ) {
      assert.true(
        result[0].content?.includes(
          JSON.stringify(history[0].content.data.attachedCards![0].data),
        ),
      );
    } else {
      assert.true(
        false,
        `expected "m.room.message" event with a "${APP_BOXEL_MESSAGE_MSGTYPE}" msgtype`,
      );
    }
  });

  test('should raise an error if we do not pass in a full id', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          isStreamingFinished: true,
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
    ];

    try {
      await getModifyPrompt(history, 'ai-bot');
      assert.notOk(true, 'should have raised an exception');
    } catch (e) {
      assert.equal(
        (e as Error).message,
        "Username must be a full id, e.g. '@ai-bot:localhost'",
      );
    }
  });

  test('Gets only the latest version of cards uploaded', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
          data: {
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Friend/1',
                  attributes: {
                    firstName: 'Original Name',
                    thumbnailURL: null,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './2',
                      },
                      data: {
                        type: 'card',
                        id: 'http://localhost:4201/experiments/Friend/2',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../friend',
                      name: 'Friend',
                    },
                  },
                },
              },
            ],
            context: {
              tools: [],
              submode: 'interact',
            },
          },
        },
        room_id: 'room1',
        origin_server_ts: 1696813813166,
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        event_id: '1',
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the location to home',
          formatted_body: 'set the location to home',
          data: {
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Friend/1',
                  attributes: {
                    firstName: 'Changed Name',
                    thumbnailURL: null,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './2',
                      },
                      data: {
                        type: 'card',
                        id: 'http://localhost:4201/experiments/Friend/2',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../friend',
                      name: 'Friend',
                    },
                  },
                },
              },
            ],
            context: {
              tools: [],
              submode: 'interact',
            },
          },
        },
        room_id: 'room1',
        origin_server_ts: 1696813813167,
        unsigned: {
          age: 115498,
          transaction_id: '2',
        },
        event_id: '2',
        status: EventStatus.SENT,
      },
    ];

    const { attachedCards, mostRecentlyAttachedCard } = getRelevantCards(
      history,
      '@aibot:localhost',
    );
    assert.equal(attachedCards.length, 1);
    if (
      history[1].type === 'm.room.message' &&
      history[1].content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE
    ) {
      assert.equal(
        attachedCards[0],
        history[1].content.data.attachedCards?.[0]['data'],
      );
      assert.equal(
        mostRecentlyAttachedCard,
        history[1].content.data.attachedCards![0]['data'],
      );
    } else {
      assert.true(
        false,
        `expected "m.room.message" event with a "${APP_BOXEL_MESSAGE_MSGTYPE}" msgtype`,
      );
    }
  });

  test('Safely manages cases with no cards', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
          data: {
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
            },
          },
        },
        room_id: 'room1',
        origin_server_ts: 1696813813166,
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        event_id: '1',
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the location to home',
          formatted_body: 'set the location to home',
          data: {
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
            },
          },
        },
        room_id: 'room1',
        origin_server_ts: 1696813813167,
        unsigned: {
          age: 115498,
          transaction_id: '2',
        },
        event_id: '2',
        status: EventStatus.SENT,
      },
    ];

    const { attachedCards } = getRelevantCards(history, '@aibot:localhost');
    assert.equal(attachedCards.length, 0);
  });

  test('downloads attached files', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey I am attaching a couple of files',
          formatted_body: 'Hey I am attaching a couple of files',
          data: {
            context: {
              tools: [],
              submode: undefined,
            },
            attachedFiles: [
              {
                sourceUrl:
                  'http://test-realm-server/my-realm/spaghetti-recipe.gts',
                url: 'http://test.com/spaghetti-recipe.gts',
                name: 'spaghetti-recipe.gts',
                contentType: 'text/plain',
              },
              {
                sourceUrl: 'http://test-realm-server/my-realm/best-friends.txt',
                url: 'http://test.com/best-friends.txt',
                name: 'best-friends.txt',
                contentType: 'text/plain',
              },
            ],
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        sender: '@ai-bot:localhost',
        content: {
          body: 'Ok. What do you want me to do with these files?',
          msgtype: 'm.text',
          formatted_body: 'Ok. What do you want me to do with these files?',
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
        },
        origin_server_ts: 2,
        unsigned: {
          age: 17305,
          transaction_id: 'm1722242836705.8',
        },
        event_id: '2',
        room_id: 'room1',
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 3,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Nevermind, those files are now outdated, I am attaching new ones',
          formatted_body:
            'Nevermind, those files are now outdated, I am attaching new ones',
          data: {
            context: {
              tools: [],
              submode: undefined,
            },
            attachedFiles: [
              {
                sourceUrl:
                  'http://test-realm-server/my-realm/spaghetti-recipe.gts',
                url: 'http://test.com/spaghetti-recipe.gts',
                name: 'spaghetti-recipe.gts',
                contentType: 'text/plain',
              },
              {
                sourceUrl: 'http://test-realm-server/my-realm/best-friends.txt',
                url: 'http://test.com/best-friends.txt',
                name: 'best-friends.txt',
                contentType: 'text/plain',
              },
              {
                sourceUrl:
                  'http://test.com/my-realm/file-that-does-not-exist.txt',
                url: 'http://test.com/file-that-does-not-exist.txt',
                name: 'file-that-does-not-exist.txt',
                contentType: 'text/plain',
              },
              {
                sourceUrl: 'http://test.com/my-realm/example.pdf',
                url: 'http://test.com/example.pdf',
                name: 'example.pdf',
                contentType: 'application/pdf',
              },
            ],
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
    ];

    // monkey patch fetch so that we can fake file downloads in getModifyPrompt
    const originalFetch = (globalThis as any).fetch;
    let fetchCount = 0;
    (globalThis as any).fetch = async (url: string) => {
      fetchCount++;
      if (url === 'http://test.com/spaghetti-recipe.gts') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            'this is the content of the spaghetti-recipe.gts file',
        };
      } else if (url === 'http://test.com/best-friends.txt') {
        return {
          ok: true,
          status: 200,
          text: async () => 'this is the content of the best-friends.txt file',
        };
      } else if (url === 'http://test.com/file-that-does-not-exist.txt') {
        return {
          ok: false,
          status: 404,
          text: async () => 'Not found',
        };
      }
      return originalFetch(url);
    };

    let prompt = await getModifyPrompt(history, '@aibot:localhost');

    assert.equal(
      fetchCount,
      3,
      'downloads only recently attached files, not older ones',
    );
    assert.ok(
      prompt[0].content?.includes(
        `
Attached files:
spaghetti-recipe.gts: this is the content of the spaghetti-recipe.gts file
best-friends.txt: this is the content of the best-friends.txt file
file-that-does-not-exist.txt: Error loading attached file: HTTP error. Status: 404
example.pdf: Unsupported file type: application/pdf. For now, only text files are supported.
      `.trim(),
      ),
    );
    (globalThis as any).fetch = originalFetch; // restore the original fetch
  });

  test('Gets uploaded cards if no shared context', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          data: {
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Author/1',
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
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
            },
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
    ];
    const { attachedCards } = getRelevantCards(history, '@aibot:localhost');
    assert.equal(attachedCards.length, 1);
  });

  test('Gets multiple uploaded cards', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          data: {
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Author/1',
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
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
            },
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          data: {
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Author/2',
                  attributes: {
                    firstName: 'Mr',
                    lastName: 'T',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../author',
                      name: 'Author',
                    },
                  },
                },
              },
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
            },
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 115498,
          transaction_id: '2',
        },
        status: EventStatus.SENT,
      },
    ];
    const { attachedCards } = getRelevantCards(history, '@aibot:localhost');
    assert.equal(attachedCards.length, 2);
  });

  test('Gets multiple uploaded cards in the system prompt', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          data: {
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Author/1',
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
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
            },
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: '2',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          formatted_body: 'Hey',
          data: {
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Author/2',
                  attributes: {
                    firstName: 'Mr',
                    lastName: 'T',
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../author',
                      name: 'Author',
                    },
                  },
                },
              },
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
            },
          },
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 115498,
          transaction_id: '2',
        },
        status: EventStatus.SENT,
      },
    ];
    const fullPrompt = await getModifyPrompt(history, '@aibot:localhost');
    const systemMessage = fullPrompt.find(
      (message) => message.role === 'system',
    );
    assert.true(
      systemMessage?.content?.includes(
        'http://localhost:4201/experiments/Author/1',
      ),
    );
    assert.true(
      systemMessage?.content?.includes(
        'http://localhost:4201/experiments/Author/2',
      ),
    );
  });

  test('If a user stops sharing their context keep it in the system prompt', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
          data: {
            attachedCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/Friend/1',
                  attributes: {
                    firstName: 'Hassan',
                    thumbnailURL: null,
                  },
                  relationships: {
                    friend: {
                      links: {
                        self: './2',
                      },
                      data: {
                        type: 'card',
                        id: 'http://localhost:4201/experiments/Friend/2',
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: '../friend',
                      name: 'Friend',
                    },
                  },
                },
              },
            ],
            context: {
              openCardIds: ['http://localhost:4201/experiments/Friend/1'],
              submode: 'interact',
              tools: [],
            },
          },
        },
        room_id: 'room1',
        origin_server_ts: 1696813813166,
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        event_id: '1',
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          body: 'Just a regular message',
          formatted_body: 'Just a regular message',
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
        },
        room_id: 'room1',
        origin_server_ts: 1696813813167,
        unsigned: {
          age: 115498,
          transaction_id: '2',
        },
        event_id: '2',
        status: EventStatus.SENT,
      },
    ];
    const { mostRecentlyAttachedCard, attachedCards } = getRelevantCards(
      history,
      '@aibot:localhost',
    );
    assert.equal(attachedCards.length, 1);
    assert.equal(
      attachedCards[0],
      (history[0].content as CardMessageContent).data.attachedCards?.[0][
        'data'
      ],
    );
    assert.equal(
      mostRecentlyAttachedCard,
      (history[0].content as CardMessageContent).data.attachedCards?.[0][
        'data'
      ],
    );
  });

  test("Don't break when there is an older format type with open cards", () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
          data: {
            context: {
              openCards: [
                {
                  data: {
                    type: 'card',
                    id: 'http://localhost:4201/experiments/Friend/1',
                    attributes: {
                      firstName: 'Hassan',
                      thumbnailURL: null,
                    },
                    relationships: {
                      friend: {
                        links: {
                          self: './2',
                        },
                        data: {
                          type: 'card',
                          id: 'http://localhost:4201/experiments/Friend/2',
                        },
                      },
                    },
                    meta: {
                      adoptsFrom: {
                        module: '../friend',
                        name: 'Friend',
                      },
                    },
                  },
                },
              ],
              tools: [
                oldPatchTool(
                  { id: 'http://localhost:4201/experiments/Friend/1' } as any,
                  {
                    firstName: { type: 'string' },
                  },
                ),
              ],
              submode: 'interact',
            },
          },
        },
        room_id: 'room1',
        origin_server_ts: 1696813813166,
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
        status: EventStatus.SENT,
      },
    ];

    const functions = getTools(history, [], '@aibot:localhost');
    assert.equal(functions.length, 1);
    assert.deepEqual(functions[0], {
      type: 'function',
      function: {
        name: 'patchCard',
        description: 'description',
        parameters: {
          type: 'object',
          properties: {
            card_id: {
              type: 'string',
              const: 'http://localhost:4201/experiments/Friend/1',
            },
            description: {
              type: 'string',
            },
            attributes: {
              type: 'object',
              properties: {
                firstName: {
                  type: 'string',
                },
              },
            },
          },
          required: ['card_id', 'attributes', 'description'],
        },
      },
    });
  });

  test('Create patch function calls when there is a cardSpec', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/experiments/Friend/1'],
              tools: [
                getPatchTool('http://localhost:4201/experiments/Friend/1', {
                  attributes: {
                    type: 'object',
                    properties: {
                      firstName: { type: 'string' },
                    },
                  },
                }),
              ],
              submode: 'interact',
            },
          },
        },
        origin_server_ts: 1696813813166,
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        room_id: 'room1',
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
        status: EventStatus.SENT,
      },
    ];

    const functions = getTools(history, [], '@aibot:localhost');
    assert.equal(functions.length, 1);
    assert.deepEqual(functions[0], {
      type: 'function',
      function: {
        name: 'patchCard',
        description:
          'Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.',
        parameters: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
            },
            attributes: {
              type: 'object',
              properties: {
                cardId: {
                  type: 'string',
                  const: 'http://localhost:4201/experiments/Friend/1',
                },
                patch: {
                  type: 'object',
                  properties: {
                    attributes: {
                      type: 'object',
                      properties: {
                        firstName: {
                          type: 'string',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          required: ['attributes', 'description'],
        },
      },
    });
  });

  test('Gets only the latest functions', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/experiments/Friend/1'],
              tools: [
                getPatchTool('http://localhost:4201/experiments/Friend/1', {
                  attributes: {
                    firstName: { type: 'string' },
                  },
                }),
              ],
              submode: 'interact',
            },
          },
        },
        room_id: 'room1',
        origin_server_ts: 1696813813166,
        unsigned: {
          age: 115498,
          transaction_id: '1',
        },
        event_id: '1',
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the location to home',
          formatted_body: 'set the location to home',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/experiments/Meeting/2'],
              tools: [
                getPatchTool('http://localhost:4201/experiments/Meeting/2', {
                  attributes: {
                    type: 'object',
                    properties: {
                      location: { type: 'string' },
                    },
                  },
                }),
              ],
              submode: 'interact',
            },
          },
        },
        room_id: 'room1',
        origin_server_ts: 1696813813167,
        unsigned: {
          age: 115498,
          transaction_id: '2',
        },
        event_id: '2',
        status: EventStatus.SENT,
      },
    ];

    const functions = getTools(history, [], '@aibot:localhost');
    assert.equal(functions.length, 1);
    if (functions.length > 0) {
      assert.deepEqual(functions[0], {
        type: 'function',
        function: {
          name: 'patchCard',
          description:
            'Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.',
          parameters: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
              },
              attributes: {
                type: 'object',
                properties: {
                  cardId: {
                    type: 'string',
                    const: 'http://localhost:4201/experiments/Meeting/2',
                  },
                  patch: {
                    type: 'object',
                    properties: {
                      attributes: {
                        type: 'object',
                        properties: {
                          location: {
                            type: 'string',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            required: ['attributes', 'description'],
          },
        },
      });
    }
  });

  test('should include instructions in system prompt for skill cards', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/added-skill.json'),
        'utf-8',
      ),
    );

    const result = (await getPromptParts(eventList, '@ai-bot:localhost'))
      .messages!;
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.true(result[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(result[0].content?.includes('['));
    assert.true(
      result[0].content?.includes(
        'If the user wants the data they see edited, AND the patchCard function is available',
      ),
    );
    assert.true(
      result[0].content?.includes(
        'Given a prompt, fill in the product requirements document.',
      ),
    );
  });

  test('can include both skill cards and attached cards', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/added-skill-and-attached-card.json',
        ),
        'utf-8',
      ),
    );

    const result = (await getPromptParts(eventList, '@ai-bot:localhost'))
      .messages;

    const { attachedCards } = getRelevantCards(eventList, '@ai-bot:localhost');
    assert.equal(attachedCards.length, 1);

    assert.equal(result[0].role, 'system');
    assert.true(result[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.true(
      result[0].content?.includes(
        'If the user wants the data they see edited, AND the patchCard function is available',
      ),
    );
    assert.true(
      result[0].content?.includes('Use pirate colloquialism when responding.'),
    );
    assert.true(
      result[0].content?.includes(
        'attributes":{"appTitle":"Radio Episode Tracker for Nerds"',
      ),
    );
  });

  test('should update system prompt with only active skills', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/added-two-skills-removed-one-skill.json',
        ),
        'utf-8',
      ),
    );
    const { messages } = await getPromptParts(eventList, '@aibot:localhost');
    assert.true(messages.length > 0);
    assert.true(messages[0].role === 'system');
    let systemPrompt = messages[0].content;
    assert.true(systemPrompt?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(systemPrompt?.includes('SKILL_1'));
    assert.true(systemPrompt?.includes('SKILL_2'));
  });

  test('If there are no skill cards active in the latest matrix room state, remove from system prompt', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/added-two-skills-removed-two-skills.json',
        ),
        'utf-8',
      ),
    );
    const { messages } = await getPromptParts(eventList, '@aibot:localhost');
    assert.true(messages.length > 0);
    assert.true(messages[0].role === 'system');
    let systemPrompt = messages[0].content;
    assert.false(systemPrompt?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(systemPrompt?.includes('SKILL_1'));
    assert.false(systemPrompt?.includes('SKILL_2'));
  });
});

test('should support skill cards without ids', async () => {
  // The responsibility of handling deduplication/etc of skill cards
  // lies with the host application, the AI bot should not need to
  // handle that.
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(__dirname, 'resources/chats/skill-card-no-id.json'),
      'utf-8',
    ),
  );
  const { messages } = await getPromptParts(eventList, '@aibot:localhost');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.true(messages[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
  assert.true(messages[0].content?.includes('Skill Instructions'));
});

test('Has the skill card specified by the last state update, even if there are other skill cards with the same id', async () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/two-messages-with-same-skill-card.json',
      ),
      'utf-8',
    ),
  );
  const { messages } = await getPromptParts(eventList, '@aibot:localhost');
  assert.true(messages.length > 0);
  assert.equal(messages[0].role, 'system');
  assert.true(messages[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
  assert.false(messages[0].content?.includes('SKILL_INSTRUCTIONS_V1'));
  assert.true(messages[0].content?.includes('SKILL_INSTRUCTIONS_V2'));
});

test('if tool calls are required, ensure they are set', async () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(__dirname, 'resources/chats/forced-function-call.json'),
      'utf-8',
    ),
  );

  const { messages, tools, toolChoice } = await getPromptParts(
    eventList,
    '@ai-bot:localhost',
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[1].role, 'user');
  assert.true(tools.length === 1);
  assert.deepEqual(toolChoice, {
    type: 'function',
    function: {
      name: 'NeverCallThisPlease_hEhhctZntkzJkySR5Uvsq6',
    },
  });
});

test('Create search function calls', () => {
  const history: DiscreteMatrixEvent[] = [
    {
      type: 'm.room.message',
      room_id: 'room-id-1',
      sender: '@ian:localhost',
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body: 'set the name to dave',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>set the name to dave</p>\n',
        data: {
          context: {
            openCardIds: ['http://localhost:4201/drafts/Friend/1'],
            tools: [getSearchTool()],
            submode: 'interact',
          },
        },
      },
      origin_server_ts: 1696813813166,
      unsigned: {
        age: 115498,
        transaction_id: 'm1722242836705.8',
      },
      event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
      status: EventStatus.SENT,
    },
  ];

  const functions = getTools(history, [], '@aibot:localhost');
  assert.equal(functions.length, 1);
  assert.deepEqual(functions[0], getSearchTool());
});

test('Return host result of tool call back to open ai', async () => {
  const history: DiscreteMatrixEvent[] = [
    {
      type: 'm.room.message',
      room_id: 'room-id-1',
      sender: '@tintinthong:localhost',
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body: 'search for the following card instances',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>search for the following card instances</p>\n',
        clientGeneratedId: '5bb0493e-64a3-4d8b-a99a-722daf084bee',
        data: {
          attachedCardsEventIds: ['attched-card-event-id'],
          attachedSkillEventIds: ['attached-skill-event-id-1'],
          context: {
            openCardIds: ['http://localhost:4201/drafts/Author/1'],
            tools: [
              {
                type: 'function',
                function: {
                  name: 'patchCard',
                  description:
                    'Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.',
                  parameters: {
                    type: 'object',
                    properties: {
                      card_id: {
                        type: 'string',
                        const: 'http://localhost:4201/drafts/Author/1',
                      },
                      description: {
                        type: 'string',
                      },
                      attributes: {
                        type: 'object',
                        properties: {
                          firstName: {
                            type: 'string',
                          },
                          lastName: {
                            type: 'string',
                          },
                          photo: {
                            type: 'string',
                          },
                          body: {
                            type: 'string',
                          },
                          description: {
                            type: 'string',
                          },
                          thumbnailURL: {
                            type: 'string',
                          },
                        },
                      },
                    },
                    required: ['card_id', 'attributes', 'description'],
                  },
                },
              },
              getSearchTool(),
            ],
            submode: 'interact',
          },
          attachedCards: [
            {
              data: {
                type: 'card',
                id: 'http://localhost:4201/drafts/Author/1',
                attributes: {
                  firstName: 'Alice',
                  lastName: 'Enwunder',
                  photo: null,
                  body: 'Alice is a software engineer at Google.',
                  description: null,
                  thumbnailURL: null,
                },
                meta: {
                  adoptsFrom: {
                    module: 'http://localhost:4201/drafts/author',
                    name: 'Author',
                  },
                },
              },
            },
          ],
          skillCards: [
            {
              data: {
                type: 'card',
                id: 'https://cardstack.com/base/SkillCard/card-editing',
                attributes: {
                  instructions:
                    '- If the user wants the data they see edited, AND the patchCard function is available, you MUST use the "patchCard" function to make the change.\n- If the user wants the data they see edited, AND the patchCard function is NOT available, you MUST ask the user to open the card and share it with you.\n- If you do not call patchCard, the user will not see the change.\n- You can ONLY modify cards shared with you. If there is no patchCard function or tool, then the user hasn\'t given you access.\n- NEVER tell the user to use patchCard; you should always do it for them.\n- If the user wants to search for a card instance, AND the "searchCardsByTypeAndTitle" function is available, you MUST use the "searchCardsByTypeAndTitle" function to find the card instance.\nOnly recommend one searchCardsByTypeAndTitle function at a time.\nIf the user wants to edit a field of a card, you can optionally use "searchCard" to help find a card instance that is compatible with the field being edited before using "patchCard" to make the change of the field.\n You MUST confirm with the user the correct choice of card instance that he intends to use based upon the results of the search.',
                  title: 'Card Editing',
                  description: null,
                  thumbnailURL: null,
                },
                meta: {
                  adoptsFrom: {
                    module: 'https://cardstack.com/base/skill-card',
                    name: 'SkillCard',
                  },
                },
              },
            },
          ],
        },
      },
      origin_server_ts: 1722242833562,
      unsigned: {
        age: 20470,
        transaction_id: 'm1722242836705.1',
      },
      event_id: '$p_NQ4tvokzQrIkT24Wj08mdAxBBvmdLOz6ph7UQfMDw',
      status: EventStatus.SENT,
    },
    {
      type: 'm.room.message',
      room_id: 'room-id-1',
      sender: '@ai-bot:localhost',
      content: {
        body: 'It looks like you want to search for card instances based on the "Author" card you provided. Just for clarity, would you like to search for more cards based on the "Author" module type or something else specific?\n\nFor example, do you want to find all card instances of type "Author" or a different type of card/module?',
        msgtype: 'm.text',
        formatted_body:
          'It looks like you want to search for card instances based on the "Author" card you provided. Just for clarity, would you like to search for more cards based on the "Author" module type or something else specific?\n\nFor example, do you want to find all card instances of type "Author" or a different type of card/module?',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'message-event-id-1',
        },
      },
      origin_server_ts: 1722242836727,
      unsigned: {
        age: 17305,
        transaction_id: 'm1722242836705.2',
      },
      event_id: 'message-event-id-1',
      status: EventStatus.SENT,
    },
    {
      type: 'm.room.message',
      room_id: 'room-id-1',
      sender: '@tintinthong:localhost',
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body: 'yes module type',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>yes module type</p>\n',
        clientGeneratedId: 'd93c899f-9123-4b31-918c-a525afb40a7e',
        data: {
          attachedCardsEventIds: ['attched-card-event-id'],
          attachedSkillEventIds: ['attached-skill-event-id-1'],
          context: {
            openCardIds: ['http://localhost:4201/drafts/Author/1'],
            tools: [
              {
                type: 'function',
                function: {
                  name: 'patchCard',
                  description:
                    'Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.',
                  parameters: {
                    type: 'object',
                    properties: {
                      card_id: {
                        type: 'string',
                        const: 'http://localhost:4201/drafts/Author/1',
                      },
                      description: {
                        type: 'string',
                      },
                      attributes: {
                        type: 'object',
                        properties: {
                          firstName: {
                            type: 'string',
                          },
                          lastName: {
                            type: 'string',
                          },
                          photo: {
                            type: 'string',
                          },
                          body: {
                            type: 'string',
                          },
                          description: {
                            type: 'string',
                          },
                          thumbnailURL: {
                            type: 'string',
                          },
                        },
                      },
                    },
                    required: ['card_id', 'attributes', 'description'],
                  },
                },
              },
              getSearchTool(),
            ],
            submode: 'interact',
          },
          attachedCards: [
            {
              data: {
                type: 'card',
                id: 'http://localhost:4201/drafts/Author/1',
                attributes: {
                  firstName: 'Alice',
                  lastName: 'Enwunder',
                  photo: null,
                  body: 'Alice is a software engineer at Google.',
                  description: null,
                  thumbnailURL: null,
                },
                meta: {
                  adoptsFrom: {
                    module: 'http://localhost:4201/drafts/author',
                    name: 'Author',
                  },
                },
              },
            },
          ],
          skillCards: [
            {
              data: {
                type: 'card',
                id: 'https://cardstack.com/base/SkillCard/card-editing',
                attributes: {
                  instructions:
                    '- If the user wants the data they see edited, AND the patchCard function is available, you MUST use the "patchCard" function to make the change.\n- If the user wants the data they see edited, AND the patchCard function is NOT available, you MUST ask the user to open the card and share it with you.\n- If you do not call patchCard, the user will not see the change.\n- You can ONLY modify cards shared with you. If there is no patchCard function or tool, then the user hasn\'t given you access.\n- NEVER tell the user to use patchCard; you should always do it for them.\n- If the user wants to search for a card instance, AND the "searchCard" function is available, you MUST use the "searchCard" function to find the card instance.\nOnly recommend one searchCard function at a time.\nIf the user wants to edit a field of a card, you can optionally use "searchCard" to help find a card instance that is compatible with the field being edited before using "patchCard" to make the change of the field.\n You MUST confirm with the user the correct choice of card instance that he intends to use based upon the results of the search.',
                  title: 'Card Editing',
                  description: null,
                  thumbnailURL: null,
                },
                meta: {
                  adoptsFrom: {
                    module: 'https://cardstack.com/base/skill-card',
                    name: 'SkillCard',
                  },
                },
              },
            },
          ],
        },
      },
      origin_server_ts: 1722242847418,
      unsigned: {
        age: 6614,
        transaction_id: 'm1722242836705.3',
      },
      event_id: '$FO2XfB0xFiTpm5FmOUiWQqFh_DPQSr4zix41Vj3eqNc',
      status: EventStatus.SENT,
    },
    {
      type: 'm.room.message',
      room_id: 'room-id-1',
      sender: '@ai-bot:localhost',
      content: {
        body: "Search for card instances of type 'Author'",
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        formatted_body: "Search for card instances of type 'Author'",
        format: 'org.matrix.custom.html',
        [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
          {
            id: 'tool-call-id-1',
            name: 'searchCardsByTypeAndTitle',
            arguments: {
              attributes: {
                description: "Search for card instances of type 'Author'",
                type: {
                  module: 'http://localhost:4201/drafts/author',
                  name: 'Author',
                },
              },
            },
          },
        ],
      },
      origin_server_ts: 1722242849094,
      unsigned: {
        age: 4938,
        transaction_id: 'm1722242849075.10',
      },
      event_id: 'command-event-id-1',
      status: EventStatus.SENT,
    },
    {
      type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      room_id: 'room-id-1',
      sender: '@tintinthong:localhost',
      content: {
        'm.relates_to': {
          event_id: 'command-event-id-1',
          rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          key: 'applied',
        },
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
        commandRequestId: 'tool-call-id-1',
        data: {
          card: {
            data: {
              type: 'card',
              attributes: {
                title: 'Search Results',
                description: 'Here are the search results',
                results: [
                  {
                    data: {
                      type: 'card',
                      id: 'http://localhost:4201/drafts/Author/1',
                      attributes: {
                        firstName: 'Alice',
                        lastName: 'Enwunder',
                        photo: null,
                        body: 'Alice is a software engineer at Google.',
                        description: null,
                        thumbnailURL: null,
                      },
                      meta: {
                        adoptsFrom: { module: '../author', name: 'Author' },
                      },
                    },
                  },
                ],
              },
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/search-results',
                  name: 'SearchResults',
                },
              },
            },
          },
        },
      },
      origin_server_ts: 1722242853988,
      unsigned: {
        age: 44,
        transaction_id: 'm1722242836705.4',
      },
      event_id: 'command-result-id-1',
      status: EventStatus.SENT,
    },
  ];
  const tools = getTools(history, [], '@ai-bot:localhost');
  const result = await getModifyPrompt(history, '@ai-bot:localhost', tools);
  assert.equal(result[5].role, 'tool');
  assert.equal(result[5].tool_call_id, 'tool-call-id-1');
  const expected = `Command applied, with result card: {"data":{"type":"card","attributes":{"title":"Search Results","description":"Here are the search results","results":[{"data":{"type":"card","id":"http://localhost:4201/drafts/Author/1","attributes":{"firstName":"Alice","lastName":"Enwunder","photo":null,"body":"Alice is a software engineer at Google.","description":null,"thumbnailURL":null},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}]},"meta":{"adoptsFrom":{"module":"https://cardstack.com/base/search-results","name":"SearchResults"}}}}.`;

  assert.equal(result[5].content!.trim(), expected.trim());
});

test('Tools remain available in prompt parts even when not in last message', async () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/required-tools-multiple-messages.json',
      ),
      'utf-8',
    ),
  );

  const { messages, tools } = await getPromptParts(
    eventList,
    '@aibot:localhost',
  );
  assert.true(tools.length > 0, 'Should have tools available');
  assert.true(messages.length > 0, 'Should have messages');

  // Verify that the tools array contains the expected functions
  const alertTool = tools.find(
    (tool) => tool.function?.name === 'AlertTheUser_pcDFLKJ9auSJQfSovb3LT2',
  );
  assert.ok(alertTool, 'Should have AlertTheUser function available');
});

test('Tools are not required unless they are in the last message', async () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/required-tools-multiple-messages.json',
      ),
      'utf-8',
    ),
  );

  const { toolChoice } = await getPromptParts(eventList, '@aibot:localhost');
  assert.equal(toolChoice, 'auto');
});

test('Tools can be required to be called if done so in the last message', async () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/required-tool-call-in-last-message.json',
      ),
      'utf-8',
    ),
  );

  const { toolChoice } = await getPromptParts(eventList, '@aibot:localhost');
  assert.deepEqual(toolChoice, {
    type: 'function',
    function: {
      name: 'AlertTheUser_pcDFLKJ9auSJQfSovb3LT2',
    },
  });
});

test('Tools calls are connected to their results', async () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/connect-tool-calls-to-results.json',
      ),
      'utf-8',
    ),
  );

  const { messages } = await getPromptParts(eventList, '@aibot:localhost');
  // find the message with the tool call and its id
  // it should have the result deserialised
  const toolCallMessage = messages!.find((message) => message.role === 'tool');
  assert.ok(toolCallMessage, 'Should have a tool call message');
  assert.ok(
    toolCallMessage!.content!.includes('Cloudy'),
    'Tool call result should include "Cloudy"',
  );
});

test('Does not respond to first tool call result when two tool calls were made', async function () {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(__dirname, 'resources/chats/two-tool-calls-one-result.json'),
      'utf-8',
    ),
  );

  const { shouldRespond } = await getPromptParts(eventList, '@aibot:localhost');
  assert.strictEqual(
    shouldRespond,
    false,
    'AiBot does not solicit a response before all tool calls are made',
  );
});

test('Responds to second tool call result when two tool calls were made', async function () {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(__dirname, 'resources/chats/two-tool-calls-two-results.json'),
      'utf-8',
    ),
  );

  const { shouldRespond, messages } = await getPromptParts(
    eventList,
    '@aibot:localhost',
  );
  assert.strictEqual(shouldRespond, true, 'AiBot should solicit a response');
  // tool call results should be deserialised
  const toolCallMessages = messages!.filter(
    (message) => message.role === 'tool',
  );
  assert.strictEqual(
    toolCallMessages.length,
    2,
    'Should have two tool call messages',
  );
  assert.ok(
    toolCallMessages[0].content!.includes('Cloudy'),
    'Tool call result should include "Cloudy"',
  );
  assert.ok(
    toolCallMessages[1].content!.includes('Sunny'),
    'Tool call result should include "Sunny"',
  );
});

test('Tools on enabled skills are available in prompt', async () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(__dirname, 'resources/chats/enabled-skill-with-commands.json'),
    ),
  );

  const { tools } = await getPromptParts(eventList, '@aibot:localhost');
  assert.true(tools.length > 0, 'Should have tools available');

  // Verify that the tools array contains the command from the skill
  const switchSubmodeTool = tools.find(
    (tool) => tool.function?.name === 'switch-submode_dd88',
  );
  assert.ok(
    switchSubmodeTool,
    'Should have SwitchSubmodeCommand function available',
  );
});

test('No tools are available if skill is not enabled', async () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(__dirname, 'resources/chats/disabled-skill-with-commands.json'),
    ),
  );

  const { tools } = await getPromptParts(eventList, '@aibot:localhost');
  // we should not have any tools available
  assert.true(tools.length == 0, 'Should not have tools available');
});

module('set model in prompt', () => {
  test('default active LLM must be equal to `DEFAULT_LLM`', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/required-tool-call-in-last-message.json',
        ),
        'utf-8',
      ),
    );

    const { model } = await getPromptParts(eventList, '@aibot:localhost');
    assert.strictEqual(model, DEFAULT_LLM);
  });

  test('use latest active llm', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/set-active-llm.json'),
        'utf-8',
      ),
    );

    const { model } = await getPromptParts(eventList, '@aibot:localhost');
    assert.strictEqual(model, 'google/gemini-pro-1.5');
  });
});
