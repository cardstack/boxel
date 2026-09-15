import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  buildCommandFunctionNameFromResolvedRef,
  skillCardRef,
} from '@cardstack/runtime-common';
import {
  APP_BOXEL_TOOL_REQUESTS_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_TOOL_RESULT_REL_TYPE,
  APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE,
} from '@cardstack/runtime-common/matrix-constants';

import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  addSkillToAiAssistant,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  testRealmURL,
  visitOperatorMode,
  waitForNewRoomSkillsLoaded,
  realmConfigCardJSON,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const newRealmURL = 'http://test-realm/testuser/team-space/';

const cardsGridIndex = {
  data: {
    type: 'card',
    meta: {
      adoptsFrom: {
        module: '@cardstack/base/cards-grid',
        name: 'CardsGrid',
      },
    },
  },
};

module('Acceptance | AI assistant creates a workspace', function (hooks) {
  const createWorkspaceToolName = buildCommandFunctionNameFromResolvedRef({
    module: '@cardstack/boxel-host/tools/create-workspace',
    name: 'default',
  });

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });
  let { simulateRemoteMessage, getRoomIds, getRoomEvents } = mockMatrixUtils;

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    setupUserSubscription();
    setupAuthEndpoints();

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'index.json': cardsGridIndex,
        'realm.json': realmConfigCardJSON({ name: 'Test Workspace' }),
        'Skill/workspace-admin.json': {
          data: {
            type: 'card',
            attributes: {
              instructions:
                'Use create-workspace when the user asks for a new workspace.',
              commands: [
                {
                  codeRef: {
                    name: 'default',
                    module: '@cardstack/boxel-host/tools/create-workspace',
                  },
                  requiresApproval: true,
                },
              ],
              cardTitle: 'Workspace Admin',
              cardDescription: null,
              cardThumbnailURL: null,
            },
            meta: {
              adoptsFrom: skillCardRef,
            },
          },
        },
      },
    });

    // The realm the tool "creates" is pre-mounted with the two files
    // `_create-realm` seeds, and `createRealm` is stubbed to return it: the
    // realm-server mock has no realm-creation endpoint. It is not in the
    // user's realm list until the tool adds it there.
    await setupAcceptanceTestRealm({
      realmURL: newRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Team Space' }),
        'index.json': cardsGridIndex,
      },
    });
  });

  test('a create-workspace tool request creates and opens the workspace', async function (assert) {
    let realmServer = getService('realm-server') as RealmServerService;
    let createRealmCalls: Parameters<RealmServerService['createRealm']>[0][] =
      [];
    realmServer.createRealm = async (args) => {
      createRealmCalls.push(args);
      return new URL(newRealmURL);
    };

    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      aiAssistantOpen: true,
    });
    await waitFor('[data-room-settled]');
    let roomId = getRoomIds().pop()!;
    await addSkillToAiAssistant(`${testRealmURL}Skill/workspace-admin`);
    await waitForNewRoomSkillsLoaded(roomId);

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Creating a workspace for the team',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
      [APP_BOXEL_TOOL_REQUESTS_KEY]: [
        {
          id: 'create-ws-1',
          name: createWorkspaceToolName,
          arguments: JSON.stringify({
            description: 'Create the Team Space workspace',
            attributes: {
              name: 'Team Space',
              endpoint: 'team-space',
            },
          }),
        },
      ],
    });

    await waitFor('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    assert
      .dom('[data-test-message-idx="0"] .tool-description')
      .containsText('Create the Team Space workspace');
    assert.strictEqual(
      createRealmCalls.length,
      0,
      'nothing is created before the user approves',
    );

    await click('[data-test-message-idx="0"] [data-test-tool-call-apply]');
    await waitFor(
      '[data-test-message-idx="0"] [data-test-apply-state="applied"]',
    );

    assert.strictEqual(createRealmCalls.length, 1, 'one realm is created');
    assert.strictEqual(createRealmCalls[0].endpoint, 'team-space');
    assert.strictEqual(createRealmCalls[0].name, 'Team Space');

    await waitUntil(
      () =>
        getRoomEvents(roomId).find(
          (m) =>
            m.content.msgtype ===
              APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE &&
            m.content.commandRequestId === 'create-ws-1',
        ),
      {
        timeout: 5000,
        timeoutMessage: 'timed out waiting for the tool result event',
      },
    );
    let resultEvent = getRoomEvents(roomId).find(
      (m) =>
        m.content.msgtype === APP_BOXEL_TOOL_RESULT_WITH_NO_OUTPUT_MSGTYPE &&
        m.content.commandRequestId === 'create-ws-1',
    )!;
    assert.strictEqual(
      resultEvent.content['m.relates_to']?.rel_type,
      APP_BOXEL_TOOL_RESULT_REL_TYPE,
    );
    assert.strictEqual(resultEvent.content['m.relates_to']?.key, 'applied');
    // `data` is a JSON string on the wire.
    let resultData = JSON.parse(resultEvent.content.data as string);
    assert.strictEqual(
      resultData.context?.realmUrl,
      newRealmURL,
      'the context sent with the result names the new workspace, so the assistant can report its URL',
    );
    assert.strictEqual(
      getService('operator-mode-state-service').state?.stacks[0]?.[0]?.id,
      `${newRealmURL}index`,
      'the new workspace is opened',
    );

    // The chooser lists the new workspace without a reload.
    await click('[data-test-workspace-chooser-toggle]');
    await waitFor(
      '[data-test-workspace-list] [data-test-workspace="Team Space"]',
    );
    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Team Space"]')
      .exists('the new workspace appears in the workspace chooser');
  });
});
