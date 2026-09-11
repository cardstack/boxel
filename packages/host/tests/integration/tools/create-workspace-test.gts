import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ri } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';
import CreateWorkspaceTool from '@cardstack/host/tools/create-workspace';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  setupRealmServerEndpoints,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const realmServerURL = 'http://test-realm/';

module('Integration | tools | create-workspace', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupRealmServerEndpoints(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmCacheTeardown(hooks);

  // The realm-server mock has no realm-creation endpoint, so `createRealm` is
  // stubbed to record its arguments and hand back the URL the server would
  // mint for the given endpoint. Everything around that call — name and
  // endpoint choice, the realm list update, the reported URL — runs for real.
  let createRealmCalls: Parameters<RealmServerService['createRealm']>[0][];
  let realmMetaRequests: string[];
  hooks.beforeEach(async function () {
    createRealmCalls = [];
    realmMetaRequests = [];
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      }),
    );
    let realmServer = getService('realm-server') as RealmServerService;
    realmServer.createRealm = async (args) => {
      createRealmCalls.push(args);
      return new URL(`${realmServerURL}testuser/${args.endpoint}/`);
    };
    // The created realm is not mounted in this test, so the realm-info fetch
    // the tool makes for it is recorded instead of performed.
    let realmService = getService('realm');
    realmService.ensureRealmMeta = async (realmURL: string) => {
      realmMetaRequests.push(realmURL);
    };
  });

  test('creates a workspace with the given name and endpoint', async function (assert) {
    let toolService = getService('tool-service');
    let realmServer = getService('realm-server') as RealmServerService;
    let tool = new CreateWorkspaceTool(toolService.toolContext);

    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [],
      submode: 'interact',
      workspaceChooserOpened: true,
    });

    await tool.execute({
      name: 'Sales Pipeline',
      endpoint: 'sales',
    });

    assert.strictEqual(createRealmCalls.length, 1, 'one realm is created');
    assert.strictEqual(createRealmCalls[0].endpoint, 'sales');
    assert.strictEqual(createRealmCalls[0].name, 'Sales Pipeline');
    assert.ok(createRealmCalls[0].iconURL, 'an icon is chosen for the realm');
    assert.ok(
      createRealmCalls[0].backgroundURL,
      'a background is chosen for the realm',
    );

    assert.deepEqual(
      realmMetaRequests,
      [`${realmServerURL}testuser/sales/`],
      'the realm service is told about the new realm before it is opened',
    );
    assert.strictEqual(
      operatorModeStateService.state?.stacks[0]?.[0]?.id,
      `${realmServerURL}testuser/sales/index`,
      'the new workspace is opened, so its URL reaches the assistant as the current workspace',
    );

    assert.true(
      realmServer.userRealmIdentifiers.includes(
        ri(`${realmServerURL}testuser/sales/`),
      ),
      'the new workspace is in the realm list the workspace chooser renders',
    );
    assert.strictEqual(
      realmServer.userRealmIdentifiers[0],
      ri(`${realmServerURL}testuser/sales/`),
      'the new workspace is listed first, as the newest-created realm',
    );
  });

  test('derives the endpoint from the name when no endpoint is given', async function (assert) {
    let toolService = getService('tool-service');
    let tool = new CreateWorkspaceTool(toolService.toolContext);

    await tool.execute({ name: "Zoë's Q3 Plan" });

    assert.strictEqual(createRealmCalls[0].endpoint, 'zoes-q3-plan');
    assert.strictEqual(createRealmCalls[0].name, "Zoë's Q3 Plan");
  });

  test('normalizes an endpoint into the characters the server accepts', async function (assert) {
    let toolService = getService('tool-service');
    let tool = new CreateWorkspaceTool(toolService.toolContext);

    await tool.execute({
      name: 'Team',
      endpoint: ' My_Team  Space! ',
    });

    assert.strictEqual(createRealmCalls[0].endpoint, 'my-team-space');
  });

  test('generates a name and endpoint when neither is given', async function (assert) {
    let toolService = getService('tool-service');
    let tool = new CreateWorkspaceTool(toolService.toolContext);

    await tool.execute({});

    let [call] = createRealmCalls;
    assert.ok(call.name, 'a display name is generated');
    assert.ok(
      /^[a-z0-9-]+$/.test(call.endpoint),
      `the endpoint '${call.endpoint}' is in the server's accepted shape`,
    );
  });

  test('rejects an endpoint that leaves no usable characters', async function (assert) {
    let toolService = getService('tool-service');
    let tool = new CreateWorkspaceTool(toolService.toolContext);

    await assert.rejects(
      tool.execute({ name: 'Team', endpoint: '!!!' }),
      /Cannot derive a workspace endpoint/,
    );
    assert.strictEqual(createRealmCalls.length, 0, 'no realm is created');
  });

  test('surfaces the server error when creation fails', async function (assert) {
    let toolService = getService('tool-service');
    let realmServer = getService('realm-server') as RealmServerService;
    realmServer.createRealm = async () => {
      throw new Error(
        `Could not create realm with endpoint 'sales': 400 - realm already exists`,
      );
    };
    let tool = new CreateWorkspaceTool(toolService.toolContext);

    await assert.rejects(
      tool.execute({ name: 'Sales', endpoint: 'sales' }),
      /realm already exists/,
    );
    assert.false(
      realmServer.userRealmIdentifiers.includes(
        ri(`${realmServerURL}testuser/sales/`),
      ),
      'a failed creation adds nothing to the realm list',
    );
  });
});
