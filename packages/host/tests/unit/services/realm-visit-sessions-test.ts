import { setupTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import type RealmService from '@cardstack/host/services/realm';
import { SessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

// A realm at an origin's root prefixes every realm under that origin, which is
// what makes one left behind by an earlier visit claim the next visit's realm.
const ROOT_REALM = 'http://visit-sessions.test/';
const NESTED_REALM = 'http://visit-sessions.test/nested/';
const OTHER_REALM = 'http://other-visit-sessions.test/realm/';
const PUBLIC_REALM = 'http://public-visit-sessions.test/realm/';

// A session token is only read for its claims here, never verified, so a
// header-and-payload pair is the whole shape that matters.
function sessionToken(realm: string, nonce = 'a'): string {
  return `header.${btoa(JSON.stringify({ realm, nonce }))}`;
}

// What the prerender server does before each visit: replace the tab's stored
// sessions with the ones this visit's caller holds.
function writeVisitSessions(sessions: Record<string, string>) {
  window.localStorage.setItem(SessionLocalStorageKey, JSON.stringify(sessions));
}

module('Unit | Service | realm | prerender visit sessions', function (hooks) {
  setupTest(hooks);
  setupWindowMock(hooks);

  let realm: RealmService;

  hooks.beforeEach(function () {
    // A prerender tab's context: the realm resources it restores don't start
    // refreshing their tokens against a realm server.
    (globalThis as any).__boxelRenderContext = true;
    realm = this.owner.lookup('service:realm') as RealmService;
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelRenderContext;
  });

  test('a visit drops the sessions an earlier visit left that its own sessions do not carry', function (assert) {
    writeVisitSessions({ [ROOT_REALM]: sessionToken(ROOT_REALM) });
    realm.restoreSessionsFromStorage({ startingVisit: true });
    assert.strictEqual(
      realm.url(`${NESTED_REALM}card`),
      ROOT_REALM,
      'while the root realm is known, it claims the nested realm’s cards',
    );

    // The pool hands this tab to the nested realm's visit.
    let nestedToken = sessionToken(NESTED_REALM);
    writeVisitSessions({ [NESTED_REALM]: nestedToken });
    realm.restoreSessionsFromStorage({ startingVisit: true });

    assert.strictEqual(
      realm.url(`${NESTED_REALM}card`),
      NESTED_REALM,
      'the nested realm’s card resolves to its own realm',
    );
    assert.false(
      realm.realms.has(ROOT_REALM),
      'the root realm the earlier visit held a session for is gone',
    );
    assert.strictEqual(
      realm.token(`${NESTED_REALM}card`),
      nestedToken,
      'the nested realm’s card is fetched with the nested realm’s session',
    );
    assert.deepEqual(
      JSON.parse(window.localStorage.getItem(SessionLocalStorageKey)!),
      { [NESTED_REALM]: nestedToken },
      'storage still holds exactly the visit’s sessions',
    );
  });

  test('a restore within a visit keeps sessions storage no longer carries', function (assert) {
    let rootToken = sessionToken(ROOT_REALM);
    writeVisitSessions({
      [ROOT_REALM]: rootToken,
      [OTHER_REALM]: sessionToken(OTHER_REALM),
    });
    realm.restoreSessionsFromStorage({ startingVisit: true });

    // A relogin mid-visit clears the whole blob before storing its own token.
    writeVisitSessions({ [OTHER_REALM]: sessionToken(OTHER_REALM, 'b') });
    realm.restoreSessionsFromStorage();

    assert.strictEqual(
      realm.realms.get(ROOT_REALM)?.token,
      rootToken,
      'the root realm keeps the session the visit began with',
    );
  });

  test('a realm identified without a session outlives the visit that found it', function (assert) {
    realm.getOrCreateRealmResource(PUBLIC_REALM);
    writeVisitSessions({ [OTHER_REALM]: sessionToken(OTHER_REALM) });
    realm.restoreSessionsFromStorage({ startingVisit: true });

    assert.true(
      realm.realms.has(PUBLIC_REALM),
      'a session-less realm is not taken for another caller’s',
    );
  });
});
