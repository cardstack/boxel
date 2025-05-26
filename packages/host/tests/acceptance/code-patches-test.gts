import { click, waitFor, findAll, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
  APP_BOXEL_MESSAGE_MSGTYPE,
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
<<<<<<< SEARCH
Hello, world!
=======
Hi, world!
>>>>>>> REPLACE\n\`\`\``;
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
<<<<<<< SEARCH
Hello, world!
=======
Hi, world!
>>>>>>> REPLACE
\`\`\`

I will also update the second file per your request.

 \`\`\`
http://test-realm/test/hi.txt
<<<<<<< SEARCH
Hi, world!
=======
Greetings, world!
>>>>>>> REPLACE
\`\`\`

\`\`\`
http://test-realm/test/hi.txt
<<<<<<< SEARCH
How are you?
=======
We are one!
>>>>>>> REPLACE
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
<<<<<<< SEARCH
Hello, world!
=======
Hi, world!
>>>>>>> REPLACE
\`\`\`

 \`\`\`
http://test-realm/test/hi.txt
<<<<<<< SEARCH
Hi, world!
=======
Greetings, world!
>>>>>>> REPLACE
\`\`\`

I will also update the second file per your request.

\`\`\`
http://test-realm/test/hi.txt
<<<<<<< SEARCH
How are you?
=======
We are one!
>>>>>>> REPLACE
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
http://test-realm/test/file1.gts
<<<<<<< SEARCH
=======
I am a newly created file1
>>>>>>> REPLACE
\`\`\`
 \`\`\`
http://test-realm/test/file2.gts
<<<<<<< SEARCH
=======
I am a newly created file2
>>>>>>> REPLACE
\`\`\`
\`\`\`
http://test-realm/test/hi.txt
<<<<<<< SEARCH
=======
This file was supposed to be hi.txt but it got a suffix because hi.txt already exists
>>>>>>> REPLACE
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
      'This file was supposed to be hi.txt but it got a suffix because hi.txt already exists',
    );
  });
});
