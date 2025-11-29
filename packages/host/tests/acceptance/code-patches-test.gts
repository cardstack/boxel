import { click, waitFor, find, findAll, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, skip, test } from 'qunit';

import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
  baseRealm,
  skillCardRef,
} from '@cardstack/runtime-common';

import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
  getMonacoContent,
  TestContextWithSave,
} from '../helpers';

import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

let mockedFileContent = 'Hello, world!';

const testCardContent = `
import { CardDef, Component, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class TestCard extends CardDef {
  static displayName = 'Test Card';

  @field name = contains(StringField);
  @field description = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div data-test-test-card>
        <h1>{{@model.name}}</h1>
        <p>{{@model.description}}</p>
      </div>
    </template>
  };
}
`;

module('Acceptance | Code patches tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  let { simulateRemoteMessage, getRoomIds, getRoomEvents, createAndJoinRoom } =
    mockMatrixUtils;

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    getService('matrix-service').fetchMatrixHostedFile = async (url) => {
      // Mock different file contents based on the URL
      if (url.includes('test-card.gts')) {
        return new Response(testCardContent);
      }
      return new Response(mockedFileContent);
    };

    await createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
        'hello.txt': 'Hello, world!',
        'hi.txt': 'Hi, world!\nHow are you?',
        'test-card.gts': testCardContent,
        'Skill/useful-commands.json': {
          data: {
            type: 'card',
            attributes: {
              instructions:
                'Here are few commands you might find useful: * switch-submode: use this with "code" to go to code mode and "interact" to go to interact mode. * search-cards-by-type-and-title: search for cards by name or description.',
              commands: [
                {
                  codeRef: {
                    name: 'SearchCardsByTypeAndTitleCommand',
                    module: '@cardstack/boxel-host/commands/search-cards',
                  },
                  requiresApproval: true,
                },
                {
                  codeRef: {
                    name: 'default',
                    module: '@cardstack/boxel-host/commands/switch-submode',
                  },
                  requiresApproval: true,
                },
                {
                  codeRef: {
                    name: 'default',
                    module: '@cardstack/boxel-host/commands/show-card',
                  },
                  requiresApproval: true,
                },
              ],
              title: 'Useful Commands',
              description: null,
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: skillCardRef,
            },
          },
        },
      },
    });
  });

  test('can patch code', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}\n\`\`\``;

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'Hey there respond with a code patch to update the hello.txt file',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: {
        attachedFiles: [
          {
            url: 'http://test-realm/test/hello.txt',
            name: 'hello.txt',
            sourceUrl: 'http://test-realm/test/hello.txt',
          },
        ],
      },
    });

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    let originalContent = getMonacoContent();
    assert.strictEqual(originalContent, 'Hello, world!');
    await waitFor('[data-test-apply-code-button]');
    await click('[data-test-apply-code-button]');
    await waitUntil(() => getMonacoContent() === 'Hi, world!');

    // We test the value of the attribute because navigator.clipboard is not available in test environment
    // (we can't test if the content is copied to the clipboard but we can assert the value of the attribute)

    await click('[data-test-attached-file-dropdown-button="hello.txt"]');

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-copy-file-content]')
          ?.getAttribute('data-test-copy-file-content') === mockedFileContent,
    );

    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.event_id === eventId &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      codePatchResultEvents.length,
      1,
      'code patch result event is dispatched',
    );
    assert.strictEqual(
      codePatchResultEvents[0].content.codeBlockIndex,
      0,
      'code patch result event has the correct code block index',
    );
    assert.strictEqual(
      codePatchResultEvents[0].content?.['m.relates_to']?.key,
      'applied',
      'code patch result event has the correct key',
    );

    assert.deepEqual(
      JSON.parse(codePatchResultEvents[0].content?.data ?? '{}').context,
      {
        agentId: getService('matrix-service').agentId,
        codeMode: {
          currentFile: 'http://test-realm/test/hello.txt',
          selectionRange: {
            endColumn: 1,
            endLine: 1,
            startColumn: 1,
            startLine: 1,
          },
          moduleInspectorPanel: 'schema',
        },
        submode: 'code',
        debug: false,
        openCardIds: [],
        realmUrl: 'http://test-realm/test/',
        realmPermissions: {
          canRead: true,
          canWrite: true,
        },
      },
      'patch code result event contains the context',
    );
    assert.deepEqual(
      JSON.parse(codePatchResultEvents[0].content?.data ?? '{}')
        .attachedFiles?.[0]?.name,
      'hello.txt',
      'updated file should be attached 1',
    );
    assert.deepEqual(
      JSON.parse(codePatchResultEvents[0].content?.data ?? '{}')
        .attachedFiles?.[0]?.sourceUrl,
      'http://test-realm/test/hello.txt',
      'updated file should be attached 2',
    );

    let commandService = getService('command-service') as any;
    let requestIdsByRoom =
      commandService.aiAssistantClientRequestIdsByRoom as Map<string, any>;
    let roomRequestIds = requestIdsByRoom?.get(roomId);
    assert.ok(
      roomRequestIds,
      'aiAssistantClientRequestIdsByRoom has an entry for the room',
    );

    let ids: string[] = roomRequestIds ? Array.from(roomRequestIds) : [];
    assert.ok(
      ids.some((id) =>
        id.startsWith(`bot-patch:${encodeURIComponent(roomId)}:patch-code`),
      ),
      'bot patch clientRequestId recorded for the room',
    );

    assert.dom('[data-test-boxel-menu-item-text="Open in Code Mode"]').exists();
    assert
      .dom('[data-test-boxel-menu-item-text="Copy Submitted Content"]')
      .exists();
    assert
      .dom('[data-test-boxel-menu-item-text="Restore Submitted Content"]')
      .exists();

    await waitUntil(
      () =>
        document
          .querySelector('[data-test-copy-file-content]')
          ?.getAttribute('data-test-copy-file-content') === 'Hello, world!',
    );

    // Switch to interact mode so we can test the open in code mode action
    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await click('[data-test-workspace="Test Workspace B"]');
    await waitFor('[data-test-submode-switcher="interact"]');
    await click('[data-test-attached-file-dropdown-button="hello.txt"]');
    await click('[data-test-boxel-menu-item-text="Open in Code Mode"]');
    await waitFor('[data-test-submode-switcher="code"]');

    // Test restoring generated content
    mockedFileContent = 'Restored content!';
    await click('[data-test-attached-file-dropdown-button="hello.txt"]');
    await click('[data-test-boxel-menu-item-text="Restore Submitted Content"]');

    await click('[data-test-confirm-restore-button]');

    await waitUntil(() => getMonacoContent() === 'Restored content!', {
      timeout: 5000,
    });
  });

  test('can patch code and execute command using "Accept All" button', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-room-settled]');

    // open skill menu
    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');

    // add useful-commands skill, which includes the switch-submode command
    await click(
      `[data-test-card-catalog-item="${testRealmURL}Skill/useful-commands"]`,
    );
    await click('[data-test-card-catalog-go-button]');

    // there are 3 patches in the message
    // 1. hello.txt: Hello, world! -> Hi, world!
    // 2. hi.txt: Hi, world! -> Greetings, world!
    // 3. hi.txt: How are you? -> We are one!

    let codeBlock = `\`\`\`ruby
def hello
  "I am just a simple code block, not a code patch. Even if I am here, it should not affect the 'Accept All' functionality related to code patches."
end
\`\`\`

\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\`

I will also update the second file per your request.

 \`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
Hi, world!
${SEPARATOR_MARKER}
Greetings, world!
${REPLACE_MARKER}
\`\`\`

\`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
How are you?
${SEPARATOR_MARKER}
We are one!
${REPLACE_MARKER}
\`\`\``;

    let roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'abc123',
          name: 'show-card_566f',
          arguments: JSON.stringify({
            description: 'Showing skill card',
            attributes: {
              cardId: `${testRealmURL}Skill/useful-commands`,
            },
          }),
        },
      ],
    });

    await waitFor(
      '[data-test-ai-assistant-action-bar] [data-test-accept-all]',
      {
        timeout: 4000,
      },
    );
    // Intentionally not using await here to test the loading state of the button
    click('[data-test-ai-assistant-action-bar] [data-test-accept-all]');
    await waitFor(
      '[data-test-ai-assistant-action-bar] [data-test-loading-indicator]',
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-ai-assistant-action-bar]')
          ?.textContent?.includes('Apply Diff') &&
        find('[data-test-code-block-index] [data-test-apply-state="applying"]'),
      { timeout: 5000 },
    );
    await waitUntil(() =>
      document
        .querySelector('[data-test-ai-assistant-action-bar]')
        ?.textContent?.includes('Show Card'),
    );
    await waitUntil(
      () =>
        findAll(
          '[data-test-code-block-index] [data-test-apply-state="applied"]',
        ).length === 3,
      {
        timeout: 3000,
        timeoutMessage:
          'timed out waiting for code patches to be in applied state',
      },
    );
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Skill/useful-commands"]`)
      .exists();

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    assert.strictEqual(
      getMonacoContent(),
      'Hi, world!',
      'hello.txt should be patched',
    );
    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="hi.txt"]');

    // We can see content that is the result of 2 patches made to this file (hi.txt)
    await waitUntil(
      () => getMonacoContent() === 'Greetings, world!\nWe are one!',
      { timeout: 5000 },
    );

    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      codePatchResultEvents.length,
      3,
      'code patch result events are dispatched',
    );
  });

  // TODO: restore in CS-9082
  skip('trying but failing to patch code', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Goodbye, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}\n\`\`\``;
    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });
    let originalContent = getMonacoContent();
    assert.strictEqual(originalContent, 'Hello, world!');
    await waitFor('[data-test-apply-code-button]');
    await click('[data-test-apply-code-button]');
    await waitFor(
      '[data-test-apply-code-button][data-test-apply-state="failed"]',
    );

    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.event_id === eventId &&
        event.content['m.relates_to']?.key === 'failed',
    );
    assert.strictEqual(
      codePatchResultEvents.length,
      1,
      'code patch result event is dispatched',
    );
    assert.strictEqual(
      codePatchResultEvents[0].content.codeBlockIndex,
      0,
      'code patch result event has the correct code block index',
    );
    assert.strictEqual(
      codePatchResultEvents[0].content?.['m.relates_to']?.key,
      'failed',
      'code patch result event has the correct key',
    );
    assert.strictEqual(
      codePatchResultEvents[0].content?.failureReason,
      'The patch did not cleanly apply.',
      'code patch result event has the correct failure reason',
    );

    assert.deepEqual(
      JSON.parse(codePatchResultEvents[0].content?.data ?? '{}').context,
      {
        agentId: getService('matrix-service').agentId,
        codeMode: {
          currentFile: 'http://test-realm/test/hello.txt',
          selectionRange: {
            endColumn: 1,
            endLine: 1,
            startColumn: 1,
            startLine: 1,
          },
          moduleInspectorPanel: 'schema',
        },
        submode: 'code',
        debug: false,
        openCardIds: [],
        realmPermissions: {
          canRead: true,
          canWrite: true,
        },
        realmUrl: 'http://test-realm/test/',
      },
      'patch code result event contains the context',
    );
    assert.deepEqual(
      JSON.parse(codePatchResultEvents[0].content?.data ?? '{}')
        .attachedFiles?.[0]?.name,
      'hello.txt',
      'attempted file should be attached 1',
    );
    assert.deepEqual(
      JSON.parse(codePatchResultEvents[0].content?.data ?? '{}')
        .attachedFiles?.[0]?.sourceUrl,
      'http://test-realm/test/hello.txt',
      'attempted file should be attached 2',
    );
  });

  test('failure patching code when using "Accept All" button', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();

    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-room-settled]');

    // open skill menu
    await click('[data-test-skill-menu][data-test-pill-menu-button]');
    await click('[data-test-skill-menu] [data-test-pill-menu-add-button]');

    // add useful-commands skill, which includes the switch-submode command
    await click(
      `[data-test-card-catalog-item="${testRealmURL}Skill/useful-commands"]`,
    );
    await click('[data-test-card-catalog-go-button]');

    // there are 3 patches in the message
    // 1. hello.txt: Hello, world! -> Hi, world! # will apply
    // 2. hi.txt: Hi, Mars! -> Greetings, world! # won't apply cleanly
    // 3. hi.txt: How are you? -> We are one! # will apply

    let codeBlock = `\`\`\`ruby
def hello
  "I am just a simple code block, not a code patch. Even if I am here, it should not affect the 'Accept All' functionality related to code patches."
end
\`\`\`

\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\`

I will also update the second file per your request.

 \`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
Hi, Mars!
${SEPARATOR_MARKER}
Greetings, world!
${REPLACE_MARKER}
\`\`\`

\`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
How are you?
${SEPARATOR_MARKER}
We are one!
${REPLACE_MARKER}
\`\`\``;

    let roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'abc123',
          name: 'show-card_566f',
          arguments: JSON.stringify({
            description: 'Showing skill card',
            attributes: {
              cardId: `${testRealmURL}Skill/useful-commands`,
            },
          }),
        },
      ],
    });

    await waitFor(
      '[data-test-ai-assistant-action-bar] [data-test-accept-all]',
      {
        timeout: 4000,
      },
    );
    // Intentionally not using await here to test the loading state of the button
    click('[data-test-ai-assistant-action-bar] [data-test-accept-all]');
    await waitFor(
      '[data-test-ai-assistant-action-bar] [data-test-loading-indicator]',
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-ai-assistant-action-bar]')
          ?.textContent?.includes('Apply Diff') &&
        find('[data-test-code-block-index] [data-test-apply-state="applying"]'),
      {
        timeout: 5000,
        timeoutMessage:
          'timed out waiting action bar to patch to start applying',
      },
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-ai-assistant-action-bar]')
          ?.textContent?.includes('Show Card'),
      {
        timeout: 3000,
        timeoutMessage: 'timed out waiting action bar to show Show Card',
      },
    );
    await waitUntil(
      () =>
        findAll(
          '[data-test-code-block-index] [data-test-apply-state="applied"]',
        ).length === 2,
      {
        timeout: 3000,
        timeoutMessage:
          'timed out waiting for two code patches to be in applied state',
      },
    );
    await waitUntil(
      () =>
        findAll('[data-test-code-block-index] [data-test-apply-state="failed"]')
          .length === 1,
      {
        timeout: 3000,
        timeoutMessage:
          'timed out waiting for one code patch to be in failed state',
      },
    );
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Skill/useful-commands"]`)
      .exists();

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    assert.strictEqual(
      getMonacoContent(),
      'Hi, world!',
      'hello.txt should be patched',
    );
    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="hi.txt"]');

    // We can see content that is the result of 1 successful patch made to this file (hi.txt)
    await waitUntil(() => getMonacoContent() === 'Hi, world!\nWe are one!', {
      timeout: 5000,
      timeoutMessage:
        'timed out waiting monaco editor content to reflect partially failed patch',
    });

    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
    );
    let successfulCodePatchResultEvents = codePatchResultEvents.filter(
      (event) => event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      successfulCodePatchResultEvents.length,
      2,
      'successful code patch result events are dispatched',
    );
    let failedCodePatchResultEvents = codePatchResultEvents.filter(
      (event) => event.content['m.relates_to']?.key === 'failed',
    );
    assert.strictEqual(
      failedCodePatchResultEvents.length,
      1,
      'failed code patch result events are dispatched',
    );
  });

  test('action bar disappears when "Cancel" button is clicked', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });

    // there are 3 patches in the message
    // 1. hello.txt: Hello, world! -> Hi, world!
    // 2. hi.txt: Hi, world! -> Greetings, world!
    // 3. hi.txt: How are you? -> We are one!

    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\`

I will also update the second file per your request.

 \`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
Hi, world!
${SEPARATOR_MARKER}
Greetings, world!
${REPLACE_MARKER}
\`\`\`

\`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
How are you?
${SEPARATOR_MARKER}
We are one!
${REPLACE_MARKER}
\`\`\``;

    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    await waitFor('[data-test-ai-assistant-action-bar] [data-test-cancel]', {
      timeout: 4000,
    });
    assert.dom('[data-test-ai-assistant-action-bar]').exists();
    await click('[data-test-ai-assistant-action-bar] [data-test-cancel]');
    assert.dom('[data-test-ai-assistant-action-bar]').doesNotExist();
  });

  test('does not display the action bar when the streaming is cancelled', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });

    // there are 3 patches in the message
    // 1. hello.txt: Hello, world! -> Hi, world!
    // 2. hi.txt: Hi, world! -> Greetings, world!
    // 3. hi.txt: How are you? -> We are one!

    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\`

I will also update the second file per your request.

 \`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
Hi, world!
${SEPARATOR_MARKER}
Greetings, world!
${REPLACE_MARKER}
\`\`\`

\`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
How are you?
${SEPARATOR_MARKER}
We are one!
${REPLACE_MARKER}
\`\`\``;

    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;
    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      isCanceled: true,
    });

    assert.dom('[data-test-ai-assistant-action-bar]').doesNotExist();
    await waitFor('[data-test-ai-assistant-message]');
    assert
      .dom('[data-test-ai-message-content]')
      .containsText('{Generation Cancelled}');
  });

  test('previously applied code patches show the correct applied state', async function (assert) {
    // there are 3 patches in the message
    // 1. hello.txt: Hello, world! -> Hi, world!
    // 2. hi.txt: Hi, world! -> Greetings, world!
    // 3. hi.txt: How are you? -> We are one!

    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\`

 \`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
Hi, world!
${SEPARATOR_MARKER}
Greetings, world!
${REPLACE_MARKER}
\`\`\`

I will also update the second file per your request.

\`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
How are you?
${SEPARATOR_MARKER}
We are one!
${REPLACE_MARKER}
\`\`\``;

    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    simulateRemoteMessage(
      roomId,
      '@testuser:localhost',
      {
        msgtype: APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
        'm.relates_to': {
          event_id: eventId,
          rel_type: APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
          key: 'applied',
        },
        codeBlockIndex: 1,
        data: {
          attachedFiles: [
            {
              name: 'hi.txt',
              sourceUrl: 'http://test-realm/test/hi.txt',
              url: 'https://matrix-storage/hi.txt',
            },
          ],
        },
      },
      {
        type: APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
      },
    );

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    await click('[data-test-open-ai-assistant]');
    await click('[data-test-past-sessions-button]');
    await click(`[data-test-enter-room="${roomId}"]`);
    await waitUntil(() => findAll('[data-test-apply-state]').length === 3);
    assert
      .dom('[data-test-apply-state="applied"]')
      .exists({ count: 1 }, 'one patch is applied');
  });

  test('can create new files using the search/replace block', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });

    // there are 3 patches in the message
    // 1. file1.gts -> I am a newly created file1
    // 2. file2.gts -> I am a newly created file2
    // 3. hi.txt -> I am a newly created hi.txt file but I will get a number suffix because hi.txt already exists!

    let codeBlock = `\`\`\`
http://test-realm/test/file1.gts (new)
${SEARCH_MARKER}
${SEPARATOR_MARKER}
I am a newly created file1
${REPLACE_MARKER}
\`\`\`
 \`\`\`
http://test-realm/test/file2.gts (new)
${SEARCH_MARKER}
${SEPARATOR_MARKER}
I am a newly created file2
${REPLACE_MARKER}
\`\`\`
\`\`\`
http://test-realm/test/hi.txt (new)
${SEARCH_MARKER}
${SEPARATOR_MARKER}
This file will be created with a suffix because hi.txt already exists
${REPLACE_MARKER}
\`\`\``;

    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    await waitFor('.code-block-diff');

    assert
      .dom('[data-test-code-block-index="0"] [data-test-file-mode]')
      .hasText('Create');
    assert
      .dom('[data-test-code-block-index="1"] [data-test-file-mode]')
      .hasText('Create');
    assert
      .dom('[data-test-code-block-index="2"] [data-test-file-mode]')
      .hasText('Create');

    assert.dom('.code-block-diff').exists({ count: 3 });
    await click('[data-test-file-browser-toggle]'); // open file tree

    // Before applying the patch to create a new file, all the file actions should be disabled
    await click('[data-test-attached-file-dropdown-button="file1.gts"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Open in Code Mode"]')
      .hasAttribute('disabled');
    assert
      .dom('[data-test-boxel-menu-item-text="Copy Generated Content"]')
      .hasAttribute('disabled');
    assert
      .dom('[data-test-boxel-menu-item-text="Restore Generated Content"]')
      .hasAttribute('disabled');
    await click('[data-test-attached-file-dropdown-button="file1.gts"]');

    await waitFor('[data-test-ai-assistant-action-bar] [data-test-accept-all]');

    // file1.gts and file2.gts should not exist yet because we haven't applied the patches yet
    assert.dom('[data-test-file="file1.gts"]').doesNotExist();
    assert.dom('[data-test-file="file2.gts"]').doesNotExist();
    // hi.txt already exists
    assert.dom('[data-test-file="hi.txt"]').exists();

    assert.dom('[data-test-apply-code-button]').exists({ count: 3 });
    // clicks the first apply button, assert that file1.gts got created
    await click('[data-test-apply-code-button]');
    await waitFor('[data-test-file="file1.gts"]');

    // click the "Accept All" button, which will apply the remaining 2 patches (we already applied the first one)
    await click('[data-test-ai-assistant-action-bar] [data-test-accept-all]');
    await waitFor('[data-test-file="file2.gts"]');

    // assert that file2 got created, but for hi.txt, it got a suffix because there already exists a file with the same name
    assert.dom('[data-test-file="file2.gts"]').exists();

    assert.dom('[data-test-file="hi.txt"]').exists();

    // hi-1.txt (file with suffix) got created because hi.txt already exists
    await waitFor('[data-test-file="hi-1.txt"]');
    assert
      .dom('[data-test-file="hi-1.txt"]')
      .exists('File hi-1.txt exists in file tree');

    assert
      .dom('[data-test-attached-file-dropdown-button]')
      .exists({ count: 3 });
    assert
      .dom('[data-test-attached-file-dropdown-button="file1.gts"]')
      .exists();
    assert
      .dom('[data-test-attached-file-dropdown-button="file2.gts"]')
      .exists();
    await waitFor('[data-test-attached-file-dropdown-button="hi-1.txt"]');
    assert.dom('[data-test-attached-file-dropdown-button="hi-1.txt"]').exists();

    assert
      .dom('[data-test-boxel-menu-item-text="Restore Content"]')
      .doesNotExist(
        'Restore Content menu item should not be shown for new files',
      );

    // Switch to interact mode so that we can test that "Open in Code Mode" works
    await click('[data-test-submode-switcher] > [data-test-boxel-button]');
    await click('[data-test-boxel-menu-item-text="Interact"]');
    await click('[data-test-workspace="Test Workspace B"]');
    await waitFor('[data-test-submode-switcher="interact"]');
    await click('[data-test-attached-file-dropdown-button="file1.gts"]');
    await click('[data-test-boxel-menu-item-text="Open in Code Mode"]');
    await waitFor('[data-test-submode-switcher="code"]');

    assert.strictEqual(
      getMonacoContent(),
      'I am a newly created file1',
      'file1.gts should be opened in code mode and the content should be the new file content',
    );

    await click('[data-test-attached-file-dropdown-button="file2.gts"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Restore Content"]')
      .doesNotExist(
        'Restore Content menu item should not be shown for new files',
      );
    await click('[data-test-boxel-menu-item-text="Open in Code Mode"]');
    assert.strictEqual(
      getMonacoContent(),
      'I am a newly created file2',
      'file2.gts should be opened in code mode and the content should be the new file content',
    );

    await click('[data-test-attached-file-dropdown-button="hi-1.txt"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Restore Content"]')
      .doesNotExist(
        'Restore Content menu item should not be shown for new files',
      );
    await click('[data-test-boxel-menu-item-text="Open in Code Mode"]');
    assert.strictEqual(
      getMonacoContent(),
      'This file will be created with a suffix because hi.txt already exists',
      'hi-1.txt should be opened in code mode and the content should be the new file content',
    );
  });

  test('when code patch is historic (user moved on to the next message), or it was applied, it will render the code (replace portion of the search/replace block) in a standard (non-diff) editor', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });

    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\``;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    await waitFor('[data-test-attached-file-dropdown-button="hello.txt"]', {
      timeout: 4000,
    });
    await click('[data-test-attached-file-dropdown-button="hello.txt"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Restore Content"]')
      .doesNotExist(
        'Restore Content menu item should not be shown when patch has not been applied',
      );

    // User applies the code patch
    await waitFor('[data-test-apply-code-button]');
    assert.dom('[data-test-code-diff-editor]').exists();
    await click('[data-test-apply-code-button]');
    await waitFor('[data-test-apply-state="applied"]');
    assert.dom('[data-test-code-diff-editor]').doesNotExist();
    assert.dom('[data-test-editor]').exists();

    assert.dom('[data-test-error-message]').doesNotExist();

    await click('[data-test-attached-file-dropdown-button="hello.txt"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Restore Generated Content"]')
      .exists(
        'Restore Content menu item should be shown when patch has been applied',
      );

    // User moves on to the next message
    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'Send me another code patch',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    await waitFor('[data-test-code-diff-editor]');

    assert.dom('[data-test-code-diff-editor]').exists();
    assert.dom('[data-test-editor]').exists();

    // User ignores the offered code patch, sends a new message
    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'I do not like this code patch. Send me another one.',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    await waitFor('[data-test-apply-state="applied"]');

    // There should be 3 bot messages offering code patches.
    // First one is the one that was applied, second one is the one that was ignored, third one is the current one
    assert.dom('[data-test-apply-state="applied"]').exists({ count: 1 });
    assert.dom('[data-test-editor]').exists({ count: 2 });
    assert.dom('[data-test-code-diff-editor]').exists({ count: 1 });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
        format: 'org.matrix.custom.html',
        body: 'Debug: this event should be ignored for the purposes of deciding whether to show the code diff editor or not',
        isStreamingFinished: true,
      },
      {
        type: APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
      },
    );

    // There should now be 4 bot messages offering code patches.
    // First one is the one that was applied, second and third that are ignored, fourth one is the current one even though debug message follows it
    await waitUntil(() => findAll('[data-test-editor]').length === 4); // 3 non-diff blcoks plus the main code editor
    await waitUntil(() => findAll('[data-test-code-diff-editor]').length === 1);

    assert.dom('[data-test-apply-state="applied"]').exists({ count: 1 });
    assert.dom('[data-test-editor]').exists({ count: 4 });
    assert.dom('[data-test-code-diff-editor]').exists({ count: 1 });
  });

  // TODO: restore in CS-9084
  skip('can restore content of a patched file to its original state', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });

    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\``;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    await waitFor('[data-test-apply-code-button]');
    await click('[data-test-apply-code-button]');
    await waitFor('[data-test-apply-state="applied"]');

    await click('[data-test-attached-file-dropdown-button="hello.txt"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Restore Content"]')
      .exists(
        'Restore Content menu item should be shown when patch has been applied',
      );

    let matrixServer = getService('matrix-service');
    let originalFetchMatrixHostedFile = matrixServer.fetchMatrixHostedFile;
    let originalContent =
      'Original content of the file before the code patch was applied';
    matrixServer.fetchMatrixHostedFile = async (_url) => {
      return new Response(originalContent);
    };

    await click('[data-test-boxel-menu-item-text="Restore Content"]');
    await click('[data-test-confirm-restore-button]');

    await waitUntil(() => getMonacoContent() === originalContent);

    matrixServer.fetchMatrixHostedFile = originalFetchMatrixHostedFile;
  });

  test('LLM mode event controls auto-apply of code patches with timestamp checking', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    // Start in 'ask' mode (default)
    assert
      .dom('[data-test-llm-mode-option="ask"]')
      .hasClass('selected', 'LLM mode starts in ask mode');

    // Send a code patch in 'ask' mode - should NOT be auto-applied
    let codeBlock1 = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, world!
${REPLACE_MARKER}
\`\`\``;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock1,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });

    await waitFor('[data-test-apply-code-button]');
    assert
      .dom('[data-test-apply-code-button]')
      .exists('Apply button is shown in ask mode');
    assert
      .dom('[data-test-apply-state="applied"]')
      .doesNotExist('Code patch is not auto-applied in ask mode');

    // Switch to 'act' mode
    await click('[data-test-llm-mode-option="act"]');
    assert
      .dom('[data-test-llm-mode-option="act"]')
      .hasClass('selected', 'LLM mode updates to act');

    // Send a new code patch in 'act' mode - should be auto-applied
    let codeBlock2 = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, again (auto applied)!
