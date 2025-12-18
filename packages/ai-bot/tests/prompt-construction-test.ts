import { module, test, assert } from 'qunit';
import { getPatchTool } from '@cardstack/runtime-common/helpers/ai';
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions';
import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
  APP_BOXEL_COMMAND_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  DEFAULT_LLM,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import type {
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
  CardMessageContent,
} from 'https://cardstack.com/base/matrix-event';
import { EventStatus } from 'matrix-js-sdk';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import { readFileSync } from 'fs-extra';
import * as path from 'path';
import { FakeMatrixClient } from './helpers/fake-matrix-client';
import {
  type LooseCardResource,
  ensureTrailingSlash,
  skillCardRef,
} from '@cardstack/runtime-common';
import {
  buildPromptForModel,
  getPromptParts,
  getRelevantCards,
  getTools,
  SKILL_INSTRUCTIONS_MESSAGE,
} from '@cardstack/runtime-common/ai';
import type { TextContent } from '@cardstack/runtime-common/ai/types';

const DEFAULT_CATALOG_REALM_URL = 'http://localhost:4201/catalog/';
const catalogRealmURL = ensureTrailingSlash(
  process.env.RESOLVED_CATALOG_REALM_URL ?? DEFAULT_CATALOG_REALM_URL,
);

function replaceCatalogRealmURL(value: string): string {
  return value.split(DEFAULT_CATALOG_REALM_URL).join(catalogRealmURL);
}

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

