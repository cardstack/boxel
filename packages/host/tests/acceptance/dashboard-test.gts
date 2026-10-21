import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupFeatureFlag } from '../helpers/feature-flags';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const realmURL = 'http://test-realm/testuser/workspace-a/';

module('Acceptance | dashboard', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [realmURL],
    dashboardState: {
      version: 1,
      agent: 'codex',
      agentSetup: { codex: 2 },
    },
  });

  hooks.beforeEach(async function () {
    setupUserSubscription();
    setupAuthEndpoints();
    await setupAcceptanceTestRealm({
      realmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace A' }),
      },
    });
  });

  module('state', function () {
    test('loads the stored state at login', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState, {
        version: 1,
        agent: 'codex',
        agentSetup: { codex: 2 },
      });
    });

    test('drops stored fields that do not match the current shape', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        version: 1,
        onboardingDismissed: 'yes',
        agent: 'clippy',
        agentSetup: { claude: 2, clippy: 5, codex: -1, grok: 1.5 },
      });
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState, {
        version: 1,
        agentSetup: { claude: 2 },
      });
    });

    test('follows writes made in another tab', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        version: 1,
        onboardingDismissed: true,
      });
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState, {
        version: 1,
        onboardingDismissed: true,
      });
    });

    test('a write keeps stored fields, including ones this version does not know', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        version: 1,
        agent: 'grok',
        agentSetup: { grok: 3 },
        futureField: 'kept',
      });
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.updateDashboardState({ onboardingDismissed: true });

      assert.deepEqual(
        mockMatrixUtils.getDashboardState(),
        {
          version: 1,
          agent: 'grok',
          agentSetup: { grok: 3 },
          futureField: 'kept',
          onboardingDismissed: true,
        },
        'the stored copy keeps the other write, including fields this version does not know',
      );
      assert.deepEqual(matrixService.dashboardState, {
        version: 1,
        onboardingDismissed: true,
        agent: 'grok',
        agentSetup: { grok: 3 },
      });
    });

    test('overlapping writes from one tab all land', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      let bump = (stored: typeof matrixService.dashboardState) => ({
        agentSetup: {
          ...stored.agentSetup,
          claude: (stored.agentSetup?.claude ?? 0) + 1,
        },
      });
      await Promise.all([
        matrixService.updateDashboardState(bump),
        matrixService.updateDashboardState(bump),
        matrixService.updateDashboardState({ agent: 'claude' }),
        matrixService.updateDashboardState(bump),
      ]);

      assert.deepEqual(matrixService.dashboardState.agentSetup, {
        codex: 2,
        claude: 3,
      });
      assert.strictEqual(matrixService.dashboardState.agent, 'claude');
      assert.deepEqual(
        (mockMatrixUtils.getDashboardState() as any).agentSetup,
        { codex: 2, claude: 3 },
        'the stored copy has every write',
      );
    });

    test("setting one agent's progress keeps the other agents'", async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        version: 1,
        agentSetup: { codex: 2, gemini: 4 },
      });
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.updateDashboardState({ agentSetup: { claude: 1 } });

      assert.deepEqual(
        (mockMatrixUtils.getDashboardState() as any).agentSetup,
        { codex: 2, gemini: 4, claude: 1 },
        'the stored copy keeps every agent, including ones this version does not know',
      );
      assert.deepEqual(matrixService.dashboardState.agentSetup, {
        codex: 2,
        claude: 1,
      });
    });

    test('a failed write does not block later writes', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      let failed = matrixService.updateDashboardState(() => {
        throw new Error('boom');
      });
      let next = matrixService.updateDashboardState({ agent: 'boxel' });

      await assert.rejects(failed, /boom/);
      await next;
      assert.strictEqual(matrixService.dashboardState.agent, 'boxel');
    });

    test('does not overwrite state stored by a newer version', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let newer = { version: 2, agent: 'codex', futureField: 'kept' };
      await mockMatrixUtils.setDashboardStateFromAnotherDevice(newer);
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      await assert.rejects(
        matrixService.updateDashboardState({ agent: 'claude' }),
        /newer version/,
      );
      assert.deepEqual(mockMatrixUtils.getDashboardState(), newer);
    });

    test('a write queued before logout does not reach the next session', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      let write = matrixService.updateDashboardState({ agent: 'claude' });
      // Not awaited first: logout tears down the session synchronously, while
      // the write is still waiting on its read.
      let logout = matrixService.logout();
      await write;
      await logout;

      assert.deepEqual(matrixService.dashboardState, {});
      assert.strictEqual(
        (mockMatrixUtils.getDashboardState() as any).agent,
        'codex',
      );
    });
  });

  module('feature flag off', function () {
    test('the workspace chooser opens', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.dom('[data-test-workspace-chooser]').exists();
      assert.dom('[data-test-dashboard]').doesNotExist();
    });
  });

  module('feature flag on', function (hooks) {
    setupFeatureFlag(hooks, 'DASHBOARD_V2');

    test('the dashboard opens in place of the workspace chooser', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      assert.dom('[data-test-dashboard]').exists();
      assert.dom('[data-test-workspace-chooser]').doesNotExist();
    });
  });
});
