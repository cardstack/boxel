import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import type RealmService from '@cardstack/host/services/realm';
import {
  maxTokenRefreshBackoffSec,
  minTokenRefreshIntervalSec,
  tokenRefreshPeriodSec,
} from '@cardstack/host/services/realm';
import { SessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

const REALM = 'http://token-refresh.test/realm/';
const OTHER_REALM = 'http://token-refresh.test/other/';
const USER = '@refresh-user:localhost';
const PREVIOUS_USER = '@previous-account:localhost';

// A session token is only read for its claims here, never verified, so a
// header-and-payload pair is the whole shape that matters.
function sessionToken({
  realm = REALM,
  user = USER,
  expiresInSec,
  sessionRoom,
}: {
  realm?: string;
  user?: string;
  expiresInSec: number;
  sessionRoom?: string;
}): string {
  let now = Math.floor(Date.now() / 1000);
  return `header.${btoa(
    JSON.stringify({
      user,
      realm,
      permissions: ['read'],
      ...(sessionRoom ? { sessionRoom } : {}),
      iat: now,
      exp: now + expiresInSec,
    }),
  )}`;
}

// Runs the refreshers against a virtual clock. Each wait a refresher asks for
// passes at once while it fits in `budgetMs`; the first that doesn't is
// recorded and never passes, which stops the refresher there.
function virtualClock(realm: RealmService, budgetMs: number) {
  let waits: number[] = [];
  let elapsed = 0;
  let resolveExhausted: () => void;
  let exhausted = new Promise<void>((r) => (resolveExhausted = r));
  realm.waitForTokenRefresh = (ms: number) => {
    waits.push(ms);
    if (elapsed + ms > budgetMs) {
      resolveExhausted();
      return new Promise<void>(() => {});
    }
    elapsed += ms;
    return Promise.resolve();
  };
  return { waits, exhausted };
}

module('Unit | Service | realm | token refresh', function (hooks) {
  setupTest(hooks);
  setupWindowMock(hooks);

  let realm: RealmService;
  let mints: string[];
  let nextMint: () => string;
  let errors: string[];
  let originalConsoleError: typeof console.error;

  hooks.beforeEach(function () {
    mints = [];
    errors = [];
    nextMint = () => sessionToken({ expiresInSec: 24 * 60 * 60 });
    this.owner.register(
      'service:matrix-service',
      class extends Service {
        async createRealmSession(realmURL: URL) {
          mints.push(realmURL.href);
          return nextMint();
        }
      },
    );
    realm = this.owner.lookup('service:realm') as RealmService;
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
  });

  hooks.afterEach(function () {
    console.error = originalConsoleError;
  });

  test('a session without a session room is refreshed by its expiry, not at once', async function (assert) {
    let { waits, exhausted } = virtualClock(realm, 60 * 1000);
    realm.getOrCreateRealmResource(
      REALM,
      sessionToken({ expiresInSec: 24 * 60 * 60 }),
    );
    await exhausted;

    assert.strictEqual(mints.length, 0, 'no session is minted in a minute');
    assert.ok(
      waits[0] > 23 * 60 * 60 * 1000,
      `the refresh is scheduled shortly before the session expires (${waits[0]}ms)`,
    );
  });

  test('a session that arrives too close to expiry is minted again at a doubling interval', async function (assert) {
    // A realm server that hands out sessions already inside the refresh
    // period, every time.
    nextMint = () => sessionToken({ expiresInSec: tokenRefreshPeriodSec });
    let { waits, exhausted } = virtualClock(realm, 60 * 1000);
    realm.getOrCreateRealmResource(REALM, sessionToken({ expiresInSec: -10 }));
    await exhausted;

    assert.strictEqual(
      mints.length,
      2,
      'the expired session is replaced at once, and the unusable replacement once more in the minute',
    );
    assert.deepEqual(
      waits,
      [0, minTokenRefreshIntervalSec * 1000, minTokenRefreshIntervalSec * 2000],
      'each unusable mint doubles the wait before the next',
    );
    assert.strictEqual(errors.length, 2, 'each unusable mint is reported');
    assert.ok(
      errors[0].includes(REALM),
      'the report names the realm the session was minted for',
    );
  });

  test('the wait after unusable mints is capped, and a usable mint schedules by expiry again', async function (assert) {
    let unusable = 8;
    nextMint = () =>
      mints.length <= unusable
        ? sessionToken({ expiresInSec: 0 })
        : sessionToken({ expiresInSec: 24 * 60 * 60 });
    let { waits, exhausted } = virtualClock(realm, 24 * 60 * 60 * 1000);
    realm.getOrCreateRealmResource(REALM, sessionToken({ expiresInSec: -10 }));
    await exhausted;

    let backoff = waits.slice(1, unusable + 1);
    assert.deepEqual(
      backoff,
      backoff.map((_, i) =>
        Math.min(
          minTokenRefreshIntervalSec * 1000 * 2 ** i,
          maxTokenRefreshBackoffSec * 1000,
        ),
      ),
      'the wait doubles up to its cap',
    );
    assert.ok(
      waits[unusable + 1] > 23 * 60 * 60 * 1000,
      'the first usable session is refreshed shortly before it expires',
    );
  });

  test('logging out starts the next session without the previous one’s backoff', async function (assert) {
    nextMint = () => sessionToken({ expiresInSec: tokenRefreshPeriodSec });
    let first = virtualClock(realm, minTokenRefreshIntervalSec * 1000);
    let resource = realm.getOrCreateRealmResource(
      REALM,
      sessionToken({ expiresInSec: -10 }),
    );
    await first.exhausted;
    assert.deepEqual(
      first.waits,
      [0, minTokenRefreshIntervalSec * 1000, minTokenRefreshIntervalSec * 2000],
      'two unusable mints double the wait',
    );

    realm.logout();
    let second = virtualClock(realm, 0);
    // Already subscribed, so signing back in fetches no realm info.
    (resource as any).subscription = { unsubscribe() {} };
    await resource.login();
    await second.exhausted;

    assert.deepEqual(
      second.waits,
      [minTokenRefreshIntervalSec * 1000],
      'the first unusable mint after logging back in waits the shortest interval',
    );
  });

  test('reauthenticating a realm keeps every other realm’s session', async function (assert) {
    virtualClock(realm, 0);
    let otherToken = sessionToken({
      realm: OTHER_REALM,
      expiresInSec: 24 * 60 * 60,
    });
    realm.getOrCreateRealmResource(OTHER_REALM, otherToken);
    let resource = realm.getOrCreateRealmResource(
      REALM,
      sessionToken({ expiresInSec: 24 * 60 * 60 }),
    );
    // Already subscribed, so signing back in fetches no realm info.
    (resource as any).subscription = { unsubscribe() {} };

    let newToken = await realm.reauthenticate(REALM);

    assert.deepEqual(
      mints,
      [REALM],
      'only the reauthenticated realm is minted',
    );
    assert.deepEqual(
      JSON.parse(window.localStorage.getItem(SessionLocalStorageKey)!),
      { [OTHER_REALM]: otherToken, [REALM]: newToken },
      'the other realm’s session is still stored',
    );
  });

  test('sessions minted for another Matrix user are dropped', function (assert) {
    virtualClock(realm, 0);
    let mine = sessionToken({ expiresInSec: 24 * 60 * 60 });
    let theirs = sessionToken({
      realm: OTHER_REALM,
      user: PREVIOUS_USER,
      expiresInSec: 24 * 60 * 60,
    });
    realm.getOrCreateRealmResource(REALM, mine);
    realm.getOrCreateRealmResource(OTHER_REALM, theirs);

    realm.dropSessionsNotFor(USER);

    assert.strictEqual(
      realm.token(`${REALM}card`),
      mine,
      'the signed-in user’s session stays',
    );
    assert.strictEqual(
      realm.token(`${OTHER_REALM}card`),
      undefined,
      'the previous account’s session is gone',
    );
    assert.deepEqual(
      JSON.parse(window.localStorage.getItem(SessionLocalStorageKey)!),
      { [REALM]: mine },
      'storage holds only the signed-in user’s session',
    );
  });
});
