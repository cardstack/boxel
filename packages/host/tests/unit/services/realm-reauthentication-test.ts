import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';

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

// A session token is only read for its claims here, never verified, so a
// header-and-payload pair is the whole shape that matters.
function sessionToken(): string {
  let now = Math.floor(Date.now() / 1000);
  return `header.${btoa(
    JSON.stringify({
      user: MEMBER,
      realm: REALM,
      permissions: ['read'],
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

// How a realm refuses a request it wants a session for.
function refused(): Response {
  return new Response(JSON.stringify({ errors: ['actor-required'] }), {
    status: 401,
    headers: { 'x-boxel-realm-url': REALM },
  });
}

module('Unit | Service | realm | reauthentication', function (hooks) {
  setupTest(hooks);
  setupWindowMock(hooks);

  let network: NetworkService;
  let mints: string[];
  let infoRequests: number;
  let originalConsoleError: typeof console.error;

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
    owner.lookup('service:realm') as RealmService;
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

  hooks.beforeEach(function () {
    mints = [];
    infoRequests = 0;
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

  test('a browser whose realm sign-in fails does not fetch realm info inside it, so its requests settle', async function (assert) {
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

    let second = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      second,
      { settled: true, status: 401 },
      `a later refused request settles with 401 too (${JSON.stringify(second)})`,
    );
    assert.deepEqual(
      mints,
      [REALM, REALM],
      'each refused request tries a fresh sign-in',
    );
    assert.strictEqual(
      infoRequests,
      0,
      'a failed sign-in fetches no realm info',
    );
  });

  test('a signed-in user whose new session the realm also refuses gets the 401, and so does the next request', async function (assert) {
    // The realm refuses the session it has just issued, as it does when the
    // user's permissions change between the sign-in and the request. Realm
    // info, which the sign-in fetches to subscribe, is refused with it.
    setup(this.owner, {
      isLoggedIn: true,
      persistedUserId: MEMBER,
      mint: sessionToken,
    });
    mountRealm(refused);

    let first = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      first,
      { settled: true, status: 401 },
      `the refused request settles with 401 (${JSON.stringify(first)})`,
    );

    let second = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      second,
      { settled: true, status: 401 },
      `a later refused request settles with 401 too (${JSON.stringify(second)})`,
    );
    assert.deepEqual(
      mints,
      [REALM, REALM],
      'each refused request signs in once',
    );
  });

  test('a sign-in whose realm info fails to load still replays the refused request with its new session', async function (assert) {
    setup(this.owner, {
      isLoggedIn: true,
      persistedUserId: MEMBER,
      mint: sessionToken,
    });
    // The realm serves the card to a session, but its realm info fails.
    mountRealm((request) => {
      if (!request.headers.get('Authorization')) {
        return refused();
      }
      if (request.url.startsWith(`${REALM}_info`)) {
        return new Response('realm info is unavailable', { status: 500 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    let outcome = await outcomeOf(network.authedFetch(`${REALM}card.json`));
    assert.deepEqual(
      outcome,
      { settled: true, status: 200 },
      `the request is served with the new session (${JSON.stringify(outcome)})`,
    );
    assert.deepEqual(mints, [REALM], 'the realm is signed in to once');
    assert.ok(infoRequests > 0, 'the sign-in asked for realm info');
  });
});
