import { module, test, assert } from 'qunit';
import { getFunctions, getModifyPrompt, getRelevantCards } from '../helpers';
import { IRoomEvent } from 'matrix-js-sdk';

function getPatchFunction(cardId: string, properties: any) {
  return {
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
  };
}

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

  test('should generate a more structured response if the user uploads a card', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.message',
          body: 'Hey',
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
      result[0].content?.includes(
        JSON.stringify(history[0].content.data.attachedCards[0].data),
      ),
    );
  });

  test('should raise an error if we do not pass in a full id', () => {
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

  test('Gets only the latest version of cards shared in context', () => {
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
              openCards: [
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
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the location to home',
          data: {
            context: {
              openCards: [
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
              submode: 'interact',
            },
          },
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
      history[1].content.data.context.openCards[0]['data'],
    );
  });

  test('Gets only the latest version of cards uploaded', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
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
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the location to home',
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
              submode: 'interact',
            },
          },
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
      history[1].content.data.attachedCards[0]['data'],
    );
  });

  test('Safely manages cases with no cards', () => {
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
              openCards: [],
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
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the location to home',
          data: {
            context: {
              openCards: [],
              submode: 'interact',
            },
          },
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
    assert.equal(relevantCards.length, 0);
  });

  test('Gets uploaded cards if no shared context', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.message',
          body: 'Hey',
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
          },
        },
        sender: '@user:localhost',
      },
    ];
    const relevantCards = getRelevantCards(history, '@aibot:localhost');
    assert.equal(relevantCards.length, 1);
  });

  test('Gets multiple uploaded cards', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.message',
          body: 'Hey',
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
          },
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.message',
          body: 'Hey',
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
          },
        },
        sender: '@user:localhost',
      },
    ];
    const relevantCards = getRelevantCards(history, '@aibot:localhost');
    assert.equal(relevantCards.length, 2);
  });

  test('Open cards add to attached cards', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.message',
          body: 'Hey',
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
          },
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: 'org.boxel.message',
          body: 'Hey',
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
          },
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the location to home',
          data: {
            context: {
              openCards: [
                {
                  data: {
                    type: 'card',
                    id: 'http://localhost:4201/drafts/Meeting/2',
                    attributes: {
                      location: 'Work',
                    },
                    meta: {
                      adoptsFrom: {
                        module: '../meeting',
                        name: 'Meeting',
                      },
                    },
                  },
                },
              ],
              submode: 'interact',
            },
          },
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
    assert.equal(relevantCards.length, 3);
    assert.deepEqual(relevantCards, [
      history[0].content.data.attachedCards[0]['data'],
      history[1].content.data.attachedCards[0]['data'],
      history[2].content.data.context.openCards[0]['data'],
    ]);
  });

  test('If a user stops sharing their context keep it in the system prompt', () => {
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
      history[0].content.data.context.openCards[0]['data'],
    );
  });

  test('If a user stops sharing their context then ignore function calls', () => {
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
              functions: [
                getPatchFunction('http://localhost:4201/drafts/Friend/1', {
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
    const functions = getFunctions(history, '@aibot:localhost');
    assert.equal(functions.length, 0);
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
              functions: [
                getPatchFunction('http://localhost:4201/drafts/Friend/1', {
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

    const functions = getFunctions(history, '@aibot:localhost');
    assert.equal(functions.length, 1);
    assert.deepEqual(functions[0], {
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
    });
  });

  test('Gets only the latest functions', () => {
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
              functions: [
                getPatchFunction('http://localhost:4201/drafts/Friend/1', {
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
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the location to home',
          data: {
            context: {
              openCards: [
                {
                  data: {
                    type: 'card',
                    id: 'http://localhost:4201/drafts/Meeting/2',
                    attributes: {
                      location: 'Work',
                    },
                    meta: {
                      adoptsFrom: {
                        module: '../meeting',
                        name: 'Meeting',
                      },
                    },
                  },
                },
              ],
              functions: [
                getPatchFunction('http://localhost:4201/drafts/Meeting/2', {
                  location: { type: 'string' },
                }),
              ],
              submode: 'interact',
            },
          },
        },
        origin_server_ts: 1696813813167,
        unsigned: {
          age: 115498,
        },
        event_id: '$AZ65GbUls1UdpiOPD_AfSVu8RyiFYN1vltmUKmUnV4c',
        age: 115498,
      },
    ];

    const functions = getFunctions(history, '@aibot:localhost');
    assert.equal(functions.length, 1);
    if (functions.length > 0) {
      assert.deepEqual(functions[0], {
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
      });
    }
  });
});