${REPLACE_MARKER}
\`\`\``;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock2,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });

    // Wait for the code patch to be auto-applied
    await waitFor(
      '[data-test-message-idx="1"] [data-test-apply-state="applied"]',
    );
    assert
      .dom('[data-test-message-idx="1"] [data-test-apply-state="applied"]')
      .exists('Code patch is auto-applied in act mode');

    // Switch back to 'ask' mode
    await click('[data-test-llm-mode-option="ask"]');
    assert
      .dom('[data-test-llm-mode-option="ask"]')
      .hasClass('selected', 'LLM mode updates back to ask');

    // Send another code patch - should NOT be auto-applied
    let codeBlock3 = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hi, again (auto applied)!
${SEPARATOR_MARKER}
Goodbye, world!
${REPLACE_MARKER}
\`\`\``;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock3,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });
    await waitFor('[data-test-apply-code-button]');
    assert
      .dom('[data-test-message-idx="2"] [data-test-apply-state="applied"]')
      .doesNotExist('Code patch sent before act mode is not auto-applied');

    // Switch back to 'act' mode
    await click('[data-test-llm-mode-option="act"]');
    assert
      .dom('[data-test-llm-mode-option="act"]')
      .hasClass('selected', 'LLM mode updates to act again');

    // Send a final code patch after switching to 'act' mode - should be auto-applied
    let codeBlock4 = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hi, again (auto applied)!
