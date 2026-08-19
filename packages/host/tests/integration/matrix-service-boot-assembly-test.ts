import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash, ri } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setRealmAuthFailure,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

const testRealmServerURL = ensureTrailingSlash(ENV.realmServerURL);
// The realm-server service normalizes the test-realm origin onto the base
// realm origin (see `normalizeRealmServerURL`), so a realm rooted at the
// test-realm origin resolves to this canonical server identity.
const normalizedTrustedServerURL = ensureTrailingSlash(
  new URL(ENV.resolvedBaseRealmURL).origin,
);

// Boot assembles the available-realms list from the user's trusted
// realm-servers (`app.boxel.realm-servers`) by asking each via
// `_realm-auth`, rather than reading the realm list directly out of
// `app.boxel.realms`. A transition fallback to the legacy key remains
// until the lazy migration that populates `app.boxel.realm-servers` has
// run on all active accounts.
module(
  'Integration | matrix-service | boot assembly with trusted servers',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // Don't autostart Matrix during realm setup: `setupIntegrationTestRealm`
    // backfills the integration realm URL into `availableRealmIdentifiers`,
    // which would mask a boot-assembly regression. We clear that backfill and
    // run `start()` explicitly so the boot path alone populates the list.
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('boot populates availableRealmIdentifiers when `app.boxel.realm-servers` is set', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL is present in availableRealmIdentifiers',
      );
    });

    test('fetchUserRealmsFromTrustedServers returns realms advertised by `_realm-auth`', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      let realms = await realmServer.fetchUserRealmsFromTrustedServers([
        testRealmServerURL,
      ]);
      assert.deepEqual(
        realms,
        [testRealmURL],
        'returns the trusted server’s realms',
      );
    });

    test('fetchUserRealmsFromTrustedServers returns [] for an empty input', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      let realms = await realmServer.fetchUserRealmsFromTrustedServers([]);
      assert.deepEqual(realms, [], 'short-circuits without any HTTP call');
    });

    test('fetchUserRealmsFromTrustedServers rejects non-own realm-server URLs', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      await assert.rejects(
        realmServer.fetchUserRealmsFromTrustedServers([
          'https://other-server.example/',
        ]),
        /Multi-realm server support is not yet implemented/,
      );
    });
  },
);

module(
  'Integration | matrix-service | trusted-servers result survives legacy event',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // The mock matrix client's `startClient` re-emits a synthetic
    // `app.boxel.realms` AccountData event carrying `activeRealms`. When
    // trusted servers are authoritative, that re-emission must NOT
    // overwrite the realms the trusted-servers boot path discovered.
    // `activeRealms` is empty while `_realm-auth` advertises testRealmURL,
    // so a clobber would zero the available-realms list and drop
    // testRealmURL — making the regression observable as a missing realm.
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      // Clear the URL `setupIntegrationTestRealm` backfills so the boot path —
      // and the `startClient()` legacy-event re-emission it triggers — is
      // solely responsible for the final list.
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('legacy realms event does not overwrite the trusted-servers boot result', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL from _realm-auth survives the legacy event',
      );
    });
  },
);

module(
  'Integration | matrix-service | boot assembly fallback to legacy realms',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // No activeRealmServers — the mock returns `{ realmServers: [] }`, the
    // same shape the host sees for a user who hasn't yet been migrated to
    // `app.boxel.realm-servers`.
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      // Clear the backfilled URL so the legacy-fallback boot path is what
      // populates the list, not `setupIntegrationTestRealm`.
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('boot still populates realms from `app.boxel.realms`', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL is present in availableRealmIdentifiers',
      );
    });
  },
);

