import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import {
  minTokenRefreshIntervalSec,
  tokenRefreshPeriodSec,
} from '@cardstack/host/lib/token-refresh-schedule';
import type { ExtendedClient } from '@cardstack/host/services/matrix-sdk-loader';
import type RealmServerService from '@cardstack/host/services/realm-server';
import { RealmServerSessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

const USER = '@server-refresh-user:localhost';
const SESSION_ROOM = '!server-session-room:localhost';

// A session token is only read for its claims here, never verified, so a
// header-and-payload pair is the whole shape that matters.
function serverSessionToken(expiresInSec: number): string {
  let now = Math.floor(Date.now() / 1000);
  return `header.${btoa(
    JSON.stringify({
      user: USER,
      sessionRoom: SESSION_ROOM,
      iat: now,
      exp: now + expiresInSec,
    }),
  )}`;
}

// Runs the refresher against a virtual clock. Each wait it asks for passes at
// once while it fits in `budgetMs`; the first that doesn't is recorded and
// never passes, which stops the refresher there.
function virtualClock(realmServer: RealmServerService, budgetMs: number) {
  let waits: number[] = [];
  let elapsed = 0;
  let resolveExhausted: () => void;
  let exhausted = new Promise<void>((r) => (resolveExhausted = r));
  realmServer.waitForTokenRefresh = (ms: number) => {
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

// Just enough of a Matrix client for `RealmAuthClient` to mint a realm-server
// session: an OpenID token, and a session room it has already joined.
const matrixClient = {
  isLoggedIn: () => true,
  getUserId: () => USER,
  getOpenIdToken: async () => ({
    access_token: 'openid-token',
    expires_in: 3600,
    matrix_server_name: 'localhost',
    token_type: 'Bearer',
  }),
  getJoinedRooms: async () => ({ joined_rooms: [SESSION_ROOM] }),
} as unknown as ExtendedClient;

module('Unit | Service | realm-server | token refresh', function (hooks) {
  setupTest(hooks);
  setupWindowMock(hooks);

  let realmServer: RealmServerService;
  let mints: number;
  let nextMint: () => string;
  let errors: string[];
  let originalConsoleError: typeof console.error;

  hooks.beforeEach(function () {
    mints = 0;
    errors = [];
    nextMint = () => serverSessionToken(24 * 60 * 60);
    this.owner.register(
      'service:network',
      class extends Service {
        async fetch() {
          return new Response(JSON.stringify({ data: [] }));
        }
        async authedFetch(url: string) {
          if (!url.endsWith('/_server-session')) {
            return new Response(null, { status: 404 });
          }
          mints++;
          return new Response(null, {
            status: 201,
            headers: { Authorization: nextMint() },
          });
        }
      },
    );
    realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
  });

  hooks.afterEach(function () {
    console.error = originalConsoleError;
  });

  test('a session that arrives too close to expiry is minted at most twice in a minute', async function (assert) {
    // A realm server that hands out sessions already inside the refresh
    // period, every time.
    nextMint = () => serverSessionToken(tokenRefreshPeriodSec);
    let { waits, exhausted } = virtualClock(realmServer, 60 * 1000);
    realmServer.setClient(matrixClient);
    await realmServer.login();
    await exhausted;

    assert.strictEqual(
      mints,
      2,
      'the unusable session is minted once more in the minute, not again at once',
    );
    assert.deepEqual(
      waits,
      [minTokenRefreshIntervalSec * 1000, minTokenRefreshIntervalSec * 2000],
      'each unusable mint doubles the wait before the next',
    );
    assert.strictEqual(errors.length, 2, 'each unusable mint is reported');
    assert.ok(
      errors[0].includes('too soon to schedule a refresh'),
      `the report says the session could not be scheduled (${errors[0]})`,
    );
    assert.ok(
      errors[0].includes(realmServer.url.href),
      'the report names the realm server that minted the session',
    );
  });

  test('a stored session already inside the refresh period is minted again at once', async function (assert) {
    window.localStorage.setItem(
      RealmServerSessionLocalStorageKey,
      serverSessionToken(10),
    );
    let { waits, exhausted } = virtualClock(realmServer, 60 * 1000);
    realmServer.setClient(matrixClient);
    await exhausted;

    assert.strictEqual(mints, 1, 'the stored session is replaced once');
    assert.strictEqual(waits[0], 0, 'the stored session is replaced at once');
    assert.ok(
      waits[1] > 23 * 60 * 60 * 1000,
      `its replacement is refreshed shortly before it expires (${waits[1]}ms)`,
    );
    assert.strictEqual(errors.length, 0, 'nothing is reported');
  });
});
