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
    assert.equal(result[1].content, 'Hey');
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
                  id: 'http://localhost:4201/drafts/Friend/1',
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
                        id: 'http://localhost:4201/drafts/Friend/2',
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
                  id: 'http://localhost:4201/drafts/Friend/1',
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
                        id: 'http://localhost:4201/drafts/Friend/2',
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
                  id: 'http://localhost:4201/drafts/Author/2',
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
                  id: 'http://localhost:4201/drafts/Author/2',
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
      systemMessage?.content?.includes('http://localhost:4201/drafts/Author/1'),
    );
    assert.true(
      systemMessage?.content?.includes('http://localhost:4201/drafts/Author/2'),
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
                  id: 'http://localhost:4201/drafts/Friend/1',
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
                        id: 'http://localhost:4201/drafts/Friend/2',
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
              openCardIds: ['http://localhost:4201/drafts/Friend/1'],
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
      history[0].content.data.attachedCards[0]['data'],
    );
  });

  test('If there are no functions in the last message from the user, store none', () => {
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
    assert.equal(functions.length, 0);
  });

  test('If a user stops sharing their context then ignore function calls', () => {
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
              openCardIds: ['http://localhost:4201/drafts/Friend/1'],
              tools: [
                getPatchTool(
                  { id: 'http://localhost:4201/drafts/Friend/1' },
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
    assert.equal(functions.length, 0);
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
                    id: 'http://localhost:4201/drafts/Friend/1',
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
                          id: 'http://localhost:4201/drafts/Friend/2',
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
                  { id: 'http://localhost:4201/drafts/Friend/1' } as any,
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
            card_id: {
              type: 'string',
              const: 'http://localhost:4201/drafts/Friend/1',
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
          msgtype: 'org.boxel.message',
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/drafts/Friend/1'],
              tools: [
                getPatchTool(
                  { id: 'http://localhost:4201/drafts/Friend/1' } as any,
                  {
                    firstName: { type: 'string' },
                  },
                ),
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
            description: {
              type: 'string',
            },
            card_id: {
              type: 'string',
              const: 'http://localhost:4201/drafts/Friend/1',
            },
            firstName: {
              type: 'string',
            },
          },
          required: ['card_id', 'attributes', 'description'],
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
              openCardIds: ['http://localhost:4201/drafts/Friend/1'],
              tools: [
                getPatchTool(
                  { id: 'http://localhost:4201/drafts/Friend/1' } as any,
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
              openCardIds: ['http://localhost:4201/drafts/Meeting/2'],
              tools: [
                getPatchTool(
                  { id: 'http://localhost:4201/drafts/Meeting/2' },
                  {
                    location: { type: 'string' },
                  },
                ),
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
                const: 'http://localhost:4201/drafts/Meeting/2',
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
        id: 'http://localhost:4201/drafts/SkillCard/1',
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
        id: 'http://localhost:4201/drafts/SkillCard/2',
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
      assert.equal(result[1].content, 'Hi');
    });

    test('can include both skill cards and attached cards', () => {
      const card: SingleCardDocument = {
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
                  id: 'http://localhost:4201/drafts/SkillCard/1',
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
                  id: 'http://localhost:4201/drafts/SkillCard/1',
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
    assert.deepEqual(functions[0], {
      type: 'function',
      function: {
        name: 'searchCard',
        description:
          'Propose a query to search for a card instance filtered by type. Always prioritise search based upon the card that was last shared.',
        parameters: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
            },
            filter: {
              type: 'object',
              properties: {
                type: {
                  type: 'object',
                  properties: {
                    module: {
                      type: 'string',
                      description: 'the absolute path of the module',
                    },
                    name: {
                      type: 'string',
                      description: 'the name of the module',
                    },
                  },
                  required: ['module', 'name'],
                },
              },
            },
          },
          required: ['filter', 'description'],
        },
      },
    });
  });
});
