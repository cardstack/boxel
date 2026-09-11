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
// provisioned another way (e.g. registered straight on Synapse) never gets
// one. Boot provisions it lazily when the user has none, so a plain login
// leaves the account with a complete workspace list.
module(
  'Integration | matrix-service | lazy personal realm on login',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // A trusted-servers session (own server present) so boot is authoritative
    // and this suite isolates the personal-realm behavior from the keyless seed.
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
      // Provisioning is fire-and-forget from boot; let the task settle.
      await settled();
    });

    test('a user with no personal realm gets one created with the personal endpoint', async function (assert) {
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
// second one provisioned on every login.
module(
  'Integration | matrix-service | login does not duplicate an existing personal realm',
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
