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
  APP_BOXEL_COMMAND_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import type {
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
  CardMessageContent,
} from 'https://cardstack.com/base/matrix-event';
import { EventStatus, IRoomEvent } from 'matrix-js-sdk';
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
  test('should generate a prompt from the user', () => {
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

    const result = getModifyPrompt(history, '@ai-bot:localhost');

    // Should have a system prompt and a user prompt
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'user');
    assert.equal(
      result[1].content,
      'User message: Hey\n          Context: the user has no open cards.',
    );
  });

  test('should generate a more structured response if the user uploads a card', () => {
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

    const result = getModifyPrompt(history, '@ai-bot:localhost');

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

  test('should raise an error if we do not pass in a full id', () => {
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

    // Assert raises an exception when we don't use a full id
    assert.throws(() => {
      getModifyPrompt(history, 'ai-bot');
    });
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

  test('Gets multiple uploaded cards in the system prompt', () => {
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
    const fullPrompt = getModifyPrompt(history, '@aibot:localhost');
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
              // @ts-expect-error purposefully using old format
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

    const functions = getTools(history, '@aibot:localhost');
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

    const functions = getTools(history, '@aibot:localhost');
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
          required: ['attributes'],
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

    const functions = getTools(history, '@aibot:localhost');
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
            required: ['attributes'],
          },
        },
      });
    }
  });

  test('should include instructions in system prompt for skill cards', () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(path.join(__dirname, 'resources/chats/added-skill.json')),
    );

    const result = getPromptParts(eventList, '@ai-bot:localhost').messages;
    assert.equal(result.length, 1);
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

  test('can include both skill cards and attached cards', () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/added-skill-and-attached-card.json',
        ),
      ),
    );

    const result = getPromptParts(eventList, '@ai-bot:localhost').messages;

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

  test('should update system prompt with only active skills', () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/added-two-skills-removed-one-skill.json',
        ),
      ),
    );
    const { messages } = getPromptParts(eventList, '@aibot:localhost');
    assert.true(messages.length > 0);
    assert.true(messages[0].role === 'system');
    let systemPrompt = messages[0].content;
    assert.true(systemPrompt?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(systemPrompt?.includes('SKILL_1'));
    assert.true(systemPrompt?.includes('SKILL_2'));
  });

  test('If there are no skill cards active in the latest matrix room state, remove from system prompt', () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/added-two-skills-removed-two-skills.json',
        ),
      ),
    );
    const { messages } = getPromptParts(eventList, '@aibot:localhost');
    assert.true(messages.length > 0);
    assert.true(messages[0].role === 'system');
    let systemPrompt = messages[0].content;
    assert.false(systemPrompt?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(systemPrompt?.includes('SKILL_1'));
    assert.false(systemPrompt?.includes('SKILL_2'));
  });
});

test('should support skill cards without ids', () => {
  // The responsibility of handling deduplication/etc of skill cards
  // lies with the host application, the AI bot should not need to
  // handle that.
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(path.join(__dirname, 'resources/chats/skill-card-no-id.json')),
  );
  const { messages } = getPromptParts(eventList, '@aibot:localhost');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.true(messages[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
  assert.true(messages[0].content?.includes('Skill Instructions'));
});

test('Has the skill card specified by the last state update, even if there are other skill cards with the same id', () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/two-messages-with-same-skill-card.json',
      ),
    ),
  );
  const { messages } = getPromptParts(eventList, '@aibot:localhost');
  assert.true(messages.length > 0);
  assert.equal(messages[0].role, 'system');
  console.log(messages[0].content);
  assert.true(messages[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
  assert.false(messages[0].content?.includes('SKILL_INSTRUCTIONS_V1'));
  assert.true(messages[0].content?.includes('SKILL_INSTRUCTIONS_V2'));
});

test('if tool calls are required, ensure they are set', () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(__dirname, 'resources/chats/forced-function-call.json'),
    ),
  );

  const { messages, tools, toolChoice } = getPromptParts(
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
  const history: IRoomEvent[] = [
    {
      type: 'm.room.message',
      sender: '@ian:localhost',
      content: {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        body: 'set the name to dave',
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
      },
      event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
      age: 115498,
    },
  ];

  const functions = getTools(history, '@aibot:localhost');
  assert.equal(functions.length, 1);
  assert.deepEqual(functions[0], getSearchTool());
});