${SEPARATOR_MARKER}
Final message, world!
${REPLACE_MARKER}
\`\`\``;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock4,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });

    // Wait for the code patch to be auto-applied
    await waitFor(
      '[data-test-message-idx="3"] [data-test-apply-state="applied"]',
    );
    assert
      .dom('[data-test-message-idx="3"] [data-test-apply-state="applied"]')
      .exists('New code patch sent after act mode is auto-applied');

    // Verify that the previous code patch (sent before act mode) is still not applied
    assert
      .dom('[data-test-message-idx="2"] [data-test-apply-state="applied"]')
      .doesNotExist(
        'Code patch sent before act mode is still not auto-applied',
      );
  });

  test<TestContextWithSave>('automatic Accept All spinner appears in Act mode for multiple patches', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hello.txt`,
    });
    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    // Switch to Act mode first
    await click('[data-test-llm-mode-option="act"]');
    assert
      .dom('[data-test-llm-mode-option="act"]')
      .hasClass('selected', 'LLM mode is set to act');

    // Send multiple code patches that should auto-apply in Act mode
    // This will trigger an "accept all" operation and should show the spinner
    let codeBlock = `\`\`\`
http://test-realm/test/hello.txt
${SEARCH_MARKER}
Hello, world!
${SEPARATOR_MARKER}
Hi, Act mode!
${REPLACE_MARKER}
\`\`\`

I will also update the second file.

\`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
Hi, world!
${SEPARATOR_MARKER}
Greetings from Act mode!
${REPLACE_MARKER}
\`\`\`

\`\`\`
http://test-realm/test/hi.txt
${SEARCH_MARKER}
How are you?
${SEPARATOR_MARKER}
We are awesome in Act mode!
${REPLACE_MARKER}
\`\`\``;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: {
        context: {
          agentId: getService('matrix-service').agentId,
        },
      },
    });

    // Wait for the patches to be processed - the spinner should appear during automatic execution
    // This test should FAIL until we implement the CommandService state tracking
    await waitFor(
      '[data-test-ai-assistant-action-bar] [data-test-loading-indicator]',
      {
        timeout: 2000,
      },
    );

    // Assert that the spinner is visible during automatic accept-all execution
    assert
      .dom('[data-test-ai-assistant-action-bar] [data-test-loading-indicator]')
      .exists(
        'Loading indicator appears during automatic accept-all in Act mode',
      );

    // Assert that the action bar shows the correct text
    assert
      .dom('[data-test-ai-assistant-action-bar]')
      .containsText(
        'Apply Diff',
        'Action bar shows applying text during automatic execution',
      );

    let save = 0;
    this.onSave((_saveURL) => {
      save++;
    });
    await waitUntil(() => save >= 2, { timeout: 2000 });

    // Wait for all patches to be applied
    await waitUntil(
      () => findAll('[data-test-apply-state="applied"]').length === 3,
      { timeout: 5000 },
    );

    // Assert that the spinner disappears after automatic execution completes
    assert
      .dom('[data-test-loading-indicator]')
      .doesNotExist(
        'Loading indicator disappears after automatic execution completes',
      );

    // Verify that the files were actually patched
    assert.strictEqual(
      getMonacoContent(),
      'Hi, Act mode!',
      'hello.txt should be patched by automatic execution',
    );

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="hi.txt"]');
    await waitUntil(
      () =>
        getMonacoContent() ===
        'Greetings from Act mode!\nWe are awesome in Act mode!',
      { timeout: 2000 },
    );
  });

  test('schema editor gets refreshed when code patches are executed on executable files', async function (assert) {
    assert.expect(6);

    // Visit the executable file in code mode
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}test-card.gts`,
    });

    // Wait for schema editor to load and verify initial state
    await waitFor('[data-test-card-schema]');
    assert
      .dom('[data-test-card-schema="Test Card"] [data-test-total-fields]')
      .containsText('2', 'Initial total fields count is correct');
    assert
      .dom('[data-test-card-schema="Test Card"] [data-test-field-name="name"]')
      .exists('Initial name field exists');
    assert
      .dom(
        '[data-test-card-schema="Test Card"] [data-test-field-name="description"]',
      )
      .exists('Initial description field exists');

    // Open AI assistant and simulate a code patch that adds a new field
    // The loader reset is now handled centrally in cardService.saveSource
    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    let codeBlock = `\`\`\`
http://test-realm/test/test-card.gts
${SEARCH_MARKER}
  @field description = contains(StringField);
${SEPARATOR_MARKER}
  @field description = contains(StringField);
  @field email = contains(StringField);
${REPLACE_MARKER}\n\`\`\``;

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'Add an email field to the TestCard',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: {
        attachedFiles: [
          {
            url: 'http://test-realm/test/test-card.gts',
            name: 'test-card.gts',
            sourceUrl: 'http://test-realm/test/test-card.gts',
          },
        ],
      },
    });

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    // Apply the code patch
    await waitFor('[data-test-apply-code-button]');
    await click('[data-test-apply-code-button]');

    // Wait for the schema editor to refresh and verify the new field appears
    await waitUntil(
      () => {
        let totalFieldsElement = document.querySelector(
          '[data-test-card-schema="Test Card"] [data-test-total-fields]',
        );
        return (
          totalFieldsElement && totalFieldsElement.textContent?.includes('3')
        );
      },
      { timeout: 5000 },
    );

    assert
      .dom('[data-test-card-schema="Test Card"] [data-test-total-fields]')
      .containsText('3', 'Total fields count updated after code patch');
    assert
      .dom('[data-test-card-schema="Test Card"] [data-test-field-name="email"]')
      .exists('New email field appears in schema editor');

    // Verify the code patch result event was dispatched
    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.event_id === eventId &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      codePatchResultEvents.length,
      1,
      'code patch result event is dispatched',
    );
  });

  test('loader reset happens when restoring patched executable files', async function (assert) {
    // Visit the executable file in code mode
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}test-card.gts`,
    });

    // Wait for schema editor to load and verify initial state
    await waitFor('[data-test-card-schema]');
    assert
      .dom('[data-test-card-schema="Test Card"] [data-test-total-fields]')
      .containsText('2', 'Initial total fields count is correct');

    // Open AI assistant and simulate a code patch that adds a new field
    // The loader reset is now handled centrally in cardService.saveSource
    await click('[data-test-open-ai-assistant]');
    let roomId = getRoomIds().pop()!;

    let codeBlock = `\`\`\`
http://test-realm/test/test-card.gts
${SEARCH_MARKER}
  @field description = contains(StringField);
${SEPARATOR_MARKER}
  @field description = contains(StringField);
  @field email = contains(StringField);
${REPLACE_MARKER}\n\`\`\``;

    simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'Add an email field to the TestCard',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      data: {
        attachedFiles: [
          {
            url: 'http://test-realm/test/test-card.gts',
            name: 'test-card.gts',
            sourceUrl: 'http://test-realm/test/test-card.gts',
          },
        ],
      },
    });

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: codeBlock,
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    // Apply the code patch
    await waitFor('[data-test-apply-code-button]');
    await click('[data-test-apply-code-button]');

    // Wait for the schema editor to refresh and verify the new field appears
    await waitUntil(
      () => {
        let totalFieldsElement = document.querySelector(
          '[data-test-card-schema="Test Card"] [data-test-total-fields]',
        );
        return (
          totalFieldsElement && totalFieldsElement.textContent?.includes('3')
        );
      },
      { timeout: 5000 },
    );

    assert
      .dom('[data-test-card-schema="Test Card"] [data-test-total-fields]')
      .containsText('3', 'Total fields count updated after code patch');

    // Find the attached file dropdown and restore the content
    await click('[data-test-attached-file-dropdown-button="test-card.gts"]');
    await click('[data-test-boxel-menu-item-text="Restore Submitted Content"]');
    await click('[data-test-confirm-restore-button]');

    // Wait for the restore to complete and verify the schema editor shows the original state
    await waitUntil(
      () => {
        let totalFieldsElement = document.querySelector(
          '[data-test-card-schema="Test Card"] [data-test-total-fields]',
        );
        return (
          totalFieldsElement && totalFieldsElement.textContent?.includes('2')
        );
      },
      { timeout: 5000 },
    );

    assert
      .dom('[data-test-card-schema="Test Card"] [data-test-total-fields]')
      .containsText(
        '2',
        'Total fields count restored to original state after restore',
      );

    // Verify the code patch result event was dispatched
    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.event_id === eventId &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.strictEqual(
      codePatchResultEvents.length,
      1,
      'code patch result event is dispatched',
    );
  });
});
