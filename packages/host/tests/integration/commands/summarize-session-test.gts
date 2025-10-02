import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import SummarizeSessionCommand from '@cardstack/host/commands/summarize-session';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmServerEndpoints,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | summarize-session', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let { createAndJoinRoom, simulateRemoteMessage } = mockMatrixUtils;

  // Setup realm server endpoints for all tests
  setupRealmServerEndpoints(hooks, [
    {
      route: '_request-forward',
      getResponse: async (req: Request) => {
        const body = await req.json();

        // Handle summarization requests
        if (body.url.includes('openrouter.ai/api/v1/chat/completions')) {
          const requestBody = JSON.parse(body.requestBody);

          // Check if this is a summarization request
          if (
            requestBody.messages &&
            requestBody.messages.some(
              (msg: any) =>
                msg.content &&
                msg.content.includes('Please provide a concise summary'),
            )
          ) {
            // Return a mock summary based on the conversation content
            const conversationText = requestBody.messages
              .filter(
                (msg: any) =>
                  msg.role === 'user' &&
                  !msg.content.includes('Please provide a concise summary'),
              )
              .map((msg: any) => msg.content)
              .join(' ');

            let summary = 'This conversation focused on general discussion.';

            if (conversationText.includes('project')) {
              summary =
                'This conversation focused on project help, specifically creating a new card for a person with name and age fields. The user requested assistance with card creation and field definition.';
            } else if (
              conversationText.includes('card') &&
              conversationText.includes('file')
            ) {
              summary =
                'This conversation involved discussing a person card (Hassan) and a pet definition file. The user shared both a Person card and a pet.gts file, then asked for help understanding the structure.';
            } else if (conversationText.includes('error')) {
              throw new Error('OpenRouter API error');
            }

            return new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: summary,
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }
        }

        // Default response for other requests
        return new Response(
          JSON.stringify({
            success: true,
            data: { id: 123, name: 'test' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    },
  ]);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
  });

  // Helper function to create mock summarize session input
  function createMockSummarizeSessionInput(roomId: string) {
    return {
      roomId,
    };
  }

  // Helper function to create room with conversation history
  async function createRoomWithHistory(roomName: string, messages: string[]) {
    const roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: roomName,
    });

    // Add messages to the room
    for (const message of messages) {
      simulateRemoteMessage(roomId, '@testuser:localhost', {
        body: message,
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
      });
    }

    await waitForRoomToBeLoaded(roomId);
    return roomId;
  }

  async function waitForRoomToBeLoaded(roomId: string) {
    let matrixService = getService('matrix-service');
    while (!matrixService.roomResourcesCache.has(roomId)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  test('successfully summarizes a conversation with project help content', async function (assert) {
    const commandService = getService('command-service');
    const summarizeCommand = new SummarizeSessionCommand(
      commandService.commandContext,
    );

    // Create a room with project-related conversation
    const roomId = await createRoomWithHistory('Project Help Room', [
      'Hello, I need help with my project',
      'I want to create a new card for a person',
      'The person should have a name and age field',
    ]);

    const input = createMockSummarizeSessionInput(roomId);
    const result = await summarizeCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.ok(result.summary, 'Result should have a summary');
    assert.true(
      result.summary.includes('project help'),
      'Summary should mention project help',
    );
    assert.true(
      result.summary.includes('card for a person'),
      'Summary should mention card creation',
    );
    assert.true(
      result.summary.includes('name and age field'),
      'Summary should mention the specific fields',
    );
  });

  test('successfully summarizes a conversation with cards and files', async function (assert) {
    const commandService = getService('command-service');
    const summarizeCommand = new SummarizeSessionCommand(
      commandService.commandContext,
    );

    // Create a room with card and file discussion
    const roomId = await createRoomWithHistory('Card Discussion Room', [
      'I have a person card here',
      'And here is the pet definition file',
      'Can you help me understand this structure?',
    ]);

    const input = createMockSummarizeSessionInput(roomId);
    const result = await summarizeCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.ok(result.summary, 'Result should have a summary');
    assert.true(
      result.summary.includes('person card'),
      'Summary should mention person card',
    );
    assert.true(
      result.summary.includes('pet definition file'),
      'Summary should mention pet definition file',
    );
    assert.true(
      result.summary.includes('structure'),
      'Summary should mention understanding structure',
    );
  });

  test('handles empty room gracefully', async function (assert) {
    const commandService = getService('command-service');
    const summarizeCommand = new SummarizeSessionCommand(
      commandService.commandContext,
    );

    // Create an empty room
    const roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'Empty Room',
    });
    await waitForRoomToBeLoaded(roomId);

    const input = createMockSummarizeSessionInput(roomId);
    const result = await summarizeCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.notOk(result.summary, 'Result should not have a summary');
  });

  test('handles API errors gracefully', async function (assert) {
    const commandService = getService('command-service');
    const summarizeCommand = new SummarizeSessionCommand(
      commandService.commandContext,
    );

    // Create a room with error-triggering content
    const roomId = await createRoomWithHistory('Error Room', [
      'This will cause an error',
      'Testing error handling',
    ]);

    const input = createMockSummarizeSessionInput(roomId);

    // The command should throw an error when the API fails
    try {
      await summarizeCommand.execute(input);
      assert.ok(false, 'Command should have thrown an error');
    } catch (error) {
      assert.ok(error instanceof Error, 'Error should be an Error instance');
      const errorMessage = (error as Error).message;
      assert.true(
        errorMessage.includes('Failed to generate summary'),
        'Error message should indicate API failure',
      );
    }
  });

  test('handles room not found gracefully', async function (assert) {
    const commandService = getService('command-service');
    const summarizeCommand = new SummarizeSessionCommand(
      commandService.commandContext,
    );

    const input = createMockSummarizeSessionInput('non-existent-room-id');

    // The command should throw an error when the room doesn't exist
    try {
      await summarizeCommand.execute(input);
      assert.ok(false, 'Command should have thrown an error');
    } catch (error) {
      assert.ok(error instanceof Error, 'Error should be an Error instance');
      // The error could be about room not found or other matrix-related errors
      const errorMessage = (error as Error).message;
      assert.true(
        errorMessage.includes('room'),
        'Error message should indicate room-related issue',
      );
    }
  });

  test('includes conversation context in summary request', async function (assert) {
    const commandService = getService('command-service');
    const summarizeCommand = new SummarizeSessionCommand(
      commandService.commandContext,
    );

    // Create a room with specific conversation
    const roomId = await createRoomWithHistory('Context Room', [
      'User: Hello, I need help with my project',
      'AI: I can help you with your project. What do you need?',
      'User: I want to create a new card for a person',
      'AI: Great! Let me help you create a person card.',
    ]);

    const input = createMockSummarizeSessionInput(roomId);
    const result = await summarizeCommand.execute(input);

    assert.ok(result, 'Command should return a result');
    assert.ok(result.summary, 'Result should have a summary');
    assert.true(
      result.summary.includes('project'),
      'Summary should include project context',
    );
    assert.true(
      result.summary.includes('card for a person'),
      'Summary should include card creation context',
    );
  });
});
