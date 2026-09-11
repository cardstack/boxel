import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash } from '@cardstack/runtime-common';
import { PERSONAL_REALM_ENDPOINT } from '@cardstack/runtime-common/realm-display-defaults';

import ENV from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  testRealmURL,
  setupAuthEndpoints,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

const testRealmServerURL = ensureTrailingSlash(ENV.realmServerURL);
// A personal workspace is served at `<server>/<username>/personal/`.
const personalRealmURL = ensureTrailingSlash(
  `${new URL(testRealmURL).origin}/testuser/${PERSONAL_REALM_ENDPOINT}/`,
);

// The host sign-up flow creates a personal workspace, but an account
// provisioned another way (e.g. registered straight on Synapse) never gets
// one. `ensurePersonalRealmForUserIfMissing` provisions it when absent. Auto-
// provisioning at boot is gated to real deployments (`hostedEnvironment` is
// `local` in the test suite), so we drive the method directly here.
module(
  'Integration | matrix-service | ensurePersonalRealmForUserIfMissing',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    let createRealmCalls: Parameters<RealmServerService['createRealm']>[0][];

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      createRealmCalls = [];
      // Capture calls instead of hitting `_create-realm` over the wire.
      realmServer.createRealm = async (args) => {
        createRealmCalls.push(args);
        return new URL(personalRealmURL);
      };
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('boot does not auto-provision in the test environment', async function (assert) {
      // The gate keeps auto-provisioning out of the test suite; boot must not
      // create a realm on its own.
      assert.strictEqual(
        createRealmCalls.length,
        0,
        'no realm is auto-created at boot when hostedEnvironment is local',
      );
    });

    test('a user with no personal realm gets one created with the personal endpoint', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ensurePersonalRealmForUserIfMissing();
      assert.strictEqual(
        createRealmCalls.length,
        1,
        'createRealm was called exactly once',
      );
      assert.strictEqual(
        createRealmCalls[0]?.endpoint,
        PERSONAL_REALM_ENDPOINT,
        'with the personal endpoint',
      );
    });
  },
);

// The inverse: a user who already has a personal workspace must not have a
// second one provisioned.
module(
  'Integration | matrix-service | ensurePersonalRealm skips an existing one',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, personalRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    let createRealmCalls: Parameters<RealmServerService['createRealm']>[0][];

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      // `_realm-auth` advertises the existing personal realm, so boot's
      // assembled list already contains it.
      setupAuthEndpoints({
        [personalRealmURL]: ['read', 'write', 'realm-owner'],
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      createRealmCalls = [];
      realmServer.createRealm = async (args) => {
        createRealmCalls.push(args);
        return new URL(personalRealmURL);
      };
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('createRealm is not called when a personal realm already exists', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ensurePersonalRealmForUserIfMissing();
      assert.strictEqual(
        createRealmCalls.length,
        0,
        'no personal realm is provisioned when one is already present',
      );
    });
  },
);
