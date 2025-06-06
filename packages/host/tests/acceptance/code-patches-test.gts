import { click, waitFor, findAll, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
  baseRealm,
} from '@cardstack/runtime-common';

import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_DEBUG_MESSAGE_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  setupUserSubscription,
  getMonacoContent,
} from '../helpers';

import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

let matrixRoomId = '';

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
    matrixRoomId = await createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'index.json': new CardsGrid(),
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
        'hello.txt': 'Hello, world!',
        'hi.txt': 'Hi, world!\nHow are you?',
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

    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.event_id === eventId &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      codePatchResultEvents.length,
      1,
      'code patch result event is dispatched',
    );
    assert.deepEqual(
      JSON.parse(codePatchResultEvents[0].content?.data ?? '{}').context,
      {
        codeMode: {
          currentFile: 'http://test-realm/test/hello.txt',
        },
        submode: 'code',
        debug: false,
        openCardIds: [],
        realmUrl: 'http://test-realm/test/',
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
  });

  test('can patch code when there are multiple patches using "Accept All" button', async function (assert) {
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

    await waitFor('[data-test-apply-all-code-patches-button]', {
      timeout: 4000,
    });
    click('[data-test-apply-all-code-patches-button]');
    await waitFor('.code-patch-actions [data-test-apply-state="applying"]');
    await waitFor('.code-patch-actions [data-test-apply-state="applied"]', {
      timeout: 3000,
      timeoutMessage:
        'timed out waiting for Accept All button to be in applied state',
    });
    assert.dom('[data-test-apply-state="applied"]').exists({ count: 4 }); // 3 patches + 1 for "Accept All" button

    assert.strictEqual(
      getMonacoContent(),
      'Hi, world!',
      'hello.txt should be patched',
    );
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}hi.txt`,
    });

    // We can see content that is the result of 2 patches made to this file (hi.txt)
    await waitUntil(
      () => getMonacoContent() === 'Greetings, world!\nWe are one!',
    );

    let codePatchResultEvents = getRoomEvents(roomId).filter(
      (event) =>
        event.type === APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE &&
        event.content['m.relates_to']?.rel_type ===
          APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE &&
        event.content['m.relates_to']?.key === 'applied',
    );
    assert.equal(
      codePatchResultEvents.length,
      3,
      'code patch result events are dispatched',
    );
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
    await waitUntil(() => findAll('[data-test-apply-state]').length === 4);
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
    await waitFor('[data-test-apply-all-code-patches-button]');

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
    await click('[data-test-apply-all-code-patches-button]');
    await waitFor('[data-test-file="file2.gts"]');

    // assert that file2 got created, but for hi.txt, it got a suffix because there already exists a file with the same name
    assert.dom('[data-test-file="file2.gts"]').exists();
    assert.dom('[data-test-file="hi.txt"]').exists();

    // hi-1.txt got created because hi.txt already exists
    assert.dom('[data-test-file="hi-1.txt"]').exists();

    await click('[data-test-file="hi-1.txt"]');

    assert.equal(
      (
        document.getElementsByClassName('view-lines')[0] as HTMLElement
      ).innerText
        .replace(/\s+/g, ' ')
        .trim(),
      'This file will be created with a suffix because hi.txt already exists',
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

    // User applies the code patch
    await waitFor('[data-test-apply-code-button]');
    assert.dom('[data-test-code-diff-editor]').exists();
    await click('[data-test-apply-code-button]');
    await waitFor('[data-test-apply-state="applied"]');
    assert.dom('[data-test-code-diff-editor]').doesNotExist();
    assert.dom('[data-test-editor]').exists();

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
});
