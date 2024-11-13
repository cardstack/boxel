import { module, test, assert } from 'qunit';
import {
  getPatchTool,
  getSearchTool,
} from '@cardstack/runtime-common/helpers/ai';

import {
  getTools,
  getModifyPrompt,
  getRelevantCards,
  SKILL_INSTRUCTIONS_MESSAGE,
} from '../helpers';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
  CardMessageContent,
} from 'https://cardstack.com/base/matrix-event';
import { EventStatus } from 'matrix-js-sdk';
import type { SingleCardDocument } from '@cardstack/runtime-common';
import { CardDef } from 'https://cardstack.com/base/card-api';

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
          msgtype: 'org.boxel.message',
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
      history[0].content.msgtype === 'org.boxel.message'
    ) {
      assert.true(
        result[0].content?.includes(
          JSON.stringify(history[0].content.data.attachedCards![0].data),
        ),
      );
    } else {
      assert.true(
        false,
        'expected "m.room.message" event with a "org.boxel.message" msgtype',
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
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
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
      history[1].content.msgtype === 'org.boxel.message'
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
        'expected "m.room.message" event with a "org.boxel.message" msgtype',
      );
    }
  });

  test('Safely manages cases with no cards', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
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

    const { attachedCards, skillCards } = getRelevantCards(
      history,
      '@aibot:localhost',
    );
    assert.equal(attachedCards.length, 0);
    assert.equal(skillCards.length, 0);
  });

  test('Gets uploaded cards if no shared context', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
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

  test('If there are no functions in the last message from the user, store only searchTool', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'Just a regular message',
          formatted_body: 'Just a regular message',
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
        status: EventStatus.SENT,
      },
    ];
    const functions = getTools(history, '@aibot:localhost');
    assert.equal(functions.length, 1);
    assert.deepEqual(functions[0], getSearchTool());
  });

  test('If a user stops sharing their context then ignore function calls with exception of searchTool', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'Just a regular message',
          formatted_body: 'Just a regular message',
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
    const functions = getTools(history, '@aibot:localhost');
    assert.equal(functions.length, 1);
    assert.deepEqual(functions[0], getSearchTool());
  });

  test("Don't break when there is an older format type with open cards", () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
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
            description: {
              type: 'string',
            },
            attributes: {
              cardId: {
                type: 'string',
                const: 'http://localhost:4201/experiments/Friend/1',
              },
              patch: {
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
          required: ['attributes', 'description'],
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
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/experiments/Friend/1'],
              tools: [
                getPatchTool('http://localhost:4201/experiments/Friend/1', {
                  patch: {
                    attributes: {
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
              cardId: {
                type: 'string',
                const: 'http://localhost:4201/experiments/Friend/1',
              },
            },
            description: {
              type: 'string',
            },
            patch: {
              attributes: {
                firstName: {
                  type: 'string',
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
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'set the location to home',
          formatted_body: 'set the location to home',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/experiments/Meeting/2'],
              tools: [
                getPatchTool('http://localhost:4201/experiments/Meeting/2', {
                  attributes: {
                    location: { type: 'string' },
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
              card_id: {
                type: 'string',
                const: 'http://localhost:4201/experiments/Meeting/2',
              },
              description: {
                type: 'string',
              },
              location: {
                type: 'string',
              },
            },
            required: ['card_id', 'attributes', 'description'],
          },
        },
      });
    }
  });

  {
    const instructions1 =
      "Use pirate colloquialism when responding. End every sentence with 'Arrrr!'";
    const skillCard1: SingleCardDocument = {
      data: {
        type: 'card',
        id: 'http://localhost:4201/experiments/SkillCard/1',
        attributes: {
          title: 'Talk Like a Pirate',
          instructions: instructions1,
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/skill-card',
            name: 'SkillCard',
          },
        },
      },
    };
    const instructions2 = 'Optimize given content for search engines.';
    const skillCard2: SingleCardDocument = {
      data: {
        type: 'card',
        id: 'http://localhost:4201/experiments/SkillCard/2',
        attributes: {
          title: 'SEO',
          instructions: instructions2,
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/skill-card',
            name: 'SkillCard',
          },
        },
      },
    };

    test('should include instructions in system prompt for skill cards', () => {
      const history: DiscreteMatrixEvent[] = [
        {
          type: 'm.room.message',
          event_id: '1',
          origin_server_ts: 1234567890,
          content: {
            msgtype: 'org.boxel.message',
            format: 'org.matrix.custom.html',
            body: 'Hi',
            formatted_body: 'Hi',
            data: {
              context: {
                tools: [],
                submode: undefined,
              },
              skillCards: [skillCard1, skillCard2],
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

      assert.equal(result.length, 2);
      assert.equal(result[0].role, 'system');
      assert.true(result[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
      assert.true(result[0].content?.includes(instructions1));
      assert.true(result[0].content?.includes(instructions2));
      assert.equal(result[1].role, 'user');
      assert.equal(
        result[1].content,
        'User message: Hi\n          Context: the user has no open cards.',
      );
    });

    test('can include both skill cards and attached cards', () => {
      const card: SingleCardDocument = {
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
      };
      const history: DiscreteMatrixEvent[] = [
        {
          type: 'm.room.message',
          event_id: '1',
          origin_server_ts: 1234567890,
          content: {
            msgtype: 'org.boxel.message',
            format: 'org.matrix.custom.html',
            body: 'Hi',
            formatted_body: 'Hi',
            data: {
              context: {
                tools: [],
                submode: undefined,
              },
              skillCards: [skillCard1, skillCard2],
              attachedCards: [card],
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

      const { attachedCards, skillCards } = getRelevantCards(
        history,
        '@ai-bot:localhost',
      );
      assert.equal(attachedCards.length, 1);
      assert.equal(skillCards.length, 2);

      const result = getModifyPrompt(history, '@ai-bot:localhost');
      assert.equal(result[0].role, 'system');
      assert.true(result[0].content?.includes(instructions1));
      assert.true(result[0].content?.includes(instructions2));
      assert.true(result[0].content?.includes(JSON.stringify(card.data)));
    });

    test('should update system prompt based on included skill cards', () => {
      const history: DiscreteMatrixEvent[] = [
        {
          type: 'm.room.message',
          event_id: '1',
          origin_server_ts: 1234567890,
          content: {
            msgtype: 'org.boxel.message',
            format: 'org.matrix.custom.html',
            body: 'Hi',
            formatted_body: 'Hi',
            data: {
              context: {
                tools: [],
                submode: undefined,
              },
              skillCards: [skillCard1],
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

      let { skillCards } = getRelevantCards(history, '@aibot:localhost');
      assert.equal(skillCards.length, 1);

      let result = getModifyPrompt(history, '@aibot:localhost');
      assert.true(result[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
      assert.true(result[0].content?.includes(instructions1));
      assert.false(result[0].content?.includes(instructions2));

      history.push(
        {
          type: 'm.room.message',
          event_id: '2',
          origin_server_ts: 1234567890,
          content: {
            msgtype: 'org.boxel.message',
            format: 'org.matrix.custom.html',
            body: 'Hi',
            formatted_body: 'Hi',
            data: {
              context: {
                tools: [],
                submode: undefined,
              },
              skillCards: [skillCard1, skillCard2],
            },
          },
          sender: '@user:localhost',
          room_id: 'room1',
          unsigned: {
            age: 1000,
            transaction_id: '2',
          },
          status: EventStatus.SENT,
        },
        {
          type: 'm.room.message',
          event_id: '3',
          origin_server_ts: 1234567890,
          content: {
            msgtype: 'm.text',
            format: 'org.matrix.custom.html',
            body: 'How may I assist you?',
            formatted_body: 'How may I assist you?',
            isStreamingFinished: true,
          },
          // ai-bot sends a message
          sender: '@aibot:localhost',
          room_id: 'room1',
          unsigned: {
            age: 1000,
            transaction_id: '3',
          },
          status: EventStatus.SENT,
        },
      );

      skillCards = getRelevantCards(history, '@aibot:localhost').skillCards;
      assert.equal(skillCards.length, 2);

      result = getModifyPrompt(history, '@aibot:localhost');
      assert.true(result[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
      assert.true(result[0].content?.includes(instructions1));
      assert.true(result[0].content?.includes(instructions2));

      history.push({
        type: 'm.room.message',
        event_id: '4',
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
          transaction_id: '4',
        },
        status: EventStatus.SENT,
      });

      skillCards = getRelevantCards(history, '@aibot:localhost').skillCards;
      assert.equal(skillCards.length, 0);

      result = getModifyPrompt(history, '@aibot:localhost');
      assert.false(result[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
      assert.false(result[0].content?.includes(instructions1));
      assert.false(result[0].content?.includes(instructions2));
    });

    test('If there are no skill cards in the last message from the user, remove from system prompt', () => {
      const history: DiscreteMatrixEvent[] = [
        {
          type: 'm.room.message',
          event_id: '1',
          origin_server_ts: 1234567890,
          content: {
            msgtype: 'org.boxel.message',
            format: 'org.matrix.custom.html',
            body: 'Hi',
            formatted_body: 'Hi',
            data: {
              context: {
                tools: [],
                submode: undefined,
              },
              skillCards: [skillCard1, skillCard2],
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
          event_id: '2',
          origin_server_ts: 1234567890,
          content: {
            msgtype: 'org.boxel.message',
            format: 'org.matrix.custom.html',
            body: 'Hey',
            formatted_body: 'Hey',
            data: {
              context: {
                tools: [],
                submode: undefined,
              },
            },
          },
          sender: '@user:localhost',
          room_id: 'room1',
          unsigned: {
            age: 1000,
            transaction_id: '2',
          },
          status: EventStatus.SENT,
        },
      ];

      const { skillCards } = getRelevantCards(history, '@aibot:localhost');
      assert.equal(skillCards.length, 0);

      const result = getModifyPrompt(history, '@aibot:localhost');
      assert.false(result[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
      assert.false(result[0].content?.includes(instructions1));
      assert.false(result[0].content?.includes(instructions2));
    });
  }
  test('should raise an error if skill cards do not pass in an id', () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'Hi',
          formatted_body: 'Hi',
          data: {
            context: {
              tools: [],
              submode: undefined,
            },
            skillCards: [
              {
                data: {
                  type: 'card',
                  attributes: {
                    title: 'SEO',
                    instructions: 'Optimize given content for search engines.',
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
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
        status: EventStatus.SENT,
      },
    ];

    assert.throws(() => {
      getModifyPrompt(history, '@ai-bot:localhost');
    });
  });

  test('Gets only the latest version of skill cards uploaded', () => {
    const instruction = 'Suggest improvements to given content.';
    const updatedInstruction = 'Optimize given content for search engines.';
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'suggest a better title',
          formatted_body: '<p>suggest a better title</p>\n',
          data: {
            skillCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/SkillCard/1',
                  attributes: {
                    title: 'SEO',
                    instructions: instruction,
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
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'suggest a better description',
          formatted_body: 'suggest a better description',
          data: {
            skillCards: [
              {
                data: {
                  type: 'card',
                  id: 'http://localhost:4201/experiments/SkillCard/1',
                  attributes: {
                    title: 'SEO',
                    instructions: updatedInstruction,
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

    const { skillCards } = getRelevantCards(history, '@aibot:localhost');
    assert.equal(skillCards.length, 1);
    if (
      history[1].type === 'm.room.message' &&
      history[1].content.msgtype === 'org.boxel.message'
    ) {
      assert.equal(
        skillCards[0],
        history[1].content.data.skillCards?.[0]['data'],
      );
    } else {
      assert.true(
        false,
        'expected "m.room.message" event with a "org.boxel.message" msgtype',
      );
    }

    const result = getModifyPrompt(history, '@aibot:localhost');
    assert.false(result[0].content?.includes(instruction));
    assert.true(result[0].content?.includes(updatedInstruction));
  });

  test('Create search function calls', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
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
          msgtype: 'org.boxel.message',
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
        origin_server_ts: 1722242833562,
        unsigned: {
          age: 20470,
        },
        event_id: '$p_NQ4tvokzQrIkT24Wj08mdAxBBvmdLOz6ph7UQfMDw',
        user_id: '@tintinthong:localhost',
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
        user_id: '@aibot:localhost',
        age: 17305,
      },
      {
        type: 'm.room.message',
        room_id: 'room-id-1',
        sender: '@tintinthong:localhost',
        content: {
          msgtype: 'org.boxel.message',
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
        user_id: '@tintinthong:localhost',
        age: 6614,
      },
      {
        type: 'm.room.message',
        room_id: 'room-id-1',
        sender: '@ai-bot:localhost',
        content: {
          body: "Search for card instances of type 'Author'",
          msgtype: 'org.boxel.command',
          formatted_body: "Search for card instances of type 'Author'",
          format: 'org.matrix.custom.html',
          data: {
            eventId: 'command-event-id-1',
            toolCall: {
              type: 'function',
              id: 'tool-call-id-1',
              name: 'searchCard',
              arguments: {
                attributes: {
                  description: "Search for card instances of type 'Author'",
                  filter: {
                    type: {
                      module: 'http://localhost:4201/drafts/author',
                      name: 'Author',
                    },
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
        user_id: '@ai-bot:localhost',
        age: 4938,
      },
      {
        type: 'm.room.message',
        room_id: 'room-id-1',
        sender: '@tintinthong:localhost',
        content: {
          'm.relates_to': {
            event_id: 'command-event-id-1',
            rel_type: 'm.annotation',
            key: 'applied',
          },
          body: 'Command Results from command event $H7dH0ZzG0W3M_1k_YRjnDOirWRthYvWq7TKmfAfhQqw',
          formatted_body:
            '<p>Command Results from command event $H7dH0ZzG0W3M_1k_YRjnDOirWRthYvWq7TKmfAfhQqw</p>\n',
          msgtype: 'org.boxel.commandResult',
          result:
            '[{"data":{"type":"card","id":"http://localhost:4201/drafts/Author/1","attributes":{"firstName":"Alice","lastName":"Enwunder","photo":null,"body":"Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.","description":null,"thumbnailURL":null},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}]',
        },
        origin_server_ts: 1722242853988,
        unsigned: {
          age: 44,
        },
        event_id: 'command-result-id-1',
        user_id: '@tintinthong:localhost',
        age: 44,
      },
    ];
    const tools = getTools(history, '@ai-bot:localhost');
    const result = getModifyPrompt(history, '@ai-bot:localhost', tools);
    assert.equal(result[5].role, 'tool');
    assert.equal(result[5].tool_call_id, 'tool-call-id-1');
    assert.equal(
      result[5].content,
      '[{"data":{"type":"card","id":"http://localhost:4201/drafts/Author/1","attributes":{"firstName":"Alice","lastName":"Enwunder","photo":null,"body":"Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.","description":null,"thumbnailURL":null},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}]',
    );
  });
});
