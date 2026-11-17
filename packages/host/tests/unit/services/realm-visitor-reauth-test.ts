import Service from '@ember/service';

import { setupTest } from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';

const REALM = 'http://visitor-reauth.test/realm/';
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

module('Unit | Service | realm | visitor reauthentication', function (hooks) {
  setupTest(hooks);
  setupWindowMock(hooks);

  let network: NetworkService;
  let mints: string[];
  let infoRequests: number;
  let originalConsoleError: typeof console.error;

  // A realm that refuses every request without a session, `_info` included,
  // as a realm whose policy refuses some visitor requests does.
  function mountRefusingRealm() {
    network.mount(
      async (request: Request) => {
        if (!request.url.startsWith(REALM)) {
          // The realm server's own lists (catalog realms and the like) are
          // empty, so nothing here reaches the real network.
          return new Response(JSON.stringify({ data: [] }), {
            headers: { 'content-type': 'application/vnd.api+json' },
          });
        }
        if (request.url.startsWith(`${REALM}_info`)) {
          infoRequests++;
        }
        return new Response(JSON.stringify({ errors: ['actor-required'] }), {
          status: 401,
          headers: { 'x-boxel-realm-url': REALM },
        });
      },
      { prepend: true },
    );
  }

  function registerMatrix(
    owner: any,
    { persistedUserId }: { persistedUserId: string | undefined },
  ) {
    owner.register(
      'service:matrix-service',
      class extends Service {
        isLoggedIn = false;
        persistedUserId = persistedUserId;
        async createRealmSession(realmURL: URL) {
          mints.push(realmURL.href);
          throw new Error(
            'must be logged in to matrix before a realm session can be created',
          );
        }
      },
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
    registerMatrix(this.owner, { persistedUserId: undefined });
    network = this.owner.lookup('service:network') as NetworkService;
    this.owner.lookup('service:realm') as RealmService;
    mountRefusingRealm();

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
    registerMatrix(this.owner, { persistedUserId: '@visitor:localhost' });
    network = this.owner.lookup('service:network') as NetworkService;
    this.owner.lookup('service:realm') as RealmService;
    mountRefusingRealm();

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
});