// Lazy migration on host boot. An account with no `app.boxel.realm-servers`
// entry (only `app.boxel.realms` set) has the new key seeded on next boot
// with the realm-server backing its existing realms (derived via JWT
// `realmServerURL` claim / own-server fallback, never the bare realm-URL
// origin). The legacy key is retained for rollback safety.
module(
  'Integration | matrix-service | lazy migration seeds realm-servers',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // Only the legacy `app.boxel.realms` key is set (no activeRealmServers),
    // matching an unmigrated account.
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('boot writes `app.boxel.realm-servers` with the backing realm-server', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let realmServers = await matrixService.getRealmServersFromAccountData();
      assert.deepEqual(
        realmServers,
        [normalizedTrustedServerURL],
        'the realm-server backing testRealmURL is persisted (own server, not the base-realm origin)',
      );
    });

    test('boot retains the legacy `app.boxel.realms` key', async function (assert) {
      assert.deepEqual(
        mockMatrixUtils.getActiveRealms(),
        [testRealmURL],
        'app.boxel.realms is left intact for rollback safety',
      );
    });

    test('boot still assembles the available realms', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL is present in availableRealmIdentifiers',
      );
    });

    test('the migration self-write echo does not flip the boot to the trusted path', async function (assert) {
      // The migration writes `app.boxel.realm-servers` during start(), and that
      // write echoes back through the AccountData listener twice: synchronously
      // from setAccountData, and again when startClient()'s initial sync
      // re-emits every account-data key. Neither echo may switch this
      // legacy-booted session to the authoritative trusted-servers path —
      // doing so would re-derive the realm list from `_realm-auth` and could
      // drop realms the trusted servers don't advertise.
      let matrixService = getService('matrix-service') as MatrixService;
      let realmServer = getService('realm-server') as RealmServerService;

      assert.deepEqual(
        matrixService.bootAssemblyDebug,
        {
          trustedRealmServersAuthoritative: false,
          bootedFromLegacyRealmsList: true,
        },
        'the session stays on the legacy path despite the realm-servers echo',
      );
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'the legacy-assembled realm survives the echo',
      );
    });

    test('a re-boot of the same session after migration stays on the legacy path', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      let realmServer = getService('realm-server') as RealmServerService;

      // The first boot (beforeEach) migrated and wrote `app.boxel.realm-servers`.
      // Re-booting the same MatrixService instance must keep assembling from the
      // legacy realm list rather than switching to the trusted-servers path,
      // which would re-derive the list from `_realm-auth`. The migration only
      // takes effect on the next fresh session.
      await matrixService.start();

      assert.deepEqual(
        await matrixService.getRealmServersFromAccountData(),
        [normalizedTrustedServerURL],
        'realm-servers stays as migrated — not re-derived or duplicated',
      );
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'testRealmURL from the legacy list survives the re-boot',
      );
    });
  },
);

// Graceful degradation: a trusted server that's unreachable during boot
// assembly (its `_realm-auth` fails/times out) must never block boot or hide
// the realms served by the servers that are reachable. The unreachable server
// is recorded so a notice can name it, and a retry recovers it — the notice
// clears on success.
module(
  'Integration | matrix-service | graceful degradation when a trusted server is unreachable',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      // Simulate the trusted server being unreachable during boot assembly.
      setRealmAuthFailure(true);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('boot completes without dropping the reachable base realm', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(baseRealm.url)),
        'the base realm still loads when a trusted server is unreachable',
      );
      assert.notOk(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'the unreachable server’s realm is not in the list yet',
      );
    });

    test('the unreachable trusted server is recorded so a notice can name it', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.deepEqual(
        realmServer.unreachableRealmServers,
        [testRealmServerURL],
        'the unreachable trusted server is recorded',
      );
    });

    test('retry recovers the realm and clears the notice once the server is reachable', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      let matrixService = getService('matrix-service') as MatrixService;

      setRealmAuthFailure(false);
      let allRecovered = await matrixService.retryUnreachableRealmServers();

      assert.ok(allRecovered, 'retry reports all servers recovered');
      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'the previously-unreachable realm now appears',
      );
      assert.deepEqual(
        realmServer.unreachableRealmServers,
        [],
        'the notice clears once the server is reachable',
      );
    });
  },
);

// A runtime `app.boxel.realm-servers` account-data refresh (as opposed to the
// fail-loud boot assembly) must not erase already-loaded workspaces when a
// trusted server is transiently unreachable. The event-time path merges rather
// than replaces while any server is unreachable.
module(
  'Integration | matrix-service | account-data refresh survives a transient outage',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      // Boot healthy so the trusted-servers path is authoritative and the
      // user's realm is loaded before the simulated outage.
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('a refresh while the server is unreachable keeps the already-loaded realm', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      let matrixService = getService('matrix-service') as MatrixService;

      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'the realm is loaded after a healthy boot',
      );

      // The server goes down; a runtime account-data refresh arrives.
      setRealmAuthFailure(true);
      await matrixService.applyTrustedRealmServersAccountData([
        testRealmServerURL,
      ]);

      assert.ok(
        realmServer.availableRealmIdentifiers.includes(ri(testRealmURL)),
        'the transiently-unreachable realm is not wiped from the list',
      );
      assert.deepEqual(
        realmServer.unreachableRealmServers,
        [testRealmServerURL],
        'the server is recorded as unreachable so the notice shows',
      );
    });
  },
);

module(
  'Integration | matrix-service | already-migrated account is untouched',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // `app.boxel.realm-servers` is already populated, so boot takes the
    // trusted-servers path and the migration must not run.
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      activeRealmServers: [testRealmServerURL],
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        startMatrix: false,
      });
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('boot leaves `app.boxel.realm-servers` unchanged', async function (assert) {
      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(
        await matrixService.getRealmServersFromAccountData(),
        [testRealmServerURL],
        'the existing realm-servers list is neither rewritten nor duplicated',
      );
    });
  },
);
