import type { RenderingTestContext } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';

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
// provisioned another way (e.g. registered straight on Synapse) never gets one.
// On login, `autoProvisionPersonalRealm` provisions it when absent. The flag
// defaults off in the test environment, so these tests flip it on to exercise
// the real boot path.
module(
  'Integration | matrix-service | personal realm auto-provisioning',
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

    // Set up the realm + a createRealm capture, optionally enable
    // auto-provisioning, then boot and let the fire-and-forget task settle.
    async function boot(opts: { autoProvision: boolean }) {
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
      matrixService.autoProvisionPersonalRealm = opts.autoProvision;
      await matrixService.ready;
      await matrixService.start();
      await settled();
    }

    test('login does not provision when the flag is off (the test default)', async function (this: RenderingTestContext, assert) {
      await boot({ autoProvision: false });
      assert.strictEqual(
        createRealmCalls.length,
        0,
        'no realm is auto-created at boot when auto-provisioning is off',
      );
    });

    test('login provisions a personal realm with the personal endpoint when enabled', async function (this: RenderingTestContext, assert) {
      await boot({ autoProvision: true });
      assert.strictEqual(
        createRealmCalls.length,
        1,
        'createRealm was called exactly once at boot',
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
// second one provisioned, even with the flag on.
module(
  'Integration | matrix-service | personal realm not duplicated',
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
      matrixService.autoProvisionPersonalRealm = true;
      await matrixService.ready;
      await matrixService.start();
      await settled();
    });

    test('createRealm is not called when a personal realm already exists', async function (assert) {
      assert.strictEqual(
        createRealmCalls.length,
        0,
        'no personal realm is provisioned when one is already present',
      );
    });
  },
);