test('Return host result of tool call back to open ai', () => {
  const history: IRoomEvent[] = [
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
                  body: 'Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.',
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
      },
      event_id: '$p_NQ4tvokzQrIkT24Wj08mdAxBBvmdLOz6ph7UQfMDw',
      age: 20470,
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
        'm.new_content': {
          body: 'It looks like you want to search for card instances based on the "Author" card you provided. Just for clarity, would you like to search for more cards based on the "Author" module type or something else specific?\n\nFor example, do you want to find all card instances of type "Author" or a different type of card/module?',
          msgtype: 'm.text',
          formatted_body:
            'It looks like you want to search for card instances based on the "Author" card you provided. Just for clarity, would you like to search for more cards based on the "Author" module type or something else specific?\n\nFor example, do you want to find all card instances of type "Author" or a different type of card/module?',
          format: 'org.matrix.custom.html',
        },
        isStreamingFinished: true,
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'message-event-id-1',
        },
      },
      origin_server_ts: 1722242836727,
      unsigned: {
        age: 17305,
        transaction_id: 'm1722242836705.8',
      },
      event_id: 'message-event-id-1',
      age: 17305,
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
                  body: 'Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.',
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
      },
      event_id: '$FO2XfB0xFiTpm5FmOUiWQqFh_DPQSr4zix41Vj3eqNc',
      age: 6614,
    },
    {
      type: 'm.room.message',
      room_id: 'room-id-1',
      sender: '@ai-bot:localhost',
      content: {
        body: "Search for card instances of type 'Author'",
        msgtype: APP_BOXEL_COMMAND_MSGTYPE,
        formatted_body: "Search for card instances of type 'Author'",
        format: 'org.matrix.custom.html',
        data: {
          eventId: 'command-event-id-1',
          toolCall: {
            type: 'function',
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
        },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: 'command-event-id-1',
        },
      },
      origin_server_ts: 1722242849094,
      unsigned: {
        age: 4938,
        transaction_id: 'm1722242849075.10',
      },
      event_id: 'command-event-id-1',
      age: 4938,
    },
    {
      type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
      room_id: 'room-id-1',
      sender: '@tintinthong:localhost',
      content: {
        'm.relates_to': {
          event_id: 'command-event-id-1',
          rel_type: 'm.annotation',
          key: 'applied',
        },
        msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
        data: {
          card: JSON.stringify({
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
                        body: 'Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.',
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
            },
          }),
        },
      },
      origin_server_ts: 1722242853988,
      unsigned: {
        age: 44,
      },
      event_id: 'command-result-id-1',
      age: 44,
    },
  ];
  const tools = getTools(history, '@ai-bot:localhost');
  const result = getModifyPrompt(history, '@ai-bot:localhost', tools);
  assert.equal(result[5].role, 'tool');
  assert.equal(result[5].tool_call_id, 'tool-call-id-1');
  const expected = `Command applied, with result card: "{\\"data\\":{\\"type\\":\\"card\\",\\"attributes\\":{\\"title\\":\\"Search Results\\",\\"description\\":\\"Here are the search results\\",\\"results\\":[{\\"data\\":{\\"type\\":\\"card\\",\\"id\\":\\"http://localhost:4201/drafts/Author/1\\",\\"attributes\\":{\\"firstName\\":\\"Alice\\",\\"lastName\\":\\"Enwunder\\",\\"photo\\":null,\\"body\\":\\"Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.\\",\\"description\\":null,\\"thumbnailURL\\":null},\\"meta\\":{\\"adoptsFrom\\":{\\"module\\":\\"../author\\",\\"name\\":\\"Author\\"}}}}]}}}".\n`;
  assert.equal(result[5].content, expected);
});

test('Tools remain available in prompt parts even when not in last message', () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/required-tools-multiple-messages.json',
      ),
    ),
  );

  const { messages, tools } = getPromptParts(eventList, '@aibot:localhost');
  assert.true(tools.length > 0, 'Should have tools available');
  assert.true(messages.length > 0, 'Should have messages');

  // Verify that the tools array contains the expected functions
  const alertTool = tools.find(
    (tool) => tool.function?.name === 'AlertTheUser_pcDFLKJ9auSJQfSovb3LT2',
  );
  assert.ok(alertTool, 'Should have AlertTheUser function available');
});

test('Tools are not required unless they are in the last message', () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/required-tools-multiple-messages.json',
      ),
    ),
  );

  const { toolChoice } = getPromptParts(eventList, '@aibot:localhost');
  assert.equal(toolChoice, 'auto');
});

test('Tools can be required to be called if done so in the last message', () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/required-tool-call-in-last-message.json',
      ),
    ),
  );

  const { toolChoice } = getPromptParts(eventList, '@aibot:localhost');
  assert.deepEqual(toolChoice, {
    type: 'function',
    function: {
      name: 'AlertTheUser_pcDFLKJ9auSJQfSovb3LT2',
    },
  });
});

test('Tools calls are connected to their results', () => {
  const eventList: DiscreteMatrixEvent[] = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        'resources/chats/connect-tool-calls-to-results.json',
      ),
    ),
  );

  const { messages } = getPromptParts(eventList, '@aibot:localhost');
  // find the message with the tool call and its id
  // it should have the result deserialised
  const toolCallMessage = messages.find((message) => message.role === 'tool');
  assert.ok(toolCallMessage, 'Should have a tool call message');
  assert.ok(
    toolCallMessage!.content!.includes('Cloudy'),
    'Tool call result should include "Cloudy"',
  );
});

module('set model in prompt', () => {
  test('default active LLM must be equal to `DEFAULT_LLM`', () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/required-tool-call-in-last-message.json',
        ),
      ),
    );

    const { model } = getPromptParts(eventList, '@aibot:localhost');
    assert.strictEqual(model, DEFAULT_LLM);
  });

  test('use latest active llm', () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(path.join(__dirname, 'resources/chats/set-active-llm.json')),
    );

    const { model } = getPromptParts(eventList, '@aibot:localhost');
    assert.strictEqual(model, 'google/gemini-pro-1.5');
  });
});
