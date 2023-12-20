import { module, test, assert } from 'qunit';
import { getFunctions, getModifyPrompt, getRelevantCards } from '../helpers';
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

  test('should generate a more strucutred response if the user uploads a card', () => {
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
      result[0].content?.includes(
        JSON.stringify(history[0].content.instance.data),
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

  test('Gets only the latest shared cards in a context', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
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
      history[1].content.context.openCards[0]['data'],
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
          context: {
            openCards: [],
            submode: 'interact',
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
          context: {
            openCards: [],
            submode: 'interact',
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
        },
        sender: '@user:localhost',
      },
    ];
    const relevantCards = getRelevantCards(history, '@aibot:localhost');
    assert.equal(relevantCards.length, 2);
  });

  test('Context overrides any uploaded cards', () => {
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
        },
        sender: '@user:localhost',
      },
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the location to home',
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
      history[2].content.context.openCards[0]['data'],
    );
  });

  test('If a user stops sharing their context then ignore older cards', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
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
    assert.equal(relevantCards.length, 0);
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
            cardSpec: {
              type: 'object',
              properties: {
                firstName: {
                  type: 'string',
                },
              },
            },
            submode: 'interact',
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
            cardSpec: {
              type: 'object',
              properties: {
                firstName: {
                  type: 'string',
                },
              },
            },
            submode: 'interact',
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
      description:
        'Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. Ensure the description explains what change you are making',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
          },
          card_id: {
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
    });
  });

  test('Gets only the latest shared cards in a context', () => {
    const history: IRoomEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: 'org.boxel.message',
          body: 'set the name to dave',
          formatted_body: '<p>set the name to dave</p>\n',
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
            cardSpec: {
              type: 'object',
              properties: {
                firstName: {
                  type: 'string',
                },
              },
            },
            submode: 'interact',
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
            cardSpec: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                },
              },
            },
            submode: 'interact',
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
    assert.deepEqual(functions[0], {
      name: 'patchCard',
      description:
        'Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. Ensure the description explains what change you are making',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
          },
          card_id: {
            type: 'string',
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
  });
});