module('buildPromptForModel', (hooks) => {
  let fakeMatrixClient: FakeMatrixClient;
  let mockResponses: Map<string, { ok: boolean; text: string }>;
  let originalFetch: any;
  let originalDate: typeof Date;

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
    // Save original Date constructor
    originalDate = global.Date;
    // Mock Date constructor to return a fixed date (for "Current date and time" message)
    global.Date = class extends Date {
      constructor() {
        super();
        return new originalDate('2025-06-11T11:43:00.533Z');
      }
    } as any;
  });

  hooks.afterEach(() => {
    fakeMatrixClient.resetSentEvents();
    (globalThis as any).fetch = originalFetch;
    // Restore original Date constructor
    global.Date = originalDate;
  });

  test('should generate a prompt from the user (viewing card in code mode)', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          isStreamingFinished: true,
          data: {
            context: {
              realmUrl: 'http://localhost:4201/experiments',
              submode: 'code',
              errorsDisplayed: [
                {
                  message: 'Error occurred',
                  stack: 'Error stack trace',
                  sourceUrl: 'http://localhost:4201/experiments/author.gts',
                },
              ],
              codeMode: {
                currentFile: 'http://localhost:4201/experiments/Author/1',
                moduleInspectorPanel: 'preview',
                previewPanelSelection: {
                  cardId: 'http://localhost:4201/experiments/Author/1',
                  format: 'isolated',
                },
              },
            },
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

    const result = await buildPromptForModel(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      [],
      fakeMatrixClient,
    );

    // Should have a system prompt and a user prompt
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'system');
    assert.equal(result[2].role, 'user');
    assert.equal(result[2].content, 'Hey');

    assert.equal(
      result[1].content,
      `The user is currently viewing the following user interface:
Room ID: room1
Submode: code
Workspace: http://localhost:4201/experiments
The user has no open cards.
File open in code editor: http://localhost:4201/experiments/Author/1
Module inspector panel: preview
Viewing card instance: http://localhost:4201/experiments/Author/1
In format: isolated
Errors display:
  - Error occurred
    Stack trace: Error stack trace
    Source URL: http://localhost:4201/experiments/author.gts

Current date and time: 2025-06-11T11:43:00.533Z
`,
    );
  });

  test('should generate a prompt from the user (viewing CardDef in code mode)', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          isStreamingFinished: true,
          data: {
            context: {
              realmUrl: 'http://localhost:4201/experiments',
              submode: 'code',
              codeMode: {
                currentFile: 'http://localhost:4201/experiments/author.gts',
                selectedCodeRef: {
                  module: 'http://localhost:4201/experiments/author',
                  name: 'Address',
                },
                inheritanceChain: [
                  {
                    codeRef: {
                      module: 'http://localhost:4201/experiments/author',
                      name: 'Address',
                    },
                    fields: ['street', 'city', 'state'],
                  },
                  {
                    codeRef: {
                      module: 'https://cardstack.com/base/card-api',
                      name: 'CardDef',
                    },
                    fields: [],
                  },
                ],
                selectionRange: {
                  startLine: 10,
                  startColumn: 5,
                  endLine: 12,
                  endColumn: 20,
                },
                moduleInspectorPanel: 'preview',
                previewPanelSelection: {
                  cardId: 'http://localhost:4201/experiments/Author/1',
                  format: 'isolated',
                },
              },
            },
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

    const result = await buildPromptForModel(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      [],
      fakeMatrixClient,
    );

    // Should have a system prompt and a user prompt
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'system');
    assert.equal(result[2].role, 'user');
    assert.equal(result[2].content, 'Hey');

    assert.equal(
      result[1].content,
      `The user is currently viewing the following user interface:
Room ID: room1
Submode: code
Workspace: http://localhost:4201/experiments
The user has no open cards.
File open in code editor: http://localhost:4201/experiments/author.gts
  Selected declaration: Address from http://localhost:4201/experiments/author
  Inheritance chain:
    1. Address from http://localhost:4201/experiments/author
       Fields: street, city, state
      2. CardDef from https://cardstack.com/base/card-api
  Selected text: lines 10-12 (1-based), columns 5-20 (1-based)
  Note: Line numbers in selection refer to the original file. Attached file contents below show line numbers for reference.
Module inspector panel: preview
Viewing card instance: http://localhost:4201/experiments/Author/1
In format: isolated

Current date and time: 2025-06-11T11:43:00.533Z
`,
    );
  });

  test('should generate a prompt from the user (viewing workspace chooser)', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          isStreamingFinished: true,
          data: {
            context: {
              realmUrl: 'http://localhost:4201/experiments',
              submode: 'workspace-chooser',
              workspaces: [
                {
                  url: 'https://app.boxel.ai/workspace1',
                  name: 'Workspace 1',
                  type: 'user-workspace',
                },
                {
                  url: 'https://app.boxel.ai/workspace2',
                  name: 'Workspace 2',
                  type: 'user-workspace',
                },
                {
                  url: 'https://app.boxel.ai/catalog',
                  name: 'Boxel Catalog',
                  type: 'catalog-workspace',
                },
              ],
            },
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

    const result = await buildPromptForModel(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      [],
      fakeMatrixClient,
    );

    // Should have a system prompt and a user prompt
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'system');
    assert.equal(result[2].role, 'user');
    assert.equal(result[2].content, 'Hey');

    assert.equal(
      result[1].content,
      `The user is currently viewing the following user interface:
Room ID: room1
Submode: workspace-chooser
Workspace: http://localhost:4201/experiments
Available workspaces:
 - Workspace 1 (https://app.boxel.ai/workspace1)
 - Workspace 2 (https://app.boxel.ai/workspace2)
 - Boxel Catalog (https://app.boxel.ai/catalog) - Catalog

The user has no open cards.

Current date and time: 2025-06-11T11:43:00.533Z
`,
    );
  });

  test('should generate a prompt from the user when spec pane is active', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey',
          isStreamingFinished: true,
          data: {
            context: {
              realmUrl: 'http://localhost:4201/experiments',
              submode: 'code',
              codeMode: {
                currentFile: 'http://localhost:4201/experiments/author.gts',
                moduleInspectorPanel: 'spec',
                activeSpecId:
                  'http://localhost:4201/experiments/Spec/author-spec-1',
                selectedCodeRef: {
                  module: 'http://localhost:4201/experiments/author',
                  name: 'Author',
                },
              },
            },
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

    const result = await buildPromptForModel(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      [],
      fakeMatrixClient,
    );

    // Should have a system prompt and a user prompt
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'system');
    assert.equal(result[2].role, 'user');
    assert.equal(result[2].content, 'Hey');

    assert.equal(
      result[1].content,
      `The user is currently viewing the following user interface:
Room ID: room1
Submode: code
Workspace: http://localhost:4201/experiments
The user has no open cards.
File open in code editor: http://localhost:4201/experiments/author.gts
  Selected declaration: Author from http://localhost:4201/experiments/author
Module inspector panel: spec
Active spec card: http://localhost:4201/experiments/Spec/author-spec-1

Current date and time: 2025-06-11T11:43:00.533Z
`,
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
              openCardIds: ['http://localhost:4201/experiments/Author/1'],
              tools: [],
              submode: 'interact',
              realmUrl: 'http://localhost:4201/experiments',
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

    const result = await buildPromptForModel(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      [],
      fakeMatrixClient,
    );

    // Should include the body as well as the card
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'system');
    assert.equal(result[1].role, 'system');
    assert.equal(result[2].role, 'user');
    assert.true(
      (result[2].content as string).startsWith('Hey'),
      'message body should be in the user prompt',
    );
    if (
      history[0].type === 'm.room.message' &&
      history[0].content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE
    ) {
      assert.true(
        (result[2].content as string).includes(`"firstName": "Terry"`),
        'attached card should be in the message that it was sent with 1',
      );
      assert.true(
        (result[2].content as string).includes(`"lastName": "Pratchett"`),
        'attached card should be in the message that it was sent with 2',
      );
      assert.true(
        (result[1].content as string).includes('Room ID: room1'),
        'roomId should be in the system context message',
      );
      assert.true(
        (result[1].content as string).includes('Submode: interact'),
        'submode should be in the system context message',
      );
      assert.true(
        (result[1].content as string).includes(
          'Workspace: http://localhost:4201/experiments',
        ),
        'workspace should be in the system context message',
      );
      assert.true(
        (result[1].content as string).includes(
          'Open cards:\n - http://localhost:4201/experiments/Author/1\n',
        ),
        'open card ids should be in the system context message',
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
      await buildPromptForModel(
        history,
        '@aibot@localhost',
        undefined,
        undefined,
        [],
        fakeMatrixClient,
      );
      assert.notOk(true, 'should have raised an exception');
    } catch (e) {
      assert.equal(
        (e as Error).message,
        "Username must be a full id, e.g. '@aibot:localhost'",
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

  test('downloads and includes most recent version of attached files', async () => {
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
              submode: 'code',
              codeMode: {
                currentFile:
                  'http://test-realm-server/my-realm/spaghetti-recipe.gts',
              },
              functions: [],
            },
            attachedFiles: [
              {
                sourceUrl:
                  'http://test-realm-server/my-realm/spaghetti-recipe.gts',
                url: 'http://test.com/spaghetti-recipe-a.gts',
                name: 'spaghetti-recipe.gts',
                contentType: 'text/plain',
              },
              {
                sourceUrl: 'http://test-realm-server/my-realm/best-friends.txt',
                url: 'http://test.com/best-friends-a.txt',
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
        sender: '@aibot:localhost',
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
              submode: 'code',
              codeMode: {
                currentFile:
                  'http://test-realm-server/my-realm/spaghetti-recipe.gts',
              },
              functions: [],
            },
            attachedFiles: [
              {
                sourceUrl:
                  'http://test-realm-server/my-realm/spaghetti-recipe.gts',
                url: 'http://test.com/spaghetti-recipe-b.gts',
                name: 'spaghetti-recipe.gts',
                contentType: 'text/plain',
              },
              {
                sourceUrl: 'http://test-realm-server/my-realm/best-friends.txt',
                url: 'http://test.com/best-friends-b.txt',
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
      {
        type: 'm.room.message',
        sender: '@aibot:localhost',
        content: {
          body: 'Ok. I see them. What do you want to know?',
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
        },
        origin_server_ts: 3,
        unsigned: {
          age: 17305,
          transaction_id: 'm1722242836704.8',
        },
        event_id: '3',
        room_id: 'room1',
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: '4',
        origin_server_ts: 4,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Sending you new files...',
          data: {
            context: {
              tools: [],
              submode: 'code',
              codeMode: {
                currentFile:
                  'http://test-realm-server/my-realm/spaghetti-recipe.gts',
              },
              functions: [],
            },
            attachedFiles: [
              {
                sourceUrl:
                  'http://test-realm-server/my-realm/spaghetti-recipe.gts',
                url: 'http://test.com/spaghetti-recipe-c.gts',
                name: 'spaghetti-recipe.gts',
                contentType: 'text/plain',
              },
              {
                sourceUrl: 'http://test-realm-server/my-realm/best-friends.txt',
                url: 'http://test.com/best-friends-c.txt',
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
          transaction_id: '4',
        },
        status: EventStatus.SENT,
      },
    ];

    // Set up mock responses for file downloads
    mockResponses.set('http://test.com/spaghetti-recipe-c.gts', {
      ok: true,
      text: 'this is the content of the spaghetti-recipe.gts file',
    });

    mockResponses.set('http://test.com/best-friends-c.txt', {
      ok: true,
      text: 'this is the content of the best-friends.txt file',
    });

    mockResponses.set('http://test.com/file-that-does-not-exist.txt', {
      ok: false,
      text: 'Not found',
    });

    let prompt = await buildPromptForModel(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      [],
      fakeMatrixClient,
    );

    let userMessages = prompt.filter((message) => message.role === 'user');
    assert.ok(
      (userMessages[0]?.content as string).includes(
        `
Attached Files (files with newer versions don't show their content):
[spaghetti-recipe.gts](http://test-realm-server/my-realm/spaghetti-recipe.gts)
[best-friends.txt](http://test-realm-server/my-realm/best-friends.txt)
      `.trim(),
      ),
    );
    assert.ok(
      (userMessages[1]?.content as string).includes(
        `
Attached Files (files with newer versions don't show their content):
[spaghetti-recipe.gts](http://test-realm-server/my-realm/spaghetti-recipe.gts)
[best-friends.txt](http://test-realm-server/my-realm/best-friends.txt)
[file-that-does-not-exist.txt](http://test.com/my-realm/file-that-does-not-exist.txt): Error loading attached file: HTTP error. Status: 404
[example.pdf](http://test.com/my-realm/example.pdf): Error loading attached file: Unsupported file type: application/pdf. For now, only text files are supported.
      `.trim(),
      ),
    );
    assert.ok(
      (userMessages[2]?.content as string).includes(
        `
Attached Files (files with newer versions don't show their content):
[spaghetti-recipe.gts](http://test-realm-server/my-realm/spaghetti-recipe.gts):
  1: this is the content of the spaghetti-recipe.gts file
[best-friends.txt](http://test-realm-server/my-realm/best-friends.txt):
  1: this is the content of the best-friends.txt file
      `.trim(),
      ),
    );

    assert.ok(
      (prompt[prompt.length - 2].content as string).includes(
        'File open in code editor: http://test-realm-server/my-realm/spaghetti-recipe.gts',
      ),
      'Context should include the URL of the file open in the code editor',
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

  test('Handles multiple uploaded cards across user messages', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hey 1',
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
          body: 'Hey again with a newer version of the card plus a second card',
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
                      firstName: 'Newer Terry',
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
    const fullPrompt = await buildPromptForModel(
      history,
      '@aibot:localhost',
      undefined,
      undefined,
      [],
      fakeMatrixClient,
    );
    const userMessages = fullPrompt.filter(
      (message) => message.role === 'user',
    );
    assert.true(
      (userMessages[0]?.content as string).includes(
        'http://localhost:4201/experiments/Author/1',
      ),
    );
    assert.false(
      (userMessages[0]?.content as string).includes('"firstName": "Terry"'),
      'should not include the contents of the first version of the card in the first user message',
    );
    assert.true(
      (userMessages[1]?.content as string).includes(
        'http://localhost:4201/experiments/Author/1',
      ),
    );
    assert.true(
      (userMessages[1]?.content as string).includes(
        '"firstName": "Newer Terry"',
      ),
    );
    assert.true(
      (userMessages[1]?.content as string).includes(
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

    let userContextMessage = messages?.[messages.length - 2];
    assert.ok(
      (userContextMessage?.content as string).includes(nonEditableCardsMessage),
      'System context message should include the "unable to edit cards" message when there are attached cards and no tools, and no attached files, but was ' +
        userContextMessage?.content,
    );

    // Now add a tool
    let cardMessageContent = eventList[0].content as CardMessageContent;
    cardMessageContent.data.context ||= {};
    cardMessageContent.data.context.tools = [
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
      !(messages2?.[messages2.length - 2].content as string).includes(
        nonEditableCardsMessage,
      ),
      'System context message should not include the "unable to edit cards" message when there are attached cards and a tool',
    );

    // Now remove cards, tools, and add an attached file
    cardMessageContent.data.context.openCardIds = [];
    cardMessageContent.data.context.tools = [];
    cardMessageContent.data.attachedFiles = [
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
      !(messages3?.[messages3.length - 2].content as string).includes(
        nonEditableCardsMessage,
      ),
      'System context message should not include the "unable to edit cards" message when there is an attached file',
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
    const rawEvents = readFileSync(
      path.join(__dirname, 'resources/chats/added-skill.json'),
      'utf-8',
    );
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      replaceCatalogRealmURL(rawEvents),
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
          id: `${catalogRealmURL}Skill/generate-product-requirements`,
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
      await getPromptParts(eventList, '@aibot:localhost', fakeMatrixClient)
    ).messages!;
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'system');
    assert.true(
      (result[0].content[1] as TextContent).text.includes(
        SKILL_INSTRUCTIONS_MESSAGE,
      ),
    );
    assert.true(
      (result[0].content[2] as TextContent).text.includes(
        'Skill (id: https://cardstack.com/base/Skill/card-editing, title: Card Editing):',
      ),
      'includes skill title metadata when present',
    );
    assert.true(
      (result[0].content[2] as TextContent).text.includes(
        'If the user wants the data they see edited, AND the patchCardInstance function is available',
      ),
    );
    assert.true(
      (result[0].content[3] as TextContent).text.includes(
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
              module: `${catalogRealmURL}product-requirement-document`,
              name: 'ProductRequirementDocument',
            },
          },
        },
      }),
    });

    const result = (
      await getPromptParts(eventList, '@aibot:localhost', fakeMatrixClient)
    ).messages!;

    assert.equal(result[0].role, 'system');
    assert.true(
      (result[0].content[1] as TextContent).text.includes(
        SKILL_INSTRUCTIONS_MESSAGE,
      ),
    );
    assert.true(
      (result[0].content[2] as TextContent).text.includes(
        'If the user wants the data they see edited, AND the patchCardInstance function is available',
      ),
      'skill card instructions included in the system message',
    );
    assert.true(
      (result[0].content[3] as TextContent).text.includes(
        'Use pirate colloquialism when responding.',
      ),
      'skill card instructions included in the system message',
    );
    assert.equal(result[2].role, 'user');
    assert.true(
      (result[2].content as string).includes(
        '"appTitle": "Radio Episode Tracker for Nerds"',
      ),
      'attached card details included in the user message',
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
    let systemPromptParts = messages![0].content;
    assert.true(
      (systemPromptParts[1] as TextContent).text.includes(
        SKILL_INSTRUCTIONS_MESSAGE,
      ),
    );
    assert.false(
      (systemPromptParts as TextContent[])
        .map((c) => c.text)
        .some((text) => text.includes('This is skill 1')),
    );
    assert.true(
      (systemPromptParts[2] as TextContent).text.includes('This is skill 2'),
    );
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
    let systemPrompt = (messages![0].content as TextContent[])
      .map((c) => c.text)
      .join('\n');
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
    assert.true(
      (messages![0]!.content[1] as TextContent).text.includes(
        'Skill Instructions',
      ),
    );
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
    assert.true(
      (messages![0].content[1] as TextContent).text.includes(
        SKILL_INSTRUCTIONS_MESSAGE,
      ),
    );
    assert.false(
      (messages![0].content as TextContent[])
        .map((c) => c.text)
        .join('')
        .includes('SKILL_INSTRUCTIONS_V1'),
    );
    assert.true(
      (messages![0].content[2] as TextContent).text.includes(
        'Skill (id: skill-card-1):\nSKILL_INSTRUCTIONS_V2',
      ),
    );
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
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(messages!.length, 3);
    assert.equal(messages![2].role, 'user');
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
        sender: '@aibot:localhost',
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
        sender: '@aibot:localhost',
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
            context: {
              openCardIds: ['http://localhost:4201/drafts/Author/1'],
              tools: [],
              submode: 'interact',
              functions: [],
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
      '@aibot:localhost',
      fakeMatrixClient,
    );
    const result = await buildPromptForModel(
      history,
      '@aibot:localhost',
      tools,
      [],
      [],
      fakeMatrixClient,
    );
    assert.equal(result[5].role, 'tool');
    assert.equal(result[5].tool_call_id, 'tool-call-id-1');
    const expected = `Tool call executed, with result card: {"data":{"type":"card","attributes":{"title":"Search Results","description":"Here are the search results","results":[{"data":{"type":"card","id":"http://localhost:4201/drafts/Author/1","attributes":{"firstName":"Alice","lastName":"Enwunder","photo":null,"body":"Alice is a software engineer at Google.","description":null,"thumbnailURL":null},"meta":{"adoptsFrom":{"module":"../author","name":"Author"}}}}]},"meta":{"adoptsFrom":{"module":"https://cardstack.com/base/search-results","name":"SearchResults"}}}}.`;

    assert.equal((result[5].content as string).trim(), expected.trim());
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
      (toolCallMessage!.content as string).includes('Cloudy'),
      'Tool call result should include "Cloudy"',
    );
  });

  test('Responds to completion of lone tool call even when there is no result card', async function () {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/invoke-submode-swith-command.json',
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
      1,
      'Should have one tool call message',
    );
    assert.ok(
      (toolCallMessages[0].content as string).includes('Tool call executed'),
      'Tool call result should include "Tool call executed"',
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
      (toolCallMessages[0].content as string).includes('Cloudy'),
      'Tool call result should include "Cloudy"',
    );
    assert.ok(
      (toolCallMessages[1].content as string).includes('Sunny'),
      'Tool call result should include "Sunny"',
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

    const { messages, tools } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    // we should not have any tools available
    assert.true(tools!.length == 0, 'Should not have tools available');

    assert.equal(
      messages![1].content,
      `The user is currently viewing the following user interface:
Room ID: !XuZQzeYAGZzFQFYUzQ:localhost
Submode: interact
The user has no open cards.
Disabled skills: http://boxel.ai/skills/skill_card_editing

Current date and time: 2025-06-11T11:43:00.533Z
`,
    );
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

  test('Elides code blocks in prompt and includes results', async () => {
    // sending older codeblocks back to the model just confuses it and wastes tokens
    // so we need to remove them from the prompt
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/two-code-blocks-two-results.json',
        ),
        'utf-8',
      ),
    );

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.deepEqual(
      messages!.map((m) => m.role),
      ['system', 'user', 'assistant', 'system', 'user'],
    );
    assert.equal(
      messages![2].content,
      'Updating the file...\n' +
        'http://test.com/spaghetti-recipe.gts\n' +
        '[Omitting previously suggested and applied code change]\n' +
        '\n' +
        'I will also create a file for rigatoni:\n' +
        '\n' +
        'http://test.com/rigatoni-recipe.gts\n' +
        '[Omitting previously suggested code change that failed to apply]\n',
    );
  });

  test('Correctly handles server-side aggregations', async () => {
    // This test uses the /messages api with a filter removing
    // m.replace messages, relying on server side aggregation
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/server-side-aggregations.json'),
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

    // Set up mock responses for card downloads
    mockResponses.set('mxc://mock-server/card_v1', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'http://localhost:4201/admin/personal/BusinessCard/business_card',
          attributes: {
            title: 'Business Card V1',
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: skillCardRef,
          },
        },
      }),
    });

    // Set up mock responses for card downloads
    mockResponses.set('mxc://mock-server/card_v2', {
      ok: true,
      text: JSON.stringify({
        data: {
          type: 'card',
          id: 'http://localhost:4201/admin/personal/BusinessCard/business_card',
          attributes: {
            title: 'Business Card V2',
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
    assert.equal(messages!.length, 10);
    assert.equal(messages![0].role, 'system');
    assert.false(
      (messages![0].content as TextContent[])
        .map((c) => c.text)
        .join('')
        .includes('Business Card V1'),
    );
    assert.equal(messages![2].role, 'assistant');
    assert.equal(
      messages![2].content,
      'I see a card with the ID "http://localhost:4201/admin/personal/BusinessCard/business_card". It appears to be a business card for Jane Smith, a Senior Software Architect at Innovative Solutions Inc.',
    );
    assert.equal(messages![3].role, 'user');
    assert.true(
      (messages![3].content as string).startsWith(
        'change the name to stephanie',
      ),
    );
    assert.equal(messages![4].role, 'assistant');
    assert.equal(
      messages![4].tool_calls!.length,
      1,
      'Should have one tool call',
    );
    assert.equal(
      (messages![4].tool_calls![0] as ChatCompletionMessageFunctionToolCall)
        .function.name,
      'patchCardInstance',
      'Should have patchCardInstance tool call',
    );
    assert.true((messages![6].content as string).includes('Business Card V2'));
  });

  test('Responds to successful completion of lone code patch', async function () {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/one-code-block-one-success.json'),
        'utf-8',
      ),
    );
    const { shouldRespond, messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.strictEqual(shouldRespond, true, 'AiBot should solicit a response');
    // patch code results should be included
    const userMessages = messages!.filter((message) => message.role === 'user');
    assert.strictEqual(userMessages.length, 2, 'Should have two user messages');
    assert.strictEqual(
      userMessages[1].content,
      '(The user has successfully applied code patch 1.)',
    );
  });

  test('Does not respond to first code patch result when two patches were proposed', async function () {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/two-code-blocks-one-result.json'),
        'utf-8',
      ),
    );
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

  test('Responds to second code patch result when two patches were proposed', async function () {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/two-code-blocks-two-results.json',
        ),
        'utf-8',
      ),
    );

    const { shouldRespond, messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.strictEqual(shouldRespond, true, 'AiBot should solicit a response');
    // patch code results should be deserialised
    const userMessages = messages!.filter((message) => message.role === 'user');
    assert.strictEqual(
      userMessages.length,
      2,
      'Should have three two messages',
    );
    assert.strictEqual(
      userMessages[1].content,
      '(The user has successfully applied code patch 1.)\n(The user tried to apply code patch 2 but there was an error: The patch did not apply cleanly.)',
    );
  });

  test('Does not respond to code patch result when a command is also proposed', async function () {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/code-block-and-command-one-result.json',
        ),
        'utf-8',
      ),
    );
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

  test('Responds to command result when patch and command proposed and patch already succeeded', async function () {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/code-block-and-command-two-results-a.json',
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

    const { shouldRespond, messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.strictEqual(shouldRespond, true, 'AiBot should solicit a response');
    assert.deepEqual(
      messages!.map((m) => m.role),
      ['system', 'user', 'assistant', 'tool', 'system', 'user'],
    );
    // patch code results should be deserialised
    const userMessages = messages!.filter((message) => message.role === 'user');
    assert.strictEqual(
      userMessages.length,
      2,
      'Should have three user messages',
    );
    assert.strictEqual(
      userMessages[1].content,
      '(The user has successfully applied code patch 1.)',
    );
    const toolResultMessages = messages!.filter(
      (message) => message.role === 'tool',
    );
    assert.strictEqual(
      toolResultMessages.length,
      1,
      'Should have one tool result message',
    );
    assert.ok(
      (toolResultMessages[0].content as string).includes('Cloudy'),
      'Tool call result should include "Cloudy"',
    );
  });

  test('Responds to command result when patch and command proposed and patch already succeeded with command succeeding first', async function () {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          'resources/chats/code-block-and-command-two-results-b.json',
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

    const { shouldRespond, messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.strictEqual(shouldRespond, true, 'AiBot should solicit a response');
    assert.deepEqual(
      messages!.map((m) => m.role),
      ['system', 'user', 'assistant', 'tool', 'system', 'user'],
    );
    // patch code results should be messages
    const userMessages = messages!.filter((message) => message.role === 'user');
    assert.strictEqual(
      userMessages.length,
      2,
      'Should have three user messages',
    );
    assert.strictEqual(
      userMessages[1].content,
      '(The user has successfully applied code patch 1.)',
    );
    const toolResultMessages = messages!.filter(
      (message) => message.role === 'tool',
    );
    assert.strictEqual(
      toolResultMessages.length,
      1,
      'Should have one tool result message',
    );
    assert.ok(
      (toolResultMessages[0].content as string).includes('Cloudy'),
      'Tool call result should include "Cloudy"',
    );
  });

  test('Responds to failure of lone code patch', async function () {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/one-code-block-one-failure.json'),
        'utf-8',
      ),
    );
    const { shouldRespond, messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.strictEqual(shouldRespond, true, 'AiBot should solicit a response');
    // patch code results should be included
    const userMessages = messages!.filter((message) => message.role === 'user');
    assert.strictEqual(userMessages.length, 2, 'Should have two user messages');
    assert.strictEqual(
      userMessages[1].content,
      '(The user tried to apply code patch 1 but there was an error: The patch did not apply cleanly.)',
    );
  });

  test('context message is placed before last user message when just one user message', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/user-message-last-single.json'),
        'utf-8',
      ),
    );

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(messages![0].role, 'system');
    assert.equal(messages![1].role, 'system');
    assert.equal(messages![2].role, 'user');
  });

  test('context message is placed before last user message when multiple user messages', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/user-message-last-multiple.json'),
        'utf-8',
      ),
    );

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(messages![0].role, 'system');
    assert.equal(messages![1].role, 'user');
    assert.equal(messages![2].role, 'assistant');
    assert.equal(messages![3].role, 'system');
    assert.equal(messages![4].role, 'user');
  });

  test('context message is placed after the last tool call if the last message is a tool call', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/tool-call-last.json'),
        'utf-8',
      ),
    );

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(messages![0].role, 'system');
    assert.equal(messages![1].role, 'user');
    assert.equal(messages![2].role, 'assistant');
    assert.equal(messages![3].role, 'user');
    assert.equal(messages![4].role, 'assistant');
    assert.equal(messages![5].role, 'user');
    assert.equal(messages![6].role, 'assistant');
    assert.equal(messages![7].role, 'tool');
    assert.equal(messages![8].role, 'system');
  });

  test('context message is placed after the last user message if the last message is an assistant message', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/assistant-message-last.json'),
        'utf-8',
      ),
    );

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(messages![0].role, 'system');
    assert.equal(messages![1].role, 'system');
    assert.equal(messages![2].role, 'user');
    assert.equal(messages![3].role, 'assistant');
  });

  test('context message contains the current date and time', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/user-message-last-multiple.json'),
        'utf-8',
      ),
    );

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.equal(messages![3].role, 'system');
    assert.true(
      !!(messages![3].content as string).match(
        /Current date and time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      ),
      'Context message should contain the current date and time but was ' +
        messages![3].content,
    );
  });

  test('tool call messages include attached files when command result does', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/read-gts-file.json'),
        'utf-8',
      ),
    );

    mockResponses.set('mxc://mock-server/postcard', {
      ok: true,
      text: `export default Postcard extends CardDef {}
      `,
    });

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    const toolCallMessage = messages!.findLast(
      (message) => message.role === 'tool',
    );
    assert.ok(toolCallMessage, 'Should have a tool call message');
    assert.true(
      (toolCallMessage!.content as string).includes('executed'),
      'Tool call result should reflect that the tool was executed',
    );
    assert.true(
      (toolCallMessage!.content as string).includes(
        `
Attached Files (files with newer versions don't show their content):
[postcard.gts](http://test-realm-server/user/test-realm/postcard.gts):
  1: export default Postcard extends CardDef {}
      `.trim(),
      ),
      'Tool call result should include attached files',
    );
  });

  test('tool call messages include attached cards when command result does', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/read-card.json'),
        'utf-8',
      ),
    );

    mockResponses.set('mxc://mock-server/nashville', {
      ok: true,
      text: `{"data":{"type":"card","attributes":{"recipientName":"Jennifer Martinez","recipientAddress":{"streetAddress":"789 Pine Ridge Drive","city":"Austin","state":"TX","postalCode":"78701","country":"USA"},"postageAmount":0.68,"message":"# Howdy from the Music Capital!\n\nSpent the day on South by Southwest - so many amazing bands and food trucks! Had the best BBQ brisket of my life and caught three live shows. The energy here is infectious.\n\n**Keep it weird!**  \n*Jake*","title":"Nashville","description":null,"thumbnailURL":null},"meta":{"adoptsFrom":{"module":"../postcard","name":"Postcard"}}}}`,
    });

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    const toolCallMessage = messages!.findLast(
      (message) => message.role === 'tool',
    );
    assert.ok(toolCallMessage, 'Should have a tool call message');
    assert.true(
      (toolCallMessage!.content as string).includes('executed'),
      'Tool call result should reflect that the tool was executed',
    );
    assert.true(
      (toolCallMessage!.content as string).includes(
        `
Attached Cards (cards with newer versions don't show their content):
[
  {
    "url": "mxc://mock-server/nashville",
    "sourceUrl": "http://test-realm-server/user/test-realm/Postcard/46268158-2eb9-4025-804d-45c299017e8f",
    "name": "Nashville",
    "contentType": "application/vnd.card+json",
    "content": "{\\"data\\":{\\"type\\":\\"card\\",\\"attributes\\":{\\"recipientName\\":\\"Jennifer Martinez\\",\\"recipientAddress\\":{\\"streetAddress\\":\\"789 Pine Ridge Drive\\",\\"city\\":\\"Austin\\",\\"state\\":\\"TX\\",\\"postalCode\\":\\"78701\\",\\"country\\":\\"USA\\"},\\"postageAmount\\":0.68,\\"message\\":\\"# Howdy from the Music Capital!\\n\\nSpent the day on South by Southwest - so many amazing bands and food trucks! Had the best BBQ brisket of my life and caught three live shows. The energy here is infectious.\\n\\n**Keep it weird!**  \\n*Jake*\\",\\"title\\":\\"Nashville\\",\\"description\\":null,\\"thumbnailURL\\":null},\\"meta\\":{\\"adoptsFrom\\":{\\"module\\":\\"../postcard\\",\\"name\\":\\"Postcard\\"}}}}"
  }
]
      `.trim(),
      ),
      'Tool call result should include attached cards',
    );
  });

  test('code patch messages include attached files when code patch result does', async () => {
    const eventList: DiscreteMatrixEvent[] = JSON.parse(
      readFileSync(
        path.join(__dirname, 'resources/chats/patched-gts.json'),
        'utf-8',
      ),
    );

    mockResponses.set('mxc://mock-server/postcard-before-patch.gts', {
      ok: true,
      text: `export default Postcard extends CardDef { /* before *}
      `,
    });
    mockResponses.set('mxc://mock-server/postcard-after-patch.gts', {
      ok: true,
      text: `export default Postcard extends CardDef { /* after */ }
      `,
    });

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    const lastUserMessage = messages!.findLast(
      (message) => message.role === 'user',
    );
    assert.ok(lastUserMessage, 'Should have a code patch result message');
    assert.ok(
      (lastUserMessage!.content as string).includes(
        'The user has successfully applied code patch 1.',
      ),
      'Code patch result should reflect that the code patch was applied',
    );
    assert.ok(
      (lastUserMessage!.content as string).includes(
        `
Attached Files (files with newer versions don't show their content):
[postcard.gts](http://test-realm-server/user/test-realm/postcard.gts):
  1: export default Postcard extends CardDef { /* after */ }
      `.trim(),
      ),
      'Code patch result should include attached files',
    );
  });

  test('getPromptParts surfaces pending code patch correctness summary after patches', async function () {
    const roomId = 'room-checks';
    const aiMessageId = 'ai-message';
    const cardId = 'http://localhost/cards/Profile/1';
    const patchedFileSource =
      'http://localhost/files/src/components/button.gts';

    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: 'user-message',
        origin_server_ts: 1,
        room_id: roomId,
        sender: '@user:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: 'Please update the profile card and button styles.',
          format: 'org.matrix.custom.html',
          data: {
            context: {
              realmUrl: 'http://localhost:4201/test',
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'user-message',
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: aiMessageId,
        origin_server_ts: 2,
        room_id: roomId,
        sender: '@aibot:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: `Updating the file...
${patchedFileSource}
╔═══ SEARCH ════╗
old content
╠═══════════════╣
new content
╚═══ REPLACE ═══╝
`,
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          data: {
            context: {
              realmUrl: 'http://localhost:4201/test',
              tools: [],
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'patch-card',
              name: 'patchCardInstance',
              arguments: JSON.stringify({
                description: 'Update the profile card',
                attributes: {
                  cardId,
                  patch: { attributes: { name: 'Updated Name' } },
                },
              }),
            },
          ],
        },
        unsigned: {
          age: 0,
          transaction_id: aiMessageId,
        },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
        event_id: 'patch-result',
        origin_server_ts: 3,
        room_id: roomId,
        sender: '@user:localhost',
        content: {
          msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
          'm.relates_to': {
            event_id: aiMessageId,
            key: 'applied',
            rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
          },
          codeBlockIndex: 0,
          data: {
            context: {
              tools: [],
              functions: [],
            },
            attachedFiles: [
              {
                sourceUrl: patchedFileSource,
                url: patchedFileSource,
                name: 'button.gts',
                contentType: 'text/plain',
              },
            ],
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'patch-result',
        },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
        event_id: 'command-result',
        origin_server_ts: 4,
        room_id: roomId,
        sender: '@admin:localhost',
        content: {
          msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
          'm.relates_to': {
            event_id: aiMessageId,
            key: 'applied',
            rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          },
          commandRequestId: 'patch-card',
          data: {
            card: {
              url: 'mxc://mock-server/profile-card',
              sourceUrl: 'http://mock/card',
              name: 'ProfileCard',
              contentType: 'application/vnd.card+json',
              content: JSON.stringify({ data: { id: cardId } }),
            },
            context: {
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'command-result',
        },
        status: EventStatus.SENT,
      },
    ];

    const { pendingCodePatchCorrectnessChecks } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );

    assert.ok(
      pendingCodePatchCorrectnessChecks,
      'Should collect pending code patch correctness info',
    );
    assert.strictEqual(
      pendingCodePatchCorrectnessChecks?.targetEventId,
      aiMessageId,
      'Summary should target the AI message with patches',
    );
    assert.strictEqual(
      pendingCodePatchCorrectnessChecks?.roomId,
      roomId,
      'Summary should include the room id',
    );
    assert.deepEqual(
      pendingCodePatchCorrectnessChecks?.files,
      [
        {
          sourceUrl: patchedFileSource,
          displayName: 'files/src/components/button.gts',
        },
      ],
      'Patched files should be surfaced',
    );
    assert.deepEqual(
      pendingCodePatchCorrectnessChecks?.cards,
      [{ cardId }],
      'Patched cards should be surfaced',
    );
  });

  test('getPromptParts ignores cancelled patch commands when collecting pending code patch correctness checks', async function () {
    const roomId = 'room-checks-cancelled';
    const aiMessageId = 'ai-message';
    const cancelledAiMessageId = 'cancelled-ai-message';
    const cardId = 'http://localhost/cards/Profile/1';
    const patchedFileSource = 'http://localhost/realm/button.gts';

    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: cancelledAiMessageId,
        origin_server_ts: 0,
        room_id: roomId,
        sender: '@aibot:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: '',
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          isCanceled: true,
          data: {
            context: {
              tools: [],
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'cancelled-patch',
              name: 'patchFields',
              arguments: JSON.stringify({
                description: 'Cancelled patch request',
                attributes: {
                  cardId,
                  patch: { attributes: { name: 'Cancelled' } },
                },
              }),
            },
          ],
        },
        unsigned: {
          age: 0,
          transaction_id: cancelledAiMessageId,
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: 'user-message',
        origin_server_ts: 1,
        room_id: roomId,
        sender: '@user:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: 'Please update the profile card and button styles.',
          format: 'org.matrix.custom.html',
          data: {
            context: {
              realmUrl: 'http://localhost:4201/test',
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'user-message',
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: aiMessageId,
        origin_server_ts: 2,
        room_id: roomId,
        sender: '@aibot:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: `Updating the file...
${patchedFileSource}
╔═══ SEARCH ════╗
old content
╠═══════════════╣
new content
╚═══ REPLACE ═══╝
`,
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          data: {
            context: {
              realmUrl: 'http://localhost:4201/test',
              tools: [],
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'patch-card',
              name: 'patchCardInstance',
              arguments: JSON.stringify({
                description: 'Update the profile card',
                attributes: {
                  cardId,
                  patch: { attributes: { name: 'Updated Name' } },
                },
              }),
            },
          ],
        },
        unsigned: {
          age: 0,
          transaction_id: aiMessageId,
        },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
        event_id: 'patch-result',
        origin_server_ts: 3,
        room_id: roomId,
        sender: '@user:localhost',
        content: {
          msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
          'm.relates_to': {
            event_id: aiMessageId,
            key: 'applied',
            rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
          },
          codeBlockIndex: 0,
          data: {
            context: {
              tools: [],
              functions: [],
            },
            attachedFiles: [
              {
                sourceUrl: patchedFileSource,
                url: patchedFileSource,
                name: 'button.gts',
                contentType: 'text/plain',
              },
            ],
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'patch-result',
        },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
        event_id: 'command-result',
        origin_server_ts: 4,
        room_id: roomId,
        sender: '@admin:localhost',
        content: {
          msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
          'm.relates_to': {
            event_id: aiMessageId,
            key: 'applied',
            rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          },
          commandRequestId: 'patch-card',
          data: {
            card: {
              url: 'mxc://mock-server/profile-card',
              sourceUrl: 'http://mock/card',
              name: 'ProfileCard',
              contentType: 'application/vnd.card+json',
              content: JSON.stringify({ data: { id: cardId } }),
            },
            context: {
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'command-result',
        },
        status: EventStatus.SENT,
      },
    ];

    const { pendingCodePatchCorrectnessChecks } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );

    assert.ok(
      pendingCodePatchCorrectnessChecks,
      'Should collect pending code patch correctness info even after a cancelled command',
    );
    assert.strictEqual(
      pendingCodePatchCorrectnessChecks?.targetEventId,
      aiMessageId,
      'Summary should target the AI message with patches',
    );
  });

  test('getPromptParts ignores older unresolved commands when a newer code patch is applied', async function () {
    const roomId = 'room-checks-older-unresolved';
    const aiMessageId = 'ai-message';
    const olderAiMessageId = 'older-ai-message';
    const patchedFileSource = 'http://localhost/realm/button.gts';

    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: 'user-message',
        origin_server_ts: 1,
        room_id: roomId,
        sender: '@user:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: 'Please update the profile card.',
          format: 'org.matrix.custom.html',
          data: {
            context: {
              realmUrl: 'http://localhost:4201/test',
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'user-message',
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: olderAiMessageId,
        origin_server_ts: 2,
        room_id: roomId,
        sender: '@aibot:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: 'Earlier command that never finished.',
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          data: {
            context: {
              tools: [],
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'stale-command',
              name: 'patchFields',
              arguments: JSON.stringify({
                description: 'Stale command',
                attributes: {
                  cardId: 'http://localhost/cards/Old/1',
                  patch: { attributes: { name: 'Stale' } },
                },
              }),
            },
          ],
        },
        unsigned: {
          age: 0,
          transaction_id: olderAiMessageId,
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: aiMessageId,
        origin_server_ts: 3,
        room_id: roomId,
        sender: '@aibot:localhost',
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: `Updating the file...
${patchedFileSource}
╔═══ SEARCH ════╗
old content
╠═══════════════╣
new content
╚═══ REPLACE ═══╝
`,
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          data: {
            context: {
              realmUrl: 'http://localhost:4201/test',
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: {
          age: 0,
          transaction_id: aiMessageId,
        },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
        event_id: 'patch-result',
        origin_server_ts: 4,
        room_id: roomId,
        sender: '@user:localhost',
        content: {
          msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
          'm.relates_to': {
            event_id: aiMessageId,
            key: 'applied',
            rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
          },
          codeBlockIndex: 0,
          data: {
            context: {
              tools: [],
              functions: [],
            },
            attachedFiles: [
              {
                sourceUrl: patchedFileSource,
                url: patchedFileSource,
                name: 'button.gts',
                contentType: 'text/plain',
              },
            ],
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'patch-result',
        },
        status: EventStatus.SENT,
      },
    ];

    const { pendingCodePatchCorrectnessChecks } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );

    assert.ok(
      pendingCodePatchCorrectnessChecks,
      'Should collect pending code patch correctness despite older unresolved commands',
    );
    assert.strictEqual(
      pendingCodePatchCorrectnessChecks?.targetEventId,
      aiMessageId,
      'Summary should target the latest AI patch message',
    );
    assert.deepEqual(
      pendingCodePatchCorrectnessChecks?.files,
      [
        {
          sourceUrl: patchedFileSource,
          displayName: 'realm/button.gts',
        },
      ],
      'Patched files should be surfaced',
    );
  });

  test('caps automated correctness fix attempts at three failures', async function () {
    const roomId = '!room:localhost';
    const targetRef = 'http://localhost/files/example.gts';

    function buildAiMessage(index: number, requestId: string) {
      return {
        type: 'm.room.message',
        event_id: `ai-message-${index}`,
        room_id: roomId,
        sender: '@aibot:localhost',
        origin_server_ts: index * 10 + 2,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: `Attempt ${index}`,
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          data: {
            context: {
              tools: [],
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: `check-${requestId}`,
              name: 'checkCorrectness',
              arguments: JSON.stringify({
                description: `Check attempt ${index}`,
                attributes: {
                  targetType: 'file',
                  targetRef,
                  fileUrl: targetRef,
                  roomId,
                  correctnessCheckAttempt: index,
                },
              }),
            },
          ],
        },
        unsigned: {
          age: 0,
          transaction_id: `ai-message-${index}`,
        },
        status: EventStatus.SENT,
      } as DiscreteMatrixEvent;
    }

    function buildCommandResult(
      index: number,
      requestId: string,
      relatesToId: string,
      errorText: string,
    ): DiscreteMatrixEvent {
      return {
        type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
        event_id: `command-result-${index}`,
        room_id: roomId,
        sender: '@command:localhost',
        origin_server_ts: index * 10 + 3,
        content: {
          msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
          commandRequestId: requestId,
          'm.relates_to': {
            event_id: relatesToId,
            key: 'applied',
            rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          },
          data: {
            card: {
              sourceUrl: `http://localhost/correctness/${index}.json`,
              url: `http://localhost/correctness/${index}.json`,
              name: `correctness-${index}.json`,
              contentType: 'application/json',
              content: JSON.stringify({
                data: {
                  attributes: {
                    correct: false,
                    errors: [errorText],
                    warnings: [],
                  },
                },
              }),
            },
            context: {
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: {
          age: 0,
          transaction_id: `command-result-${index}`,
        },
        status: EventStatus.SENT,
      };
    }

    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: 'user-message',
        room_id: roomId,
        sender: '@user:localhost',
        origin_server_ts: 1,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: 'Please fix the file and run correctness checks.',
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          data: {
            context: {
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: {
          age: 0,
          transaction_id: 'user-message',
        },
        status: EventStatus.SENT,
      },
      buildAiMessage(1, '1'),
      buildCommandResult(1, 'check-1', 'ai-message-1', 'first failure'),
      buildAiMessage(2, '2'),
      buildCommandResult(2, 'check-2', 'ai-message-2', 'second failure'),
      buildAiMessage(3, '3'),
      buildCommandResult(3, 'check-3', 'ai-message-3', 'still failing'),
    ];

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );

    assert.ok(messages, 'Expected prompt messages to be constructed');

    let userMessages =
      messages?.filter((message) => message.role === 'user') ?? [];
    let retryMessages = userMessages.filter((message) =>
      (message.content as string).includes(
        'Propose fixes for the above errors',
      ),
    );
    assert.strictEqual(
      retryMessages.length,
      2,
      'Only the first two failures should request more SEARCH/REPLACE fixes',
    );

    let finalUserMessage = userMessages[userMessages.length - 1];
    assert.ok(
      (finalUserMessage?.content as string).includes(
        'Automated correctness fixes have already been attempted 3 times',
      ),
      'After three failures the prompt should ask to stop automated fixes',
    );
    assert.notOk(
      (finalUserMessage?.content as string).includes(
        'Propose fixes for the above errors',
      ),
      'The final prompt should not ask for another round of fixes',
    );
  });

  test('correctness attempts reset when a new patch event starts for the same target', async function () {
    const roomId = '!room:localhost';
    const targetRef = 'http://localhost/files/example.gts';

    const firstEventId = 'ai-message-1';
    const secondEventId = 'ai-message-2';

    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: firstEventId,
        room_id: roomId,
        sender: '@aibot:localhost',
        origin_server_ts: 1,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: 'First patch',
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'check-first',
              name: 'checkCorrectness',
              arguments: JSON.stringify({
                description: 'First correctness check',
                attributes: {
                  targetType: 'file',
                  targetRef,
                  fileUrl: targetRef,
                  roomId,
                  targetEventId: firstEventId,
                  correctnessCheckAttempt: 2,
                },
              }),
            },
          ],
          data: {
            context: {
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: { age: 0, transaction_id: firstEventId },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
        event_id: 'command-result-1',
        room_id: roomId,
        sender: '@command:localhost',
        origin_server_ts: 2,
        content: {
          msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
          commandRequestId: 'check-first',
          'm.relates_to': {
            event_id: firstEventId,
            key: 'applied',
            rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          },
          data: {
            card: {
              sourceUrl: `${targetRef}-first.json`,
              url: `${targetRef}-first.json`,
              name: 'correctness-first.json',
              contentType: 'application/json',
              content: JSON.stringify({
                data: {
                  attributes: {
                    correct: false,
                    errors: ['still broken'],
                    warnings: [],
                  },
                },
              }),
            },
          },
        },
        unsigned: { age: 0, transaction_id: 'command-result-1' },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: secondEventId,
        room_id: roomId,
        sender: '@aibot:localhost',
        origin_server_ts: 3,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: 'Second patch',
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'check-second',
              name: 'checkCorrectness',
              arguments: JSON.stringify({
                description: 'Second correctness check',
                attributes: {
                  targetType: 'file',
                  targetRef,
                  fileUrl: targetRef,
                  roomId,
                  targetEventId: secondEventId,
                  correctnessCheckAttempt: 1,
                },
              }),
            },
          ],
          data: {
            context: {
              tools: [],
              functions: [],
            },
          },
        },
        unsigned: { age: 0, transaction_id: secondEventId },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
        event_id: 'command-result-2',
        room_id: roomId,
        sender: '@command:localhost',
        origin_server_ts: 4,
        content: {
          msgtype: APP_BOXEL_COMMAND_RESULT_WITH_OUTPUT_MSGTYPE,
          commandRequestId: 'check-second',
          'm.relates_to': {
            event_id: secondEventId,
            key: 'applied',
            rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          },
          data: {
            card: {
              sourceUrl: `${targetRef}-second.json`,
              url: `${targetRef}-second.json`,
              name: 'correctness-second.json',
              contentType: 'application/json',
              content: JSON.stringify({
                data: {
                  attributes: {
                    correct: false,
                    errors: ['new patch still failing'],
                    warnings: [],
                  },
                },
              }),
            },
          },
        },
        unsigned: { age: 0, transaction_id: 'command-result-2' },
        status: EventStatus.SENT,
      },
    ];

    const { messages } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );

    let toolMessages =
      messages?.filter((message) => message.role === 'tool') ?? [];

    let secondToolMessage = toolMessages.find(
      (message) => message.tool_call_id === 'check-second',
    );
    assert.ok(secondToolMessage, 'Second correctness result should be present');
    assert.ok(
      (secondToolMessage!.content as string).includes(
        'attempts so far: 1 of 3',
      ),
      'Correctness attempts reset to the first attempt when a new patch event begins for the same target',
    );
  });

  test('getPromptParts toggles correctness summary and patch result prompts based on autoCorrectnessChecksEnabled option', async function () {
    const roomId = '!room:localhost';
    const aiMessageId = '$ai-msg';
    const eventList: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '$user-msg',
        room_id: roomId,
        sender: '@user:localhost',
        origin_server_ts: 1,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: 'Please fix the file and run correctness checks.',
          format: 'org.matrix.custom.html',
          data: {
            context: {
              tools: [],
              functions: [],
            },
          },
          isStreamingFinished: true,
        },
        unsigned: {
          age: 0,
          transaction_id: '$user-msg',
        },
        status: EventStatus.SENT,
      },
      {
        type: 'm.room.message',
        event_id: aiMessageId,
        room_id: roomId,
        sender: '@aibot:localhost',
        origin_server_ts: 2,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          body: `Applying patch...
http://localhost/example.gts
╔═══ SEARCH ════╗
old
╠═══════════════╣
new
╚═══ REPLACE ═══╝
`,
          format: 'org.matrix.custom.html',
          isStreamingFinished: true,
          data: {
            context: {
              tools: [],
              functions: [],
            },
          },
          [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
            {
              id: 'check-1',
              name: 'checkCorrectness',
              arguments: JSON.stringify({
                description: 'Check file correctness',
                attributes: {
                  targetType: 'file',
                  targetRef: 'http://localhost/example.gts',
                  fileUrl: 'http://localhost/example.gts',
                  roomId,
                },
              }),
            },
          ],
        },
        unsigned: {
          age: 0,
          transaction_id: aiMessageId,
        },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
        event_id: '$patch-result',
        room_id: roomId,
        sender: '@user:localhost',
        origin_server_ts: 3,
        content: {
          msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
          codeBlockIndex: 0,
          'm.relates_to': {
            event_id: aiMessageId,
            key: 'applied',
            rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
          },
          data: {
            context: {
              tools: [],
              functions: [],
              submode: 'code',
            },
            attachedFiles: [],
          },
        },
        unsigned: {
          age: 0,
          transaction_id: '$patch-result',
        },
        status: EventStatus.SENT,
      },
      {
        type: APP_BOXEL_COMMAND_RESULT_EVENT_TYPE,
        event_id: '$command-result',
        room_id: roomId,
        sender: '@command:localhost',
        origin_server_ts: 4,
        content: {
          msgtype: APP_BOXEL_COMMAND_RESULT_WITH_NO_OUTPUT_MSGTYPE,
          commandRequestId: 'check-1',
          'm.relates_to': {
            event_id: aiMessageId,
            key: 'applied',
            rel_type: APP_BOXEL_COMMAND_RESULT_REL_TYPE,
          },
          data: {
            context: {
              tools: [],
              functions: [],
            },
            attachedFiles: [],
          },
        },
        unsigned: {
          age: 0,
          transaction_id: '$command-result',
        },
        status: EventStatus.SENT,
      },
    ];

    const summaryMessage =
      'The automated correctness checks have finished. Summarize their results for me based on the tool output above.';

    const promptPartsWithAutoCorrectnessChecksDisabled = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
      { autoCorrectnessChecksEnabled: false },
    );
    let disabledUserMessages =
      promptPartsWithAutoCorrectnessChecksDisabled.messages?.filter(
        (message) => message.role === 'user',
      ) ?? [];
    assert.false(
      disabledUserMessages.some(
        (message) => message.content === summaryMessage,
      ),
      'When disabled the automated summary should be omitted',
    );
    assert.true(
      disabledUserMessages.some((message) =>
        (message.content as string).includes(
          'The user has successfully applied code patch 1.',
        ),
      ),
      'When disabled the code patch result message should be included',
    );

    const promptPartsWithAutoCorrectnessChecksEnabled = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
      { autoCorrectnessChecksEnabled: true },
    );
    let enabledUserMessages =
      promptPartsWithAutoCorrectnessChecksEnabled.messages?.filter(
        (message) => message.role === 'user',
      ) ?? [];
    assert.true(
      enabledUserMessages.some((message) => message.content === summaryMessage),
      'When enabled the summary should be included',
    );
    assert.false(
      enabledUserMessages.some((message) =>
        (message.content as string).includes(
          'The user has successfully applied code patch 1.',
        ),
      ),
      'When enabled the legacy code patch result message should be omitted',
    );
  });

  test('system message parts include cache_control directive on last part', async () => {
    const history: DiscreteMatrixEvent[] = [
      {
        type: 'm.room.message',
        event_id: '1',
        origin_server_ts: 1234567890,
        content: {
          msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
          format: 'org.matrix.custom.html',
          body: 'Hello',
          isStreamingFinished: true,
          data: {
            context: {
              realmUrl: 'http://localhost:4201/experiments',
              submode: 'interact',
              tools: [],
              functions: [],
            },
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

    // Create some skill cards to ensure we have multiple system message parts
    const skillCards: LooseCardResource[] = [
      {
        id: 'http://localhost:4201/skills/skill-1',
        type: 'card',
        attributes: {
          title: 'Test Skill',
          instructions: 'Test instructions for skill 1',
        },
        meta: {
          adoptsFrom: skillCardRef,
        },
      },
      {
        id: 'http://localhost:4201/skills/skill-2',
        type: 'card',
        attributes: {
          title: 'Another Skill',
          instructions: 'Test instructions for skill 2',
        },
        meta: {
          adoptsFrom: skillCardRef,
        },
      },
    ];

    const result = await buildPromptForModel(
      history,
      '@aibot:localhost',
      [],
      skillCards,
      [],
      fakeMatrixClient,
    );

    // Find the system message
    const systemMessage = result.find((msg) => msg.role === 'system');
    assert.ok(systemMessage, 'Should have a system message');

    const content = systemMessage!.content;
    assert.ok(
      Array.isArray(content),
      'System message content should be an array',
    );

    const contentParts = content as TextContent[];
    assert.true(
      contentParts.length > 1,
      'Should have multiple system message parts',
    );

    // Check that all parts except the last don't have cache_control
    for (let i = 0; i < contentParts.length - 1; i++) {
      assert.equal(
        contentParts[i].type,
        'text',
        `Part ${i} should be text type`,
      );
      assert.notOk(
        contentParts[i].cache_control,
        `Part ${i} should not have cache_control`,
      );
    }

    // Check that the last part has cache_control
    const lastPart = contentParts[contentParts.length - 1];
    assert.equal(lastPart.type, 'text', 'Last part should be text type');
    assert.ok(lastPart.cache_control, 'Last part should have cache_control');
    assert.deepEqual(
      lastPart.cache_control,
      { type: 'ephemeral' },
      'cache_control should be set to ephemeral',
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

    const { model, toolsSupported, reasoningEffort } = await getPromptParts(
      eventList,
      '@aibot:localhost',
      fakeMatrixClient,
    );
    assert.strictEqual(model, 'google/gemini-pro-1.5');
    assert.strictEqual(toolsSupported, true);
    assert.strictEqual(reasoningEffort, 'minimal');
  });
});
