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
} from '../lib/oauth-provider/redirect-uris.ts';
import {
  DEFAULT_NEW_CLIENT_LIMIT,
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

    test('a client is native exactly when every redirect URI is plain HTTP on loopback', function (assert) {
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
        'web',
      );
      assert.strictEqual(
        applicationTypeFor(['https://localhost/callback']),
        'web',
        'an HTTPS loopback redirect stays web, which the library allows',
      );
      assert.strictEqual(applicationTypeFor([]), 'web');
    });
  });

  module('the new-client limit', function () {
    test('reads two limits, per address and overall', function (assert) {
      assert.deepEqual(parseNewClientLimit('20/3600,500/3600'), {
        perAddress: { requests: 20, windowSeconds: 3600 },
        overall: { requests: 500, windowSeconds: 3600 },
      });
      assert.deepEqual(parseNewClientLimit(' 2/60 , 5/60 '), {
        perAddress: { requests: 2, windowSeconds: 60 },
        overall: { requests: 5, windowSeconds: 60 },
      });
      for (let spec of [
        '20/3600',
        '20/3600,500/3600,1/1',
        '20,500',
        '0/60,5/60',
      ]) {
        assert.strictEqual(parseNewClientLimit(spec), undefined, spec);
      }
    });

    test('defaults when unset, and stops the server when malformed', function (assert) {
      assert.deepEqual(readNewClientLimit({}), DEFAULT_NEW_CLIENT_LIMIT);
      assert.deepEqual(
        readNewClientLimit({ BOXEL_OAUTH_CLIENT_RATE_LIMIT: '3/60,9/60' }),
        {
          perAddress: { requests: 3, windowSeconds: 60 },
          overall: { requests: 9, windowSeconds: 60 },
        },
      );
      assert.throws(
        () => readNewClientLimit({ BOXEL_OAUTH_CLIENT_RATE_LIMIT: '20/3600' }),
        (error: unknown) =>
          error instanceof OAuthProviderConfigError &&
          /BOXEL_OAUTH_CLIENT_RATE_LIMIT must be two limits/.test(
            error.message,
          ),
      );
    });

    module('counting', function (hooks) {
      // Two per address, three in all, each refilling over a minute.
      const LIMIT = {
        perAddress: { requests: 2, windowSeconds: 60 },
        overall: { requests: 3, windowSeconds: 60 },
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
          assert.deepEqual(await takeNewClient(store, '192.0.2.7', LIMIT), {
            admitted: true,
          });
        }
        let refused = await takeNewClient(store, '192.0.2.7', LIMIT);
        assert.strictEqual(outcomeOf(refused), 'limited');
        let retryAfter = retryAfterOf(refused);
        assert.strictEqual(
          retryAfter,
          30,
          'retry once one has refilled, every thirty seconds',
        );
        nowMs += 30_000;
        assert.deepEqual(
          await takeNewClient(store, '192.0.2.7', LIMIT),
          { admitted: true },
          'one refills every thirty seconds',
        );
      });

      test('the overall limit refuses every address', async function (assert) {
        for (let address of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) {
          assert.deepEqual(await takeNewClient(store, address, LIMIT), {
            admitted: true,
          });
        }
        assert.strictEqual(
          outcomeOf(await takeNewClient(store, '192.0.2.4', LIMIT)),
          'limited',
        );
      });

      test("a caller over its own limit doesn't spend the overall one", async function (assert) {
        for (let i = 0; i < 4; i++) {
          await takeNewClient(store, '192.0.2.7', LIMIT);
        }
        assert.deepEqual(
          await takeNewClient(store, '192.0.2.8', LIMIT),
          { admitted: true },
          'only the first two counted overall',
        );
      });

      test('counts an IPv6 caller by its /64', async function (assert) {
        await takeNewClient(store, '2001:db8:1:2::1', LIMIT);
        await takeNewClient(store, '2001:db8:1:2:ffff::9', LIMIT);
        let sameBlock = await takeNewClient(store, '2001:db8:1:2::abcd', LIMIT);
        assert.strictEqual(
          outcomeOf(sameBlock),
          'limited',
          'a third address in the same /64 is the same caller',
        );
        assert.deepEqual(
          await takeNewClient(store, '2001:db8:1:3::1', LIMIT),
          { admitted: true },
          'the next /64 is another caller',
        );
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
