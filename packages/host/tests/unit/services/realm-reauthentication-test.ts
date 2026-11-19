import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';
import { signInCooldownSec } from '@cardstack/host/services/realm';

const REALM = 'http://reauthentication.test/realm/';
const MEMBER = '@member:localhost';
const SETTLE_MS = 2000;

type Outcome =
  | { settled: true; status: number }
  | { settled: true; error: string }
  | { settled: false };

// Whether a request settles, either way, within a bound. A sign-in that waits
// on itself leaves the request pending forever, so the bound is what tells
// the two apart.
async function outcomeOf(request: Promise<Response>): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), SETTLE_MS);
  });
  try {
    return await Promise.race([
      request.then(
        (response): Outcome => ({ settled: true, status: response.status }),
        (error): Outcome => ({ settled: true, error: String(error) }),
      ),
      pending,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Whether a request failed because its sign-in was refused the realm's info.
function failedOnRealmInfo(outcome: Outcome): boolean {
  return 'error' in outcome && /Failed to fetch realm info/.test(outcome.error);
}

// How a realm refuses a request it wants a session for.
function refused(): Response {
  return new Response(JSON.stringify({ errors: ['actor-required'] }), {
    status: 401,
    headers: { 'x-boxel-realm-url': REALM },
  });
}

function realmInfo(): Response {
  return new Response(
    JSON.stringify({
      data: { id: REALM, type: 'realm-info', attributes: { name: 'Realm' } },
    }),
    { status: 200 },
  );
}

module('Unit | Service | realm | reauthentication', function (hooks) {
  setupTest(hooks);
  setupWindowMock(hooks);

  let network: NetworkService;
  let realm: RealmService;
  let mints: string[];
  let infoRequests: number;
  let clockMs: number;
  let originalConsoleError: typeof console.error;

  // A session token is only read for its claims here, never verified, so a
  // header-and-payload pair is the whole shape that matters. Each mint is a
  // different session.
  function sessionToken(): string {
    let now = Math.floor(Date.now() / 1000);
    return `header.${btoa(
      JSON.stringify({
        user: MEMBER,
        realm: REALM,
        permissions: ['read'],
        mint: mints.length,
        iat: now,
        exp: now + 24 * 60 * 60,
      }),
    )}`;
  }

  function failedMint(): string {
    throw new Error(
      'must be logged in to matrix before a realm session can be created',
    );
  }

  function setup(
    owner: any,
    {
      isLoggedIn,
      persistedUserId,
      mint,
    }: {
      isLoggedIn: boolean;
      persistedUserId?: string;
      mint: () => string;
    },
  ) {
    owner.register(
      'service:matrix-service',
      class extends Service {
        isLoggedIn = isLoggedIn;
        persistedUserId = persistedUserId;
        async createRealmSession(realmURL: URL) {
          mints.push(realmURL.href);
          return mint();
        }
      },
    );
    network = owner.lookup('service:network') as NetworkService;
    realm = owner.lookup('service:realm') as RealmService;
    realm.signInCooldownClock = () => clockMs;
    // Sessions here last a day; their refresh never comes due in a test.
    realm.waitForTokenRefresh = () => new Promise<void>(() => {});
  }

  // Answers the realm's requests with `respond`. The realm server's own lists
  // (catalog realms and the like) are empty, so nothing here reaches the real
  // network.
  function mountRealm(respond: (request: Request) => Response) {
    network.mount(
      async (request: Request) => {
        if (!request.url.startsWith(REALM)) {
          return new Response(JSON.stringify({ data: [] }), {
            headers: { 'content-type': 'application/vnd.api+json' },
          });
        }
        if (request.url.startsWith(`${REALM}_info`)) {
          infoRequests++;
        }
        return respond(request);
      },
      { prepend: true },
    );
  }

  function passCooldown() {
    clockMs += signInCooldownSec * 1000;
  }

  hooks.beforeEach(function () {
    mints = [];
    infoRequests = 0;
    clockMs = 1_000_000;
    originalConsoleError = console.error;
    // The failed sign-in is logged; that is expected here.
    console.error = () => {};
  });

  hooks.afterEach(function () {
    console.error = originalConsoleError;
  });

  test('a signed-out visitor’s refused request settles with its 401, and so does the next', async function (assert) {
    setup(this.owner, { isLoggedIn: false, mint: failedMint });
    // A realm that refuses every request without a session, `_info`
    // included, as a realm whose policy refuses some visitor requests does.
    mountRealm(refused);

    let first = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      first,
      { settled: true, status: 401 },
      `the first refused request settles with 401 (${JSON.stringify(first)})`,
    );

    let second = await outcomeOf(
      network.authedFetch(`${REALM}_search`, { method: 'QUERY', body: '{}' }),
    );
    assert.deepEqual(
      second,
      { settled: true, status: 401 },
      `a later refused request settles with 401 too (${JSON.stringify(second)})`,
    );
    assert.deepEqual(mints, [], 'no realm session is asked for');
  });

  test('a browser whose realm sign-in fails does not fetch realm info inside it, and waits out the cooldown before signing in again', async function (assert) {
    // Persisted Matrix auth, so the sign-in is tried, and it fails.
    setup(this.owner, {
      isLoggedIn: false,
      persistedUserId: '@visitor:localhost',
      mint: failedMint,
    });
    mountRealm(refused);

    let first = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      first,
      { settled: true, status: 401 },
      `the refused request settles with 401 (${JSON.stringify(first)})`,
    );
    assert.deepEqual(mints, [REALM], 'it signs in once');
    assert.strictEqual(
      infoRequests,
      0,
      'a failed sign-in fetches no realm info',
    );

    let second = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      second,
      { settled: true, status: 401 },
      `a refused request in the cooldown settles with 401 (${JSON.stringify(second)})`,
    );
    assert.deepEqual(mints, [REALM], 'without signing in again');

    passCooldown();
    let third = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      third,
      { settled: true, status: 401 },
      `a refused request after the cooldown settles with 401 (${JSON.stringify(third)})`,
    );
    assert.deepEqual(mints, [REALM, REALM], 'after signing in again');
  });

  test('a signed-in user whose new sessions the realm also refuses: the sign-in fails, one more is tried, then the 401 stands', async function (assert) {
    // The realm refuses each session it has just issued, realm info
    // included, as it does when the user's permissions don't match the
    // session's.
    setup(this.owner, {
      isLoggedIn: true,
      persistedUserId: MEMBER,
      mint: sessionToken,
    });
    mountRealm(refused);

    let first = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.true(
      failedOnRealmInfo(first),
      `the request settles: its sign-in fails on the realm info it was refused (${JSON.stringify(first)})`,
    );
    assert.deepEqual(mints, [REALM], 'the realm is signed in to once');

    let second = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.true(
      failedOnRealmInfo(second),
      `a request refused with that new session gets one more sign-in, which fails the same way (${JSON.stringify(second)})`,
    );
    assert.deepEqual(mints, [REALM, REALM], 'the realm is signed in to again');

    let third = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      third,
      { settled: true, status: 401 },
      `a request refused with the second new session keeps its 401 (${JSON.stringify(third)})`,
    );
    assert.deepEqual(mints, [REALM, REALM], 'without signing in again');
  });

  test('a session refused right after it was minted signs in once more, as when the user’s permissions just changed', async function (assert) {
    let issued: string[] = [];
    setup(this.owner, {
      isLoggedIn: true,
      persistedUserId: MEMBER,
      mint: () => {
        let session = sessionToken();
        issued.push(session);
        return session;
      },
    });
    // The realm accepts the sessions issued since the user's permissions
    // last changed, and refuses the rest.
    let acceptedFrom = 0;
    mountRealm((request) => {
      let session = request.headers.get('Authorization');
      if (!session || issued.indexOf(session) < acceptedFrom) {
        return refused();
      }
      if (request.url.startsWith(`${REALM}_info`)) {
        return realmInfo();
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    let first = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      first,
      { settled: true, status: 200 },
      `the request is served with the new session (${JSON.stringify(first)})`,
    );

    // The user's permissions change, so the realm refuses the session it has
    // just issued.
    acceptedFrom = issued.length;

    let second = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      second,
      { settled: true, status: 200 },
      `the refused request is served after one more sign-in (${JSON.stringify(second)})`,
    );
    assert.deepEqual(mints, [REALM, REALM], 'the realm is signed in to twice');
  });

  test('a request refused with a session the realm has since replaced replays with the current one, without signing in', async function (assert) {
    setup(this.owner, {
      isLoggedIn: true,
      persistedUserId: MEMBER,
      mint: sessionToken,
    });
    let current = sessionToken();
    realm.getOrCreateRealmResource(REALM, current);

    assert.strictEqual(
      await realm.reauthenticate(REALM, { token: 'an-earlier-session' }),
      current,
      'the request replays with the realm’s current session',
    );
    assert.strictEqual(
      await realm.reauthenticate(REALM, { token: undefined }),
      current,
      'as does one sent before the realm had a session',
    );
    assert.deepEqual(mints, [], 'no realm session is asked for');
  });

  test('a sign-in tried on purpose is not held to the cooldown', async function (assert) {
    setup(this.owner, {
      isLoggedIn: false,
      persistedUserId: '@visitor:localhost',
      mint: failedMint,
    });
    mountRealm(refused);

    await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(mints, [REALM], 'the refused request signs in once');

    assert.strictEqual(
      await realm.reauthenticate(REALM),
      undefined,
      'a caller signing in on purpose is told it failed',
    );
    assert.deepEqual(mints, [REALM, REALM], 'after signing in again');
  });

  test('the cooldown ends when a Matrix session starts', async function (assert) {
    setup(this.owner, {
      isLoggedIn: false,
      persistedUserId: '@visitor:localhost',
      mint: failedMint,
    });
    mountRealm(refused);

    await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(mints, [REALM], 'the refused request signs in once');

    realm.sessionStarted();
    await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      mints,
      [REALM, REALM],
      'a refused request signs in again once the session has started',
    );
  });
});
