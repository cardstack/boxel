import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, ensureTrailingSlash, ri } from '@cardstack/runtime-common';
import {
  APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
  REALMS_LIST_UPDATED_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import ENV from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  testRealmURL,
  setRealmArchived,
  setupAuthEndpoints,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../helpers';

import { setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';

import { setupRenderingTest } from '../helpers/setup';

const testRealmServerURL = ensureTrailingSlash(ENV.realmServerURL);
// A realm created out of band, rooted at the same origin as the test realm so
// it resolves to the user's own realm server (see `assertOwnRealmServer`).
const outOfBandRealmURL = ensureTrailingSlash(
  `${new URL(testRealmURL).origin}/testuser/out-of-band/`,
);

// Push a `realms-list-updated` realm-server event into the session room, the
// way the realm server does after a realm is created/deleted/archived/
// unarchived out of band. Routed through the same `handleEvent` dispatch the
// live Matrix timeline uses, so the matrix-service subscriber fires.
async function fireRealmsListUpdated(realmServer: RealmServerService) {
  // Ensure the realm-server token (and its sessionRoom claim) is present so the
  // event's room_id matches, the way it always is on a booted session.
  await realmServer.login();
  let sessionRoom = (realmServer as any).auth?.claims?.sessionRoom as string;
  await realmServer.handleEvent({
    room_id: sessionRoom,
    content: {
      msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
      body: JSON.stringify({ eventType: REALMS_LIST_UPDATED_EVENT_TYPE }),
    },
  } as any);
}

// A realm created out of band (another tab, the CLI, an AI agent) has no
// signal that reaches a trusted-server session — its realm list is
// assembled authoritatively from `_realm-auth` at boot. The realm server now
// pushes a `realms-list-updated` event to the owner's session room, and the
// host re-derives the list so a session viewing the workspace chooser updates
// without a reload.
module(
  'Integration | matrix-service | realms-list-updated (trusted server)',
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
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('the event pulls in a realm created out of band', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;
      assert.notOk(
        realmServer.userRealmIdentifiers.includes(ri(outOfBandRealmURL)),
        'the out-of-band realm is absent before the event',
      );

      // Out-of-band creation: the realm server now advertises the realm via
      // `_realm-auth`.
      setupAuthEndpoints({
        [outOfBandRealmURL]: ['read', 'write', 'realm-owner'],
      });

      await fireRealmsListUpdated(realmServer);

      assert.ok(
        realmServer.userRealmIdentifiers.includes(ri(outOfBandRealmURL)),
        'the out-of-band realm appears after the event without a reload',
      );
      assert.ok(
        realmServer.userRealmIdentifiers.includes(ri(testRealmURL)),
        'the already-loaded realm is retained',
      );
    });

    // The event also has to keep the separate Archived section honest, since
    // one generic signal serves all four mutations. `_realm-auth` (the active
    // list) excludes archived realms, so an out-of-band archive would leave a
    // stale Archived section without the refresh reaching that second list.
    test('an out-of-band archive moves the realm from Your Workspaces into an already-open Archived section', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;

      // An owned realm the trusted server advertises as active.
      setupAuthEndpoints({
        [outOfBandRealmURL]: ['read', 'write', 'realm-owner'],
      });
      await fireRealmsListUpdated(realmServer);
      assert.ok(
        realmServer.userRealmIdentifiers.includes(ri(outOfBandRealmURL)),
        'the realm is active before archiving',
      );

      // The owner has opened the Archived section (empty so far).
      await realmServer.fetchArchivedRealms();
      assert.strictEqual(
        realmServer.archivedRealms.length,
        0,
        'the Archived section is empty before archiving',
      );

      // Out-of-band archive: the trusted server drops it from `_realm-auth` and
      // begins surfacing it from `_archived-realms`.
      setRealmArchived(outOfBandRealmURL, true);

      await fireRealmsListUpdated(realmServer);

      assert.notOk(
        realmServer.userRealmIdentifiers.includes(ri(outOfBandRealmURL)),
        'the realm leaves Your Workspaces after the archive event',
      );
      assert.ok(
        realmServer.archivedRealms.some((r) => r.url === outOfBandRealmURL),
        'the realm appears in the already-open Archived section without a reload',
      );
    });

    test('an out-of-band unarchive restores the realm to Your Workspaces and clears it from an already-open Archived section', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;

      // An owned realm that starts archived: absent from `_realm-auth`, present
      // in `_archived-realms`.
      setupAuthEndpoints({
        [outOfBandRealmURL]: ['read', 'write', 'realm-owner'],
      });
      setRealmArchived(outOfBandRealmURL, true);
      await fireRealmsListUpdated(realmServer);
      assert.notOk(
        realmServer.userRealmIdentifiers.includes(ri(outOfBandRealmURL)),
        'the archived realm is absent from Your Workspaces to start',
      );

      // The owner has opened the Archived section and sees it there.
      await realmServer.fetchArchivedRealms();
      assert.ok(
        realmServer.archivedRealms.some((r) => r.url === outOfBandRealmURL),
        'the realm is in the Archived section to start',
      );

      // Out-of-band unarchive.
      setRealmArchived(outOfBandRealmURL, false);

      await fireRealmsListUpdated(realmServer);

      assert.ok(
        realmServer.userRealmIdentifiers.includes(ri(outOfBandRealmURL)),
        'the realm returns to Your Workspaces after the unarchive event',
      );
      assert.notOk(
        realmServer.archivedRealms.some((r) => r.url === outOfBandRealmURL),
        'the realm is cleared from the Archived section — not left showing in both',
      );
    });

    // The archived refresh is guarded: an owner who never opened the Archived
    // section must not pay its fetch on every list-changed push.
    test('an out-of-band archive does not fetch the Archived section when it was never opened', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;

      setupAuthEndpoints({
        [outOfBandRealmURL]: ['read', 'write', 'realm-owner'],
      });
      await fireRealmsListUpdated(realmServer);
      assert.notOk(
        realmServer.isArchivedRealmsFetched,
        'the Archived section is unfetched to start',
      );

      setRealmArchived(outOfBandRealmURL, true);
      await fireRealmsListUpdated(realmServer);

      assert.notOk(
        realmServer.userRealmIdentifiers.includes(ri(outOfBandRealmURL)),
        'the realm still leaves Your Workspaces',
      );
      assert.notOk(
        realmServer.isArchivedRealmsFetched,
        'the Archived section stays unfetched — the owner never opened it',
      );
    });
  },
);

// Legacy sessions derive the realm list from `app.boxel.realms` account data,
// whose Matrix sync already delivers out-of-band changes. The refresh must not
// switch a legacy session onto the authoritative `_realm-auth` path, which
// could drop realms the trusted servers don't advertise.
module(
  'Integration | matrix-service | realms-list-updated (legacy session)',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    // No `activeRealmServers` — boot falls back to the legacy realm list.
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
      let realmServer = getService('realm-server') as RealmServerService;
      await realmServer.setAvailableRealmIdentifiers([]);
      let matrixService = getService('matrix-service') as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    });

    test('the event does not re-derive the list from _realm-auth', async function (assert) {
      let realmServer = getService('realm-server') as RealmServerService;

      // Advertise a realm via `_realm-auth` that the legacy list does not
      // contain. A legacy session must ignore it on this event.
      setupAuthEndpoints({
        [outOfBandRealmURL]: ['read', 'write', 'realm-owner'],
      });

      await fireRealmsListUpdated(realmServer);

      assert.notOk(
        realmServer.userRealmIdentifiers.includes(ri(outOfBandRealmURL)),
        'a legacy session is left to its account-data sync path',
      );
    });
  },
);
