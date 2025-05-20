import { click, waitFor, findAll, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  APP_BOXEL_CODE_PATCH_RESULT_EVENT_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_REL_TYPE,
  APP_BOXEL_CODE_PATCH_RESULT_MSGTYPE,
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
      msgtype: 'org.text',
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
      msgtype: 'org.text',
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
      msgtype: 'org.text',
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
});
