import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  DBRateLimitStore,
  type BudgetOutcome,
  type RateLimitStore,
  type TokenBucketOutcome,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import {
  applicationTypeFor,
  boxelHosts,
  isOnBoxelHost,
  redirectURIRefusal,
  redirectURIsRefusal,
} from '../lib/oauth-provider/redirect-uris.ts';
import {
  DEFAULT_NEW_CLIENT_LIMIT,
  NewClientAlert,
  parseNewClientLimit,
  takeNewClient,
  type NewClientOutcome,
} from '../lib/oauth-provider/new-client-limit.ts';
import {
  OAuthProviderConfigError,
  readNewClientLimit,
} from '../lib/oauth-provider/config.ts';

// The hosts a production deployment lists, as its settings spell them.
const hosts = boxelHosts({
  serverURL: new URL('https://app.boxel.ai/'),
  secureOriginURL: new URL('https://secure.boxel.ai/secure'),
  appOrigins: [
    'https://*.preview.boxel.ai',
    'https://localhost:*',
    'http://127.0.0.1:*',
  ],
  publishedDomains: ['boxel.site', 'boxel.space'],
});

module(basename(import.meta.filename), function () {
  module("Boxel's own hosts", function () {
    test('the realm server, the secure origin, app origins and published-site domains are Boxel hosts', function (assert) {
      for (let uri of [
        'https://app.boxel.ai/callback',
        'https://secure.boxel.ai/callback',
        'https://pr-12.preview.boxel.ai/callback',
        'https://preview.boxel.ai/callback',
        'https://boxel.site/callback',
        'https://example-user.boxel.site/callback',
        'https://x.y.boxel.space/callback',
      ]) {
        assert.true(isOnBoxelHost(new URL(uri), hosts), uri);
      }
    });

    test('another spelling of a Boxel host is still a Boxel host', function (assert) {
      for (let uri of [
        'https://APP.Boxel.AI/callback',
        'https://app.boxel.ai./callback',
        'https://app.boxel.ai:8443/callback',
        'https://anything@app.boxel.ai/callback',
        'https://example-user.boxel.site./callback',
      ]) {
        assert.true(isOnBoxelHost(new URL(uri), hosts), uri);
      }
    });

    test('a host that only resembles a Boxel host is not one', function (assert) {
      for (let uri of [
        'https://boxel.ai/callback',
        'https://other.boxel.ai/callback',
        'https://app.boxel.ai.example.com/callback',
        'https://notboxel.site/callback',
        'https://boxel.site.example.com/callback',
      ]) {
        assert.false(isOnBoxelHost(new URL(uri), hosts), uri);
      }
    });

    test('loopback is never a Boxel host, even where Boxel runs on it', function (assert) {
      let development = boxelHosts({
        serverURL: new URL('http://localhost:4201/'),
        secureOriginURL: new URL('https://localhost:4208/secure'),
        publishedDomains: ['localhost:4201'],
      });
      for (let uri of [
        'http://localhost:4201/callback',
        'http://localhost/callback',
        'http://127.0.0.1/callback',
        'http://[::1]/callback',
      ]) {
        assert.false(isOnBoxelHost(new URL(uri), development), uri);
      }
    });

    test('a setting that is not a host stops the server', function (assert) {
      assert.throws(
        () =>
          boxelHosts({
            serverURL: new URL('https://app.boxel.ai/'),
            appOrigins: ['not an origin'],
          }),
        /not an app origin/,
      );
      assert.throws(
        () =>
          boxelHosts({
            serverURL: new URL('https://app.boxel.ai/'),
            publishedDomains: ['boxel.site/path'],
          }),
        /not a published-site domain/,
      );
    });
  });

  module('redirect URIs', function () {
    test('HTTPS off Boxel hosts and plain HTTP on loopback are allowed', function (assert) {
      for (let uri of [
        'https://claude.ai/api/mcp/auth_callback',
        'https://example.com/callback?x=1',
        'http://localhost/callback',
        'http://localhost:53682/callback',
        'http://127.0.0.1/callback',
        'http://[::1]:8080/callback',
        'https://localhost/callback',
      ]) {
        assert.strictEqual(redirectURIRefusal(uri, hosts), undefined, uri);
      }
    });

    test('everything else is refused, saying why', function (assert) {
      let cases: [unknown, RegExp][] = [
        ['http://example.com/callback', /plain HTTP .* localhost/],
        ['http://127.0.0.2/callback', /plain HTTP .* localhost/],
        ['http://localhost./callback', /plain HTTP .* localhost/],
        ['cursor://anysphere.cursor-retrieval/callback', /must use https/],
        ['javascript:alert(1)', /must use https/],
        ['https://app.boxel.ai/callback', /Boxel's own hosts/],
        ['https://secure.boxel.ai/callback', /Boxel's own hosts/],
        ['https://example-user.boxel.site/callback', /Boxel's own hosts/],
        ['https://example.com/callback#frag', /fragment/],
        ['https://user:pass@example.com/callback', /user information/],
        ['/callback', /absolute URL/],
        [42, /must be a string/],
      ];
      for (let [uri, why] of cases) {
        let refusal = redirectURIRefusal(uri, hosts) ?? '(allowed)';
        assert.true(why.test(refusal), `${String(uri)}: ${refusal}`);
      }
    });

    test('a client with any plain HTTP loopback redirect is native', function (assert) {
      assert.strictEqual(
        applicationTypeFor([
          'http://localhost/callback',
          'http://127.0.0.1:9000/callback',
        ]),
        'native',
      );
      assert.strictEqual(
        applicationTypeFor([
          'http://localhost/callback',
          'https://example.com/callback',
        ]),
        'native',
        'so its loopback redirect matches on any port',
      );
      assert.strictEqual(
        applicationTypeFor(['https://example.com/callback']),
        'web',
      );
      assert.strictEqual(
        applicationTypeFor(['https://localhost/callback']),
        'web',
        'an HTTPS loopback redirect alone stays web, which the library allows',
      );
      assert.strictEqual(applicationTypeFor([]), 'web');
    });

    test('an HTTPS loopback redirect is refused beside a plain HTTP loopback one', function (assert) {
      assert.strictEqual(
        redirectURIsRefusal(
          ['http://127.0.0.1/callback', 'https://example.com/callback'],
          hosts,
        ),
        undefined,
      );
      assert.strictEqual(
        redirectURIsRefusal(['https://localhost/callback'], hosts),
        undefined,
      );
      let refusal =
        redirectURIsRefusal(
          ['http://127.0.0.1/callback', 'https://localhost/callback'],
          hosts,
        ) ?? '(allowed)';
      assert.true(/can't be listed beside/.test(refusal), refusal);
      let first =
        redirectURIsRefusal(
          ['http://127.0.0.1/callback', 'cursor://callback'],
          hosts,
        ) ?? '(allowed)';
      assert.true(/must use https/.test(first), `each is checked: ${first}`);
    });
  });

  module('the new-client limit', function () {
    test('reads named parts, each defaulting when left out', function (assert) {
      assert.deepEqual(
        parseNewClientLimit(
          'address=20/3600,network=100/3600,all=2000/3600,alert=500',
        ),
        DEFAULT_NEW_CLIENT_LIMIT,
      );
      assert.deepEqual(parseNewClientLimit(' all = 50/60 , alert = 10 '), {
        ...DEFAULT_NEW_CLIENT_LIMIT,
        overall: { requests: 50, windowSeconds: 60 },
        alertAfter: 10,
      });
      assert.deepEqual(parseNewClientLimit('network=5/60'), {
        ...DEFAULT_NEW_CLIENT_LIMIT,
        perNetwork: { requests: 5, windowSeconds: 60 },
      });
      for (let spec of [
        '20/3600,500/3600',
        'address=20/3600,',
        'address=20/3600,address=30/3600',
        'everyone=20/3600',
        'address=20',
        'address=0/60',
        'alert=0',
        'alert=1.5',
        'alert=x',
        'all=100/3600',
        'all=500/3600,alert=500',
        'address=20/3600=1',
      ]) {
        assert.strictEqual(parseNewClientLimit(spec), undefined, spec);
      }
    });

    test('defaults when unset, and stops the server when malformed', function (assert) {
      assert.deepEqual(readNewClientLimit({}), DEFAULT_NEW_CLIENT_LIMIT);
      assert.deepEqual(
        readNewClientLimit({
          BOXEL_OAUTH_CLIENT_RATE_LIMIT:
            'address=3/60,network=6/60,all=9/60,alert=4',
        }),
        {
          perAddress: { requests: 3, windowSeconds: 60 },
          perNetwork: { requests: 6, windowSeconds: 60 },
          overall: { requests: 9, windowSeconds: 60 },
          alertAfter: 4,
        },
      );
      assert.throws(
        () =>
          readNewClientLimit({
            BOXEL_OAUTH_CLIENT_RATE_LIMIT: '20/3600,500/3600',
          }),
        (error: unknown) =>
          error instanceof OAuthProviderConfigError &&
          /BOXEL_OAUTH_CLIENT_RATE_LIMIT must be named parts/.test(
            error.message,
          ),
      );
    });

    module('counting', function (hooks) {
      // Two per address, three per network, four in all, each refilling over
      // a minute. Busy after two.
      const LIMIT = {
        perAddress: { requests: 2, windowSeconds: 60 },
        perNetwork: { requests: 3, windowSeconds: 60 },
        overall: { requests: 4, windowSeconds: 60 },
        alertAfter: 2,
      };
      let nowMs: number;
      let store: DBRateLimitStore;

      setupDB(hooks, {
        beforeEach: async (dbAdapter: PgAdapter) => {
          nowMs = Date.UTC(2027, 0, 1);
          store = new DBRateLimitStore(dbAdapter, { now: () => nowMs });
        },
      });

      test('admits an address up to its limit, then says when to retry', async function (assert) {
        for (let i = 0; i < 2; i++) {
          assert.strictEqual(
            outcomeOf(await takeNewClient(store, '192.0.2.7', LIMIT)),
            'admitted',
          );
        }
        let refused = await takeNewClient(store, '192.0.2.7', LIMIT);
        assert.strictEqual(outcomeOf(refused), 'limited');
        assert.strictEqual(
          retryAfterOf(refused),
          30,
          'retry once one has refilled, every thirty seconds',
        );
        nowMs += 30_000;
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '192.0.2.7', LIMIT)),
          'admitted',
          'one refills every thirty seconds',
        );
      });

      test('the addresses of one network share its limit', async function (assert) {
        for (let address of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) {
          assert.strictEqual(
            outcomeOf(await takeNewClient(store, address, LIMIT)),
            'admitted',
            address,
          );
        }
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '192.0.2.4', LIMIT)),
          'limited',
          'a fourth address in the /24',
        );
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '198.51.100.1', LIMIT)),
          'admitted',
          'another /24',
        );
      });

      test('the /64s of one IPv6 /48 share its limit, and each /64 is one address', async function (assert) {
        await takeNewClient(store, '2001:db8:1:2::1', LIMIT);
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '2001:db8:1:2:ffff::9', LIMIT)),
          'admitted',
        );
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '2001:db8:1:2::abcd', LIMIT)),
          'limited',
          'a third address in the same /64 is the same caller',
        );
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '2001:db8:1:3::1', LIMIT)),
          'admitted',
          'another /64 is another address',
        );
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '2001:db8:1:4::1', LIMIT)),
          'limited',
          'but in the same /48, which has had three',
        );
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '2001:db8:2::1', LIMIT)),
          'admitted',
          'another /48',
        );
      });

      test('the overall limit refuses every network', async function (assert) {
        for (let address of [
          '192.0.2.1',
          '198.51.100.1',
          '203.0.113.1',
          '2001:db8:1::1',
        ]) {
          assert.strictEqual(
            outcomeOf(await takeNewClient(store, address, LIMIT)),
            'admitted',
            address,
          );
        }
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '2001:db8:2::1', LIMIT)),
          'limited',
        );
      });

      test('a refusal further on leaves what was taken before it spent', async function (assert) {
        // The address and network buckets refill over an hour, the overall
        // one over a minute, so whatever a refused attempt took from the
        // first two is still gone once the overall one has refilled.
        const SLOW = {
          ...LIMIT,
          perAddress: { requests: 2, windowSeconds: 3600 },
          perNetwork: { requests: 3, windowSeconds: 3600 },
        };
        for (let address of [
          '198.51.100.1',
          '203.0.113.1',
          '2001:db8:1::1',
          '2001:db8:2::1',
        ]) {
          await takeNewClient(store, address, SLOW);
        }
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '192.0.2.9', SLOW)),
          'limited',
          'refused overall',
        );
        nowMs += 60_000;
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '192.0.2.9', SLOW)),
          'admitted',
          'one left of its own two',
        );
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '192.0.2.9', SLOW)),
          'limited',
          'the refused attempt spent the other',
        );
      });

      test("a caller over its own limit doesn't spend its network's or the overall one", async function (assert) {
        for (let i = 0; i < 4; i++) {
          await takeNewClient(store, '192.0.2.7', LIMIT);
        }
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '192.0.2.8', LIMIT)),
          'admitted',
          'its network has had only two',
        );
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '198.51.100.1', LIMIT)),
          'admitted',
          'the overall limit has had only three',
        );
      });

      test('is busy once more than the alert mark is taken overall', async function (assert) {
        let busy = [];
        for (let address of [
          '192.0.2.1',
          '198.51.100.1',
          '203.0.113.1',
          '2001:db8:1::1',
        ]) {
          let outcome = await takeNewClient(store, address, LIMIT);
          busy.push(outcome.admitted && outcome.busy);
        }
        assert.deepEqual(busy, [false, false, true, true]);
      });

      test('refuses an address it cannot read', async function (assert) {
        for (let address of [undefined, '', 'not-an-ip']) {
          assert.deepEqual(await takeNewClient(store, address, LIMIT), {
            admitted: false,
            reason: 'unknown-address',
          });
        }
      });
    });

    test('refuses when the store cannot be read', async function (assert) {
      assert.deepEqual(
        await takeNewClient(
          new UnavailableStore(),
          '192.0.2.7',
          DEFAULT_NEW_CLIENT_LIMIT,
        ),
        { admitted: false, reason: 'unavailable' },
      );
    });

    test('warns while busy, at most once a minute, with no detail of who', function (assert) {
      let nowMs = 0;
      let warnings: string[] = [];
      let alert = new NewClientAlert(DEFAULT_NEW_CLIENT_LIMIT, {
        now: () => nowMs,
        warn: (message) => warnings.push(message),
      });
      alert.note({ admitted: true, busy: false });
      alert.note({ admitted: false, reason: 'limited', retryAfterSeconds: 9 });
      assert.strictEqual(warnings.length, 0, 'not busy, or refused');

      alert.note({ admitted: true, busy: true });
      nowMs += 59_999;
      alert.note({ admitted: true, busy: true });
      assert.deepEqual(warnings, [
        'more than 500 new OAuth clients within 3600 seconds; registration is refused for everyone at 2000',
      ]);
      nowMs += 1;
      alert.note({ admitted: true, busy: true });
      assert.strictEqual(warnings.length, 2, 'again a minute later');
    });
  });
});

function outcomeOf(outcome: NewClientOutcome): string {
  return outcome.admitted ? 'admitted' : outcome.reason;
}

function retryAfterOf(outcome: NewClientOutcome): number {
  return !outcome.admitted && outcome.reason === 'limited'
    ? outcome.retryAfterSeconds
    : NaN;
}

// A store that can't be reached, as `DBRateLimitStore` answers when its
// database is down. Only that answer is hard to bring about for real.
class UnavailableStore implements RateLimitStore {
  async take(): Promise<TokenBucketOutcome> {
    return { admitted: false, unavailable: true };
  }
  async peek(): Promise<TokenBucketOutcome> {
    return { admitted: false, unavailable: true };
  }
  async spend(): Promise<BudgetOutcome> {
    return { admitted: false, unavailable: true };
  }
  async budget(): Promise<BudgetOutcome> {
    return { admitted: false, unavailable: true };
  }
  async refund(): Promise<boolean> {
    return false;
  }
  async unspend(): Promise<boolean> {
    return false;
  }
}
