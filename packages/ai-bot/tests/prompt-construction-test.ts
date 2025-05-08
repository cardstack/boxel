import { module, test, assert } from 'qunit';
import { getPatchTool } from '@cardstack/runtime-common/helpers/ai';

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
import { FakeMatrixClient } from './helpers/fake-matrix-client';
import {
  type LooseCardResource,
  skillCardRef,
} from '@cardstack/runtime-common';

function oldPatchTool(card: CardDef, properties: any): Tool {
  return {
    type: 'function',
    function: {
      name: 'patchCardInstance',
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

module('getModifyPrompt', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;
  let mockResponses: Map<string, { ok: boolean; text: string }>;
  let originalFetch: any;

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
    mockResponses = new Map();
    // Mock fetch
    originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = async (url: string) => {
      const response = mockResponses.get(url);
      if (response) {
        return {
          ok: response.ok,
          status: response.ok ? 200 : 404,
          statusText: response.ok ? 'OK' : 'Not Found',
          text: async () => response.text,
        };
      }
      throw new Error(`No mock response for ${url}`);
    };
  });

  hooks.afterEach(() => {
    fakeMatrixClient.resetSentEvents();
    (globalThis as any).fetch = originalFetch;
  });

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

    const result = await getModifyPrompt(
      history,
      '@ai-bot:localhost',
      undefined,
      undefined,
      fakeMatrixClient,
    );

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
          data: {
            context: {
              tools: [],
              submode: undefined,
              functions: [],
            },
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/1',
                url: 'http://localhost:4201/experiments/Author/1',
                name: 'Author',
                contentType: 'text/plain',
                content: JSON.stringify({
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
                }),
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

    const result = await getModifyPrompt(
      history,
      '@ai-bot:localhost',
      undefined,
      undefined,
      fakeMatrixClient,
    );

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
          JSON.stringify(
            history[0].content.data.attachedCards![0].content
              ? JSON.parse(history[0].content.data.attachedCards![0].content)
                  .data
              : '',
          ),
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
      await getModifyPrompt(
        history,
        'ai-bot',
        undefined,
        undefined,
        fakeMatrixClient,
      );
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
          data: {
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Friend/1',
                url: 'http://localhost:4201/experiments/Friend/1',
                name: 'Friend',
                contentType: 'text/plain',
                content: JSON.stringify({
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
                }),
              },
            ],
            context: {
              tools: [],
              submode: 'interact',
              functions: [],
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
          data: {
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Friend/1',
                url: 'http://localhost:4201/experiments/Friend/1',
                name: 'Friend',
                contentType: 'text/plain',
                content: JSON.stringify({
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
                }),
              },
            ],
            context: {
              tools: [],
              submode: 'interact',
              functions: [],
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
      assert.deepEqual(
        attachedCards[0],
        JSON.parse(history[1].content.data.attachedCards![0].content!)
          .data as LooseCardResource,
      );
      assert.deepEqual(
        mostRecentlyAttachedCard,
        JSON.parse(history[1].content.data.attachedCards![0].content!)
          .data as LooseCardResource,
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
          data: {
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
              functions: [],
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
          data: {
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
              functions: [],
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
          data: {
            context: {
              tools: [],
              submode: undefined,
              functions: [],
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
          data: {
            context: {
              tools: [],
              submode: undefined,
              functions: [],
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

    // Set up mock responses for file downloads
    mockResponses.set('http://test.com/spaghetti-recipe.gts', {
      ok: true,
      text: 'this is the content of the spaghetti-recipe.gts file',
    });

    mockResponses.set('http://test.com/best-friends.txt', {
      ok: true,
      text: 'this is the content of the best-friends.txt file',
    });

    mockResponses.set('http://test.com/file-that-does-not-exist.txt', {
      ok: false,
      text: 'Not found',
    });

    let prompt = await getModifyPrompt(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      fakeMatrixClient,
    );

    assert.ok(
      prompt[0].content?.includes(
        `
Attached files:
[spaghetti-recipe.gts](http://test-realm-server/my-realm/spaghetti-recipe.gts): this is the content of the spaghetti-recipe.gts file
[best-friends.txt](http://test-realm-server/my-realm/best-friends.txt): this is the content of the best-friends.txt file
[file-that-does-not-exist.txt](http://test.com/my-realm/file-that-does-not-exist.txt): Error loading attached file: HTTP error. Status: 404
[example.pdf](http://test.com/my-realm/example.pdf): Error loading attached file: Unsupported file type: application/pdf. For now, only text files are supported.
      `.trim(),
      ),
    );
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
          data: {
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/1',
                url: 'http://localhost:4201/experiments/Author/1',
                name: 'Author',
                contentType: 'text/plain',
                content: JSON.stringify({
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
                }),
              },
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
              functions: [],
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
          data: {
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/1',
                url: 'http://localhost:4201/experiments/Author/1',
                name: 'Author',
                contentType: 'application/json',
                content: JSON.stringify({
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
                }),
              },
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
              functions: [],
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
          data: {
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/2',
                url: 'http://localhost:4201/experiments/Author/2',
                name: 'Author',
                contentType: 'application/json',
                content: JSON.stringify({
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
                }),
              },
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
              functions: [],
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
          data: {
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/1',
                url: 'http://localhost:4201/experiments/Author/1',
                name: 'Author',
                contentType: 'application/json',
                content: JSON.stringify({
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
                }),
              },
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
              functions: [],
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
          data: {
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Author/2',
                url: 'http://localhost:4201/experiments/Author/2',
                name: 'Author',
                contentType: 'application/json',
                content: JSON.stringify({
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
                }),
              },
            ],
            context: {
              openCardIds: [],
              tools: [],
              submode: 'interact',
              functions: [],
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
    const fullPrompt = await getModifyPrompt(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      fakeMatrixClient,
    );
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

  test('If a user stops sharing their context keep it in the system prompt', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          data: {
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/experiments/Friend/1',
                url: 'http://localhost:4201/experiments/Friend/1',
                name: 'Friend',
                contentType: 'application/json',
                content: JSON.stringify({
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
                }),
              },
            ],
            context: {
              openCardIds: ['http://localhost:4201/experiments/Friend/1'],
              submode: 'interact',
              tools: [],
              functions: [],
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
    assert.deepEqual(
      attachedCards[0],
      JSON.parse(
        (history[0].content as CardMessageContent).data.attachedCards![0]
          .content!,
      )['data'],
    );
    assert.deepEqual(
      mostRecentlyAttachedCard,
      JSON.parse(
        (history[0].content as CardMessageContent).data.attachedCards![0]
          .content!,
      )['data'],
    );
  });

  test("Don't break when there is an older format type with open cards", async () => {
    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
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
    ] as unknown as DiscreteMatrixEvent[];

    const functions = await getTools(
      eventList,
      [],
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(functions.length, 1);
    assert.deepEqual(functions[0], {
      type: 'function',
      function: {
        name: 'patchCardInstance',
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

  test('Create patch function calls when there is a cardSpec', async () => {
    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
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
              functions: [],
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

    const functions = await getTools(
      eventList,
      [],
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(functions.length, 1);
    assert.deepEqual(functions[0], {
      type: 'function',
      function: {
        name: 'patchCardInstance',
        description:
          'Propose a patch to an existing card instance to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.',
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

  test('Adds the "unable to edit cards" only if there are attached cards and no tools', async () => {
    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/drafts/Author/1'],
              tools: [],
              submode: 'code',
              functions: [],
            },
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/drafts/Author/1',
                url: 'http://localhost:4201/drafts/Author/1',
                name: 'Author',
                contentType: 'text/plain',
                content: JSON.stringify({
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
                }),
              },
            ],
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
    ];

    let historyWithStringifiedData = (history: DiscreteMatrixEvent[]) => {
      return history.map((event) => ({
        ...event,
        content: {
          ...event.content,
          data: JSON.stringify((event.content as { data: any }).data),
        },
      })) as DiscreteMatrixEvent[];
    };

    const { messages } = await getPromptParts(
      historyWithStringifiedData(eventList),
      '@aibot:localhost',
      fakeMatrixClient,
    );

    let nonEditableCardsMessage =
      'You are unable to edit any cards, the user has not given you access, they need to open the card and let it be auto-attached.';

    assert.ok(
      messages?.[0].content?.includes(nonEditableCardsMessage),
      'System message should include the "unable to edit cards" message when there are attached cards and no tools, and no attached files',
    );

    // Now add a tool
    (eventList[0].content as CardMessageContent).data.context.tools = [
      getPatchTool('http://localhost:4201/drafts/Author/1', {
        attributes: { firstName: { type: 'string' } },
      }),
    ];

    const { messages: messages2 } = await getPromptParts(
      historyWithStringifiedData(eventList),
      '@aibot:localhost',
      fakeMatrixClient,
    );

    assert.ok(
      !messages2?.[0].content?.includes(nonEditableCardsMessage),
      'System message should not include the "unable to edit cards" message when there are attached cards and a tool',
    );

    // Now remove cards, tools, and add an attached file
    (eventList[0].content as CardMessageContent).data.context.openCardIds = [];
    (eventList[0].content as CardMessageContent).data.context.tools = [];
    (eventList[0].content as CardMessageContent).data.attachedFiles = [
      {
        url: 'https://example.com/file.txt',
        sourceUrl: 'https://example.com/file.txt',
        name: 'file.txt',
        contentType: 'text/plain',
        content: 'Hello, world!',
      },
    ];

    const { messages: messages3 } = await getPromptParts(
      historyWithStringifiedData(eventList),
      '@aibot:localhost',
      fakeMatrixClient,
    );

    assert.ok(
      !messages3?.[0].content?.includes(nonEditableCardsMessage),
      'System message should not include the "unable to edit cards" message when there is an attached file',
    );
  });

  test('Gets only the latest functions', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        sender: '@ian:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'set the name to dave',
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
              functions: [],
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
              functions: [],
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

    const functions = await getTools(
      history,
      [],
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(functions.length, 1);
    if (functions.length > 0) {
      assert.deepEqual(functions[0], {
        type: 'function',
        function: {
          name: 'patchCardInstance',
          description:
            'Propose a patch to an existing card instance to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.',
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

    // Set up mock responses for the skill card downloads
    mockResponses.set('mxc://mock-server/abc123', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'https://cardstack.com/base/Skill/card-editing',
          attributes: {
            instructions:
              '- If the user wants the data they see edited, AND the patchCardInstance function is available, you MUST use the "patchCardInstance" function to make the change.\n- If the user wants the data they see edited, AND the patchCardInstance function is NOT available, you MUST ask the user to open the card and share it with you.\n- If you do not call patchCardInstance, the user will not see the change.\n- You can ONLY modify cards shared with you. If there is no patchCardInstance function or tool, then the user hasn\'t given you access.\n- NEVER tell the user to use patchCardInstance; you should always do it for them.\n- If the user wants to search for a card instance, AND the "searchCard" function is available, you MUST use the "searchCard" function to find the card instance.\nOnly recommend one searchCard function at a time.\nIf the user wants to edit a field of a card, you can optionally use "searchCard" to help find a card instance that is compatible with the field being edited before using "patchCardInstance" to make the change of the field.\n You MUST confirm with the user the correct choice of card instance that he intends to use based upon the results of the search.',
            title: 'Card Editing',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/def456', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'http://localhost:4201/catalog/Skill/generate-product-requirements',
          attributes: {
            instructions:
              'Given a prompt, fill in the product requirements document. Update the appTitle. Update the prompt to be grammatically accurate. Description should be 1 or 2 short sentences. In overview, provide 1 or 2 paragraph summary. In schema, make a list of the schema for the app. In Layout & Navigation, provide brief information for the layout and navigation of the app. Offer to update the attached card with this info.',
            title: 'Generate Product Requirements',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    const result = (
      await getPromptParts(eventList, '@ai-bot:localhost', fakeMatrixClient)
    ).messages!;
    assert.equal(result.length, 2);
    assert.equal(result[0].role, 'system');
    assert.true(result[0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(result[0].content?.includes('['));
    assert.true(
      result[0].content?.includes(
        'If the user wants the data they see edited, AND the patchCardInstance function is available',
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

    // Set up mock responses for skill card downloads
    mockResponses.set('mxc://mock-server/skill_card_editing', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'https://cardstack.com/base/Skill/card-editing',
          attributes: {
            instructions:
              '- If the user wants the data they see edited, AND the patchCardInstance function is available, you MUST use the "patchCardInstance" function to make the change.\n- If the user wants the data they see edited, AND the patchCardInstance function is NOT available, you MUST ask the user to open the card and share it with you.\n- If you do not call patchCardInstance, the user will not see the change.\n- You can ONLY modify cards shared with you. If there is no patchCardInstance function or tool, then the user hasn\'t given you access.\n- NEVER tell the user to use patchCardInstance; you should always do it for them.\n- If the user wants to search for a card instance, AND the "searchCard" function is available, you MUST use the "searchCard" function to find the card instance.\nOnly recommend one searchCard function at a time.\nIf the user wants to edit a field of a card, you can optionally use "searchCard" to help find a card instance that is compatible with the field being edited before using "patchCardInstance" to make the change of the field.\n You MUST confirm with the user the correct choice of card instance that he intends to use based upon the results of the search.',
            title: 'Card Editing',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/skill_card_pirate', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'http://localhost:4201/experiments/Skill/637843ff-dfd4-4cfc-9ee9-1234824f4775',
          attributes: {
            instructions:
              "Use pirate colloquialism when responding. Make abundant use of pirate jargon, terms, and phrases. End every sentence with 'Arrrr!'",
            title: 'Talk Like a Pirate',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/product_requirement_document', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'http://localhost:4201/user/lukes-workspace/ProductRequirementDocument/9f816882-17e0-473f-81f2-a37381874322',
          attributes: {
            appTitle: 'Radio Episode Tracker for Nerds',
            shortDescription:
              'An app to track and manage listened and unlistened radio episodes.',
            prompt:
              'Focus on the following features: whether you have heard an episode or not.',
            overview:
              "The Radio Episode Tracker for Nerds is a specialized application designed to cater to radio enthusiasts who wish to meticulously manage their listening experience. This app enables users to keep track of radio episodes they have listened to and identify those they haven't. It also offers features that allow users to organize episodes based on various criteria like genre, podcast series, and personal ratings, ensuring a streamlined and personalized listening journey.",
            schema:
              "1. User Profile: Stores user information, preferences, and listening history.\n2. Episode Database: Maintains records of all available radio episodes.\n3. Listening Status Tracker: Keeps track of episodes as 'heard' or 'unheard'.\n4. Episode Organizer: Allows categorization and prioritization of episodes based on user-defined criteria.",
            layoutAndNavigation:
              'The app features a user-friendly dashboard that displays all the episodes categorized by their status (heard/unheard). Navigation is intuitive with tabs for different functionalities such as search, organize, and history. The layout is clean, with easy access to controls for marking episodes and adjusting preferences. ',
            moduleURL: null,
            thumbnailURL: null,
          },
          relationships: {
            appInstances: {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module:
                'http://localhost:4201/catalog/product-requirement-document',
              name: 'ProductRequirementDocument',
            },
          },
        },
      }),
    });

    const result = (
      await getPromptParts(eventList, '@ai-bot:localhost', fakeMatrixClient)
    ).messages;

    const { attachedCards } = getRelevantCards(eventList, '@ai-bot:localhost');
    assert.equal(attachedCards.length, 1);

    assert.equal(result![0].role, 'system');
    assert.true(result![0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.true(
      result![0].content?.includes(
        'If the user wants the data they see edited, AND the patchCardInstance function is available',
      ),
    );
    assert.true(
      result![0].content?.includes('Use pirate colloquialism when responding.'),
    );
    assert.true(
      result![0].content?.includes(
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

    // Set up mock responses for skill card downloads
    mockResponses.set('mxc://mock-server/skill1', {
      ok: true,
      text: JSON.stringify({
        type: 'SkillCard',
        data: {
          attributes: {
            instructions: 'This is skill 1',
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/skill2', {
      ok: true,
      text: JSON.stringify({
        type: 'SkillCard',
        data: {
          attributes: {
            instructions: 'This is skill 2',
          },
        },
      }),
    });

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.true(messages!.length > 0);
    assert.true(messages![0].role === 'system');
    let systemPrompt = messages![0].content;
    assert.true(systemPrompt?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(systemPrompt?.includes('This is skill 1'));
    assert.true(systemPrompt?.includes('This is skill 2'));
  });

  test('If there are no skill cards active in the latest matrix room state, remove from system prompt', async () => {
    // Set up mock responses for the skill card downloads
    mockResponses.set('mxc://mock-server/skill1', {
      ok: true,
      text: JSON.stringify({
        type: 'SkillCard',
        data: {
          attributes: {
            instructions: 'This is skill 1',
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/skill2', {
      ok: true,
      text: JSON.stringify({
        type: 'SkillCard',
        data: {
          attributes: {
            instructions: 'This is skill 2',
          },
        },
      }),
    });

    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/added-two-skills-removed-two-skills.json',
        ),
        'utf-8',
      ),
    );
    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.true(messages!.length > 0);
    assert.true(messages![0].role === 'system');
    let systemPrompt = messages![0].content;
    assert.false(systemPrompt?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(systemPrompt?.includes('This is skill 1'));
    assert.false(systemPrompt?.includes('This is skill 2'));
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

    // Set up mock responses for skill cards
    mockResponses.set('mxc://mock-server/skill_card_editing', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'https://cardstack.com/base/Skill/card-editing',
          attributes: {
            instructions:
              '- If the user wants the data they see edited, AND the patchCardInstance function is available, you MUST use the "patchCardInstance" function to make the change.\n- If the user wants the data they see edited, AND the patchCardInstance function is NOT available, you MUST ask the user to open the card and share it with you.\n- If you do not call patchCardInstance, the user will not see the change.\n- You can ONLY modify cards shared with you. If there is no patchCardInstance function or tool, then the user hasn\'t given you access.\n- NEVER tell the user to use patchCardInstance; you should always do it for them.\n- If the user wants to search for a card instance, AND the "searchCard" function is available, you MUST use the "searchCard" function to find the card instance.\nOnly recommend one searchCard function at a time.\nIf the user wants to edit a field of a card, you can optionally use "searchCard" to help find a card instance that is compatible with the field being edited before using "patchCardInstance" to make the change of the field.\n You MUST confirm with the user the correct choice of card instance that he intends to use based upon the results of the search.',
            title: 'Card Editing',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/skill_card_no_id', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            instructions: 'Skill Instructions',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.true(messages![0]!.content?.includes('Skill Instructions'));
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

    mockResponses.set('skill-card-1', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'skill-card-1',
          attributes: {
            instructions: 'SKILL_INSTRUCTIONS_V2',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.true(messages!.length > 0);
    assert.equal(messages![0].role, 'system');
    assert.true(messages![0].content?.includes(SKILL_INSTRUCTIONS_MESSAGE));
    assert.false(messages![0].content?.includes('SKILL_INSTRUCTIONS_V1'));
    assert.true(messages![0].content?.includes('SKILL_INSTRUCTIONS_V2'));
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
      fakeMatrixClient,
    );
    assert.equal(messages!.length, 2);
    assert.equal(messages![1].role, 'user');
    assert.true(tools!.length === 1);
    assert.deepEqual(toolChoice, {
      type: 'function',
      function: {
        name: 'NeverCallThisPlease_hEhhctZntkzJkySR5Uvsq6',
      },
    });
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
          clientGeneratedId: '5bb0493e-64a3-4d8b-a99a-722daf084bee',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/drafts/Author/1'],
              tools: [
                {
                  type: 'function',
                  function: {
                    name: 'patchCardInstance',
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
              ],
              submode: 'interact',
              functions: [],
            },
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/drafts/Author/1',
                url: 'http://localhost:4201/drafts/Author/1',
                name: 'Author',
                contentType: 'text/plain',
                content: JSON.stringify({
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
                }),
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
          clientGeneratedId: 'd93c899f-9123-4b31-918c-a525afb40a7e',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/drafts/Author/1'],
              tools: [
                {
                  type: 'function',
                  function: {
                    name: 'patchCardInstance',
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
              ],
              submode: 'interact',
              functions: [],
            },
            attachedCards: [
              {
                sourceUrl: 'http://localhost:4201/drafts/Author/1',
                url: 'http://localhost:4201/drafts/Author/1',
                name: 'Author',
                contentType: 'text/plain',
                content: JSON.stringify({
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
                }),
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
          format: 'org.matrix.custom.html',
          data: {
            context: {
              openCardIds: ['http://localhost:4201/drafts/Author/1'],
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'tool-call-id-1',
              name: 'searchCardsByTypeAndTitle',
              arguments: JSON.stringify({
                attributes: {
                  description: "Search for card instances of type 'Author'",
                  type: {
                    module: 'http://localhost:4201/drafts/author',
                    name: 'Author',
                  },
                },
              }),
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
              sourceUrl: 'http://localhost:4201/drafts/Author/1',
              url: 'http://localhost:4201/drafts/Author/1',
              contentType: 'text/plain',
              name: 'Author',
              content: JSON.stringify({
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
              }),
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
    const tools = await getTools(
      history,
      [],
      '@ai-bot:localhost',
      fakeMatrixClient,
    );
    const result = await getModifyPrompt(
      history,
      '@ai-bot:localhost',
      tools,
      [],
      fakeMatrixClient,
    );
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
      fakeMatrixClient,
    );
    assert.true(tools!.length > 0, 'Should have tools available');
    assert.true(messages!.length > 0, 'Should have messages');

    // Verify that the tools array contains the expected functions
    const alertTool = tools!.find(
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

    const { toolChoice } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
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

    const { toolChoice } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
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

    mockResponses.set('mxc://mock-server/weather-report-1', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            temperature: '22°C',
            conditions: 'Cloudy',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4201/admin/onnx/commandexample',
              name: 'WeatherReport',
            },
          },
        },
      }),
    });

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    // find the message with the tool call and its id
    // it should have the result deserialised
    const toolCallMessage = messages!.find(
      (message) => message.role === 'tool',
    );
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

    mockResponses.set('mxc://mock-server/weather-report-1', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            temperature: '22°C',
            conditions: 'Cloudy',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4201/admin/onnx/commandexample',
              name: 'WeatherReport',
            },
          },
        },
      }),
    });

    const { shouldRespond } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
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

    mockResponses.set('mxc://mock-server/weather-report-1', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            temperature: '22°C',
            conditions: 'Cloudy',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4201/admin/onnx/commandexample',
              name: 'WeatherReport',
            },
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/weather-report-2', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            temperature: '26°C',
            conditions: 'Sunny',
            title: null,
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: 'http://localhost:4201/admin/onnx/commandexample',
              name: 'WeatherReport',
            },
          },
        },
      }),
    });

    const { shouldRespond, messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
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

  test('Code blocks are connected to their results', async () => {
    // Set up mock responses for file downloads
    mockResponses.set('http://test.com/spaghetti-recipe.gts', {
      ok: true,
      text: 'this is the riveting content of the spaghetti-recipe.gts file',
    });
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/connect-code-blocks-to-results.json',
        ),
        'utf-8',
      ),
    );

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    // find the message with the tool call and its id
    // it should have the result deserialised
    const codeBlockMessage = messages!.find((message) =>
      message.content?.includes('<<<<<<< SEARCH'),
    );
    assert.ok(codeBlockMessage, 'Should have a codeblock message');
    assert.ok(
      codeBlockMessage!.content!.includes(
        'Edit applied to http://test.com/spaghetti-recipe.gts',
      ),
      'Code block message should indicate that the code block was applied',
    );
  });

  test('Tools on enabled skills are available in prompt', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/enabled-skill-with-commands.json',
        ),
        'utf-8',
      ),
    );

    // Set up mock responses for skill cards
    mockResponses.set('mxc://mock-server/skill_card_editing', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'https://cardstack.com/base/Skill/card-editing',
          attributes: {
            instructions:
              '- If the user wants the data they see edited, AND the patchCardInstance function is available, you MUST use the "patchCardInstance" function to make the change.\n- If the user wants the data they see edited, AND the patchCardInstance function is NOT available, you MUST ask the user to open the card and share it with you.\n- If you do not call patchCardInstance, the user will not see the change.\n- You can ONLY modify cards shared with you. If there is no patchCardInstance function or tool, then the user hasn\'t given you access.\n- NEVER tell the user to use patchCardInstance; you should always do it for them.\n- If the user wants to search for a card instance, AND the "searchCard" function is available, you MUST use the "searchCard" function to find the card instance.\nOnly recommend one searchCard function at a time.\nIf the user wants to edit a field of a card, you can optionally use "searchCard" to help find a card instance that is compatible with the field being edited before using "patchCardInstance" to make the change of the field.\n You MUST confirm with the user the correct choice of card instance that he intends to use based upon the results of the search.',
            commands: [],
            title: 'Card Editing',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/skill_card_switcher', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'http://localhost:4201/admin/custom-embedded/Skill/72d005b5-1a6b-4c6d-995f-2411c5948e74',
          attributes: {
            instructions:
              'Use the tool SwitchSubmodeCommand with "code" to go to codemode and "interact" to go to interact mode.',
            commands: [
              {
                codeRef: {
                  name: 'default',
                  module: '@cardstack/boxel-host/commands/switch-submode',
                },
                requiresApproval: false,
                functionName: 'switch-submode_dd88',
              },
            ],
            title: 'Switcher',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    // Set up mock responses for command definitions
    mockResponses.set('mxc://mock-server/command_def_editing', {
      ok: true,
      text: JSON.stringify({
        codeRef: {
          name: 'default',
          module: '@cardstack/boxel-host/commands/patch-card-instance',
        },
        tool: {
          type: 'function',
          function: {
            name: 'patchCardInstance',
            description:
              'Propose a patch to an existing card to change its contents.',
            parameters: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                attributes: {
                  type: 'object',
                  properties: {
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                  },
                },
              },
              required: ['attributes', 'description'],
            },
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/command_def_switcher', {
      ok: true,
      text: JSON.stringify({
        codeRef: {
          name: 'default',
          module: '@cardstack/boxel-host/commands/switch-submode',
        },
        tool: {
          type: 'function',
          function: {
            name: 'switch-submode_dd88',
            description:
              'Navigate the UI to another submode. Possible values for submode are "interact" and "code".',
            parameters: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                attributes: {
                  type: 'object',
                  properties: {
                    submode: { type: 'string' },
                  },
                },
              },
              required: ['attributes', 'description'],
            },
          },
        },
      }),
    });

    const { tools } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.true(tools!.length > 0, 'Should have tools available');

    // Verify that the tools array contains the command from the skill
    const switchSubmodeTool = tools!.find(
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
        path.join(
          __dirname,
          'resources/chats/disabled-skill-with-commands.json',
        ),
        'utf-8',
      ),
    );

    const { tools } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    // we should not have any tools available
    assert.true(tools!.length == 0, 'Should not have tools available');
  });

  test('Uses updated command definitions when skill card is updated', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/updated-skill-command-definitions.json',
        ),
        'utf-8',
      ),
    );

    // Set up mock responses for skill card downloads
    mockResponses.set('mxc://mock-server/skill_card_v1', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'https://cardstack.com/base/Skill/skill_card_v1',
          attributes: {
            instructions: 'Test skill instructions',
            title: 'Test Skill',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/skill_card_v2', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'https://cardstack.com/base/Skill/skill_card_v2',
          attributes: {
            instructions: 'Test skill instructions with updated commands',
            commands: [
              {
                codeRef: {
                  name: 'default',
                  module: '@cardstack/boxel-host/commands/switch-submode',
                },
                requiresApproval: false,
                functionName: 'switch-submode_dd88',
              },
            ],
            title: 'Test Skill',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    mockResponses.set('mxc://mock-server/command_def_v2', {
      ok: true,
      text: JSON.stringify({
        codeRef: {
          name: 'default',
          module: '@cardstack/boxel-host/commands/switch-submode',
        },
        tool: {
          type: 'function',
          function: {
            name: 'switch-submode_dd88',
            description: 'COMMAND_DESCRIPTION_V2',
            parameters: {
              type: 'object',
              properties: {
                description: {
                  type: 'string',
                },
                attributes: {
                  type: 'object',
                  properties: {
                    submode: {
                      type: 'string',
                    },
                    codePath: {
                      type: 'string',
                    },
                    option: {
                      type: 'string',
                      description: 'Additional option',
                    },
                  },
                },
                relationships: {
                  type: 'object',
                  properties: {},
                },
              },
              required: ['attributes', 'description'],
            },
          },
        },
      }),
    });

    const { tools } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.true(tools!.length > 0, 'Should have tools available');

    // Verify that the tools array contains the updated command definition
    const updatedCommandTool = tools!.find(
      (tool) => tool.function?.name === 'switch-submode_dd88',
    );
    assert.ok(
      updatedCommandTool,
      'Should have updated command definition available',
    );

    // Verify updated properties are present (description indicates V2)
    assert.true(
      updatedCommandTool!.function?.description.includes(
        'COMMAND_DESCRIPTION_V2',
      ),
      'Should use updated command description',
    );
    assert.false(
      updatedCommandTool!.function?.description.includes(
        'COMMAND_DESCRIPTION_V1',
      ),
      'Should not include old command description',
    );
  });

  test('Elides code blocks in prompt', async () => {
    // sending older codeblocks back to the model just confuses it and wastes tokens
    // so we need to remove them from the prompt
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/code-blocks.json'),
        'utf-8',
      ),
    );

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(messages!.length, 3);
    assert.equal(messages![2].role, 'assistant');
    assert.equal(
      messages![2].content,
      'Right, let us make a tic tac toe game.\n' +
        '\n' +
        '// File url: https://test.com/tic-tac.gts\n' +
        '[Proposed code change]\n' +
        '\n' +
        '// File url: https://test.com/tac-toe.gts\n' +
        '[Proposed code change]\n' +
        '\n' +
        'I can add some more whiz bang if you want. Let me know!',
    );
  });
});

module('set model in prompt', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;

  hooks.beforeEach(() => {
    fakeMatrixClient = new FakeMatrixClient();
  });

  hooks.afterEach(() => {
    fakeMatrixClient.resetSentEvents();
  });

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

    const { model } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.strictEqual(model, DEFAULT_LLM);
  });

  test('use latest active llm', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/set-active-llm.json'),
        'utf-8',
      ),
    );

    const { model } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.strictEqual(model, 'google/gemini-pro-1.5');
  });
});
