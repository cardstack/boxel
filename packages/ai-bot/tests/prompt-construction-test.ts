import { module, test, assert } from 'qunit';
import { getTools, getModifyPrompt, getRelevantCards } from '../helpers';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/room';

function getPatchTool(cardId: string, properties: any) {
  return {
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
            const: cardId,
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
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
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
        },
        sender: '@user:localhost',
        room_id: 'room1',
        unsigned: {
          age: 1000,
          transaction_id: '1',
        },
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
      },
    ];

    const relevantCards = getRelevantCards(history, '@aibot:localhost');
    assert.equal(relevantCards.length, 1);
    if (
      history[1].type === 'm.room.message' &&
      history[1].content.msgtype === 'org.boxel.message'
    ) {
      assert.equal(
        relevantCards[0],
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
      },
    ];

    const relevantCards = getRelevantCards(history, '@aibot:localhost');
    assert.equal(relevantCards.length, 0);
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
              openCards: [],
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
      },
    ];
    const relevantCards = getRelevantCards(history, '@aibot:localhost');
    assert.equal(relevantCards.length, 1);
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
              openCards: [],
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
      },
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
              openCards: [],
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
      },
    ];
    const relevantCards = getRelevantCards(history, '@aibot:localhost');
    assert.equal(relevantCards.length, 2);
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
      },
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          body: 'Just a regular message',
        },
        origin_server_ts: 1696813813167,
        unsigned: {
          age: 115498,
        },
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
        age: 115498,
      },
    ];
    const relevantCards = getRelevantCards(history, '@aibot:localhost');
    assert.equal(relevantCards.length, 1);
    assert.equal(
      relevantCards[0],
      history[0].content.data.attachedCards[0]['data'],
    );
  });

  test('If there are no functions in the last message from the user, store none', () => {
    const history: IRoomEvent[] = [
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
                getPatchTool('http://localhost:4201/drafts/Friend/1', {
                  firstName: { type: 'string' },
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
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
                getPatchTool('http://localhost:4201/drafts/Friend/1', {
                  firstName: { type: 'string' },
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
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
              tools: [
                getPatchTool('http://localhost:4201/drafts/Friend/1', {
                  firstName: { type: 'string' },
                }),
              ],
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
                getPatchTool('http://localhost:4201/drafts/Friend/1', {
                  firstName: { type: 'string' },
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
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
                getPatchTool('http://localhost:4201/drafts/Meeting/2', {
                  location: { type: 'string' },
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
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
      },
    ];

    const functions = getTools(history, '@aibot:localhost');
    assert.equal(functions.length, 1);
    if (functions.length > 0) {
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
                const: 'http://localhost:4201/drafts/Meeting/2',
              },
              attributes: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                  },
                },
              },
            },
            required: ['card_id', 'attributes', 'description'],
          },
        },
      });
    }
  });
});
