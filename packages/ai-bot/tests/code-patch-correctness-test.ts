import { module, test, assert } from 'qunit';

import { publishCodePatchCorrectnessMessage } from '../lib/code-patch-correctness';
import { FakeMatrixClient } from './helpers/fake-matrix-client';
import type { PendingCodePatchCorrectnessCheck } from '@cardstack/runtime-common/ai/types';
import {
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
  APP_BOXEL_COMMAND_REQUESTS_KEY,
} from '@cardstack/runtime-common/matrix-constants';
import {
  decodeCommandRequest,
  type CommandRequest,
} from '@cardstack/runtime-common/commands';

module('code patch correctness helpers', () => {
  test('publishCodePatchCorrectnessMessage emits check correctness requests for files and cards', async function () {
    let client = new FakeMatrixClient();
    let summary: PendingCodePatchCorrectnessCheck = {
      targetEventId: 'ai-message',
      roomId: '!room:localhost',
      context: {
        realmUrl: 'http://localhost:4201/test',
        submode: 'code',
        tools: [],
        functions: [],
      } as any,
      files: [
        {
          sourceUrl: 'http://localhost/files/src/components/button.gts',
          displayName: 'files/src/components/button.gts',
        },
      ],
      cards: [{ cardId: 'http://localhost/cards/Profile/1' }],
    };

    await publishCodePatchCorrectnessMessage(summary, client);

    let sentEvents = client.getSentEvents();
    assert.strictEqual(sentEvents.length, 1, 'Should send one message');
    let [event] = sentEvents;
    assert.strictEqual(
      event.eventType,
      'm.room.message',
      'Should send a room message',
    );
    let content = event.content;
    assert.strictEqual(
      content.msgtype,
      APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
      'Message type should be code patch correctness',
    );
    assert.deepEqual(
      content['m.relates_to'],
      {
        rel_type: APP_BOXEL_CODE_PATCH_CORRECTNESS_REL_TYPE,
        event_id: summary.targetEventId,
      },
      'Correctness message should reference the patched event',
    );
    assert.strictEqual(
      content.body,
      '',
      'Correctness message should not include a body',
    );
    assert.true(content.isStreamingFinished, 'Message should be finalized');
    assert.deepEqual(
      content.data,
      { context: summary.context },
      'Should forward the context with the message',
    );

    let encodedRequests = content[APP_BOXEL_COMMAND_REQUESTS_KEY];
    assert.true(
      Array.isArray(encodedRequests),
      'Command requests should be present',
    );
    assert.strictEqual(
      encodedRequests.length,
      2,
      'Should request correctness checks for each file and card',
    );
    let decodedRequests = encodedRequests.map((request: any) =>
      decodeCommandRequest(request),
    );
    let fileRequest = decodedRequests.find(
      (request: Partial<CommandRequest>) =>
        request.arguments?.attributes?.targetType === 'file',
    );
    assert.ok(fileRequest, 'Should include a file correctness request');
    assert.strictEqual(
      fileRequest?.name,
      'checkCorrectness',
      'File request should use the check correctness command',
    );
    assert.deepEqual(
      fileRequest?.arguments,
      {
        description: 'Check correctness of files/src/components/button.gts',
        attributes: {
          targetType: 'file',
          targetRef: summary.files[0].sourceUrl,
          fileUrl: summary.files[0].sourceUrl,
          roomId: summary.roomId,
          targetEventId: summary.targetEventId,
          correctnessCheckAttempt: 1,
        },
      },
      'File correctness check request should describe the file that changed',
    );
    let cardRequest = decodedRequests.find(
      (request: Partial<CommandRequest>) =>
        request.arguments?.attributes?.targetType === 'card',
    );
    assert.ok(cardRequest, 'Should include a card correctness request');
    assert.deepEqual(
      cardRequest?.arguments,
      {
        description: 'Check correctness of http://localhost/cards/Profile/1',
        attributes: {
          targetType: 'card',
          targetRef: 'http://localhost/cards/Profile/1',
          cardId: 'http://localhost/cards/Profile/1',
          roomId: summary.roomId,
          targetEventId: summary.targetEventId,
          correctnessCheckAttempt: 1,
        },
      },
      'Card correctness check request should describe the card that changed',
    );
  });

  test('publishCodePatchCorrectnessMessage uses attempts scoped to the patch event', async function () {
    let client = new FakeMatrixClient();
    let summary: PendingCodePatchCorrectnessCheck = {
      targetEventId: 'ai-message-123',
      roomId: '!room:localhost',
      files: [
        {
          sourceUrl: 'http://localhost/files/src/components/button.gts',
          displayName: 'files/src/components/button.gts',
        },
      ],
      cards: [{ cardId: 'http://localhost/cards/Profile/1' }],
      attemptsByTargetKey: {
        'file:http://localhost/files/src/components/button.gts|event:ai-message-123': 2,
        'card:http://localhost/cards/Profile/1|event:ai-message-123': 3,
      },
    };

    await publishCodePatchCorrectnessMessage(summary, client);

    let [event] = client.getSentEvents();
    let encodedRequests = event.content[APP_BOXEL_COMMAND_REQUESTS_KEY];
    let decodedRequests = encodedRequests.map((request: any) =>
      decodeCommandRequest(request),
    );

    let fileRequest = decodedRequests.find(
      (request: Partial<CommandRequest>) =>
        request.arguments?.attributes?.targetType === 'file',
    );
    assert.strictEqual(
      fileRequest?.arguments?.attributes?.correctnessCheckAttempt,
      2,
      'File attempt should come from the scoped attempts map',
    );
    assert.strictEqual(
      fileRequest?.arguments?.attributes?.targetEventId,
      summary.targetEventId,
      'File request should include the patch event id',
    );

    let cardRequest = decodedRequests.find(
      (request: Partial<CommandRequest>) =>
        request.arguments?.attributes?.targetType === 'card',
    );
    assert.strictEqual(
      cardRequest?.arguments?.attributes?.correctnessCheckAttempt,
      3,
      'Card attempt should come from the scoped attempts map',
    );
    assert.strictEqual(
      cardRequest?.arguments?.attributes?.targetEventId,
      summary.targetEventId,
      'Card request should include the patch event id',
    );
  });

  test('publishCodePatchCorrectnessMessage skips targets that exceed max attempts', async function () {
    let client = new FakeMatrixClient();
    let summary: PendingCodePatchCorrectnessCheck = {
      targetEventId: 'ai-message-max',
      roomId: '!room:localhost',
      files: [
        {
          sourceUrl: 'http://localhost/files/src/components/button.gts',
          displayName: 'files/src/components/button.gts',
        },
      ],
      cards: [{ cardId: 'http://localhost/cards/Profile/1' }],
      attemptsByTargetKey: {
        'file:http://localhost/files/src/components/button.gts|event:ai-message-max': 4,
        'card:http://localhost/cards/Profile/1|event:ai-message-max': 5,
      },
    };

    await publishCodePatchCorrectnessMessage(summary, client);

    let [event] = client.getSentEvents();
    let encodedRequests = event.content[APP_BOXEL_COMMAND_REQUESTS_KEY];
    assert.notOk(
      encodedRequests,
      'Targets beyond the attempt limit should not emit correctness requests',
    );
  });
});
