import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupRealmServerEndpoints,
  testRealmURL,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// `room.credits()` reads the balance through the realm server's `/_user`,
// which needs a signed-in user, so these run apart from the rest of the
// run-realm-code module.
module('Integration | tools | run-realm-code | room.credits', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let userResponse: () => Response;
  setupRealmServerEndpoints(hooks, [
    {
      route: '_user',
      getResponse: async () => userResponse(),
    },
  ]);
  setupRealmCacheTeardown(hooks);

  let roomId: string;

  hooks.beforeEach(async function () {
    userResponse = () => new Response('', { status: 500 });
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: { 'notes/first.md': '# First\n' },
      }),
    );
    await getService('matrix-service').ready;
    roomId = mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-credits',
    });
  });

  function userWith(attributes: Record<string, unknown>, plan?: string) {
    userResponse = () =>
      new Response(
        JSON.stringify({
          data: { type: 'user', id: 1, attributes },
          included: plan
            ? [{ type: 'plan', id: 1, attributes: { name: plan } }]
            : null,
        }),
      );
  }

  function answer(usage: Record<string, number>) {
    mockMatrixUtils.simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'A question',
      msgtype: 'm.text',
    });
    mockMatrixUtils.simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'An answer.',
      msgtype: 'm.text',
      isStreamingFinished: true,
      data: { usage },
    });
  }

  async function runCredits() {
    let command = new RunRealmCodeTool(getService('tool-service').toolContext);
    return await command.execute({
      realm: testRealmURL,
      roomId,
      code: `return await room.credits();`,
    });
  }

  test("reports the user's plan, balance and this session's spend", async function (assert) {
    userWith(
      {
        creditsAvailableInPlanAllowance: 1200,
        creditsIncludedInPlanAllowance: 2500,
        extraCreditsAvailableInBalance: 300,
        lowCreditThreshold: 2000,
        nextDailyCreditGrantAt: 1767225600,
      },
      'Starter',
    );
    answer({ promptTokens: 1000, completionTokens: 100, costUsd: 0.012 });
    answer({ promptTokens: 1000, completionTokens: 100, costUsd: 0.0304 });
    await settled();

    let result = await runCredits();

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      plan: 'Starter',
      creditsLeft: 1500,
      monthlyCreditsLeft: 1200,
      monthlyCreditsIncluded: 2500,
      extraCredits: 300,
      nextDailyGrant: { at: '2026-01-01T00:00:00.000Z', topsUpTo: 2000 },
      session: { answers: 2, credits: 42 },
    });
    assert.deepEqual(result.roomChanges, [], 'the room is unchanged');
  });

  test('gives no session total when an answer reported no cost', async function (assert) {
    userWith({
      creditsAvailableInPlanAllowance: null,
      creditsIncludedInPlanAllowance: null,
      extraCreditsAvailableInBalance: 5000,
      lowCreditThreshold: 2000,
      nextDailyCreditGrantAt: 1767225600,
    });
    answer({ promptTokens: 1000, completionTokens: 100, costUsd: 0.012 });
    answer({ promptTokens: 1000, completionTokens: 100 });
    await settled();

    let result = await runCredits();

    assert.deepEqual(JSON.parse(result.scriptResult!), {
      plan: null,
      creditsLeft: 5000,
      monthlyCreditsLeft: null,
      monthlyCreditsIncluded: null,
      extraCredits: 5000,
      nextDailyGrant: null,
      session: { answers: 2, credits: null },
    });
  });

  test('fails rather than report a balance it could not read', async function (assert) {
    await assert.rejects(
      runCredits(),
      /room\.credits could not read the account's credits/,
    );
  });
});
