import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import Koa from 'koa';
import cors from '@koa/cors';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import { randomBytes } from 'crypto';
import {
  DBRateLimitStore,
  type BudgetOutcome,
  type DBAdapter,
  type RateLimitStore,
  type TokenBucketOutcome,
} from '@cardstack/runtime-common';
import { insertUser, setupDB } from './helpers/index.ts';
import { logLinesDuring } from './helpers/log-capture.ts';
import { oauthEvents } from './helpers/oauth-provider-events.ts';
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
  readTokenLimit,
  readUnconnectedClientCap,
} from '../lib/oauth-provider/config.ts';
import {
  DEFAULT_UNCONNECTED_CLIENT_CAP,
  UnconnectedClientAlert,
  UnconnectedClientCap,
  checkUnconnectedClientCap,
  parseUnconnectedClientCap,
  unconnectedClientCapWarning,
} from '../lib/oauth-provider/unconnected-client-cap.ts';
import { longestOAuthProviderCleanupGapSeconds } from '../lib/oauth-provider-cleanup-config.ts';
import { newDynamicClientId } from '../lib/oauth-provider/dynamic-client-id.ts';
import {
  DEFAULT_TOKEN_LIMIT,
  parseTokenLimit,
} from '../lib/oauth-provider/token-limit.ts';
import { leaveCORSToOAuthProvider } from '../lib/oauth-provider/serve.ts';

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

const DAY_SECONDS = 24 * 60 * 60;

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

  module('the token limit', function () {
    test('reads named parts, each defaulting when left out', function (assert) {
      assert.deepEqual(
        parseTokenLimit(
          'grant=60/3600,address=60/600,network=300/600,all=3000/600,alert=1500',
        ),
        DEFAULT_TOKEN_LIMIT,
      );
      assert.deepEqual(parseTokenLimit(' grant = 10/60 '), {
        ...DEFAULT_TOKEN_LIMIT,
        perGrant: { requests: 10, windowSeconds: 60 },
      });
      assert.deepEqual(parseTokenLimit('network=50/60,grant=10/60'), {
        perGrant: { requests: 10, windowSeconds: 60 },
        failures: {
          ...DEFAULT_TOKEN_LIMIT.failures,
          perNetwork: { requests: 50, windowSeconds: 60 },
        },
      });
      for (let spec of [
        '60/3600,60/600',
        'grant=60/3600,',
        'grant=60/3600,grant=30/3600',
        'failures=60/600',
        'everyone=20/3600',
        'grant=20',
        'grant=0/60',
        'grant=20/3600=1',
        'all=100/600,alert=100',
      ]) {
        assert.strictEqual(parseTokenLimit(spec), undefined, spec);
      }
    });

    test('defaults when unset, and stops the server when malformed', function (assert) {
      assert.deepEqual(readTokenLimit({}), DEFAULT_TOKEN_LIMIT);
      assert.deepEqual(
        readTokenLimit({
          BOXEL_OAUTH_TOKEN_RATE_LIMIT: 'grant=3/60,address=6/60',
        }),
        {
          perGrant: { requests: 3, windowSeconds: 60 },
          failures: {
            ...DEFAULT_TOKEN_LIMIT.failures,
            perAddress: { requests: 6, windowSeconds: 60 },
          },
        },
      );
      assert.throws(
        () => readTokenLimit({ BOXEL_OAUTH_TOKEN_RATE_LIMIT: '60/3600' }),
        (error: unknown) =>
          error instanceof OAuthProviderConfigError &&
          /BOXEL_OAUTH_TOKEN_RATE_LIMIT must be named parts/.test(
            error.message,
          ),
      );
    });
  });

  module(
    "the realm server's CORS on the token and revocation paths",
    function () {
      const issuer = 'https://app.boxel.ai/';
      const paths = [
        '/_oauth-provider/token',
        '/_oauth-provider/token/revocation',
      ];

      function corsOn(
        method: 'get' | 'post' | 'options',
        host: string,
        issuerOrNone: string | undefined,
        path: string,
      ) {
        let app = new Koa()
          .use(leaveCORSToOAuthProvider(cors({ origin: '*' }), issuerOrNone))
          .use((ctxt) => {
            ctxt.status = 204;
          });
        let request = supertest(app.callback())
          [method](path)
          .set('Host', host)
          .set('Origin', 'https://elsewhere.example.test');
        if (method === 'options') {
          request = request.set('Access-Control-Request-Method', 'POST');
        }
        return request;
      }

      test('it is left to the provider for each POST and its preflight on the issuer host', async function (assert) {
        for (let path of paths) {
          for (let method of ['post', 'options'] as const) {
            let response = await corsOn(method, 'app.boxel.ai', issuer, path);
            assert.strictEqual(
              response.headers['access-control-allow-origin'],
              undefined,
              `${method} ${path}`,
            );
          }
        }
      });

      test('it stays on every request the provider does not serve', async function (assert) {
        for (let [label, method, host, issuerOrNone] of [
          ['the provider is off', 'post', 'app.boxel.ai', undefined],
          ['another host', 'post', 'site.boxel.site', issuer],
          ['another method', 'get', 'app.boxel.ai', issuer],
        ] as const) {
          for (let path of paths) {
            let response = await corsOn(method, host, issuerOrNone, path);
            assert.strictEqual(
              response.headers['access-control-allow-origin'],
              '*',
              `${label}: ${path}`,
            );
          }
        }
      });
    },
  );

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

    test('its warning is a rate-limit-alert event carrying the sentence', async function (assert) {
      let lines = await logLinesDuring(['boxel:oauth-provider'], async () => {
        new NewClientAlert(DEFAULT_NEW_CLIENT_LIMIT).note({
          admitted: true,
          busy: true,
        });
      });
      assert.deepEqual(oauthEvents(lines), [
        {
          channel: 'boxel:oauth-provider',
          event: 'rate-limit-alert',
          message:
            'more than 500 new OAuth clients within 3600 seconds; registration is refused for everyone at 2000',
        },
      ]);
      assert.deepEqual(
        lines.map(({ level }) => level),
        ['warn'],
        'at warn',
      );
    });
  });

  module('the never-connected client cap', function () {
    test('parses a whole number of clients, at least one', function (assert) {
      assert.strictEqual(parseUnconnectedClientCap('1'), 1);
      assert.strictEqual(parseUnconnectedClientCap('500000'), 500_000);
      for (let spec of [
        '0',
        '-5',
        '1.5',
        '1e6',
        '01',
        'x',
        '',
        '99999999999999999999',
      ]) {
        assert.strictEqual(parseUnconnectedClientCap(spec), undefined, spec);
      }
    });

    test('defaults when unset, and stops the server when malformed', function (assert) {
      assert.strictEqual(
        readUnconnectedClientCap({}),
        DEFAULT_UNCONNECTED_CLIENT_CAP,
      );
      assert.strictEqual(
        readUnconnectedClientCap({
          BOXEL_OAUTH_UNCONNECTED_CLIENT_CAP: ' 1000 ',
        }),
        1000,
      );
      assert.throws(
        () =>
          readUnconnectedClientCap({
            BOXEL_OAUTH_UNCONNECTED_CLIENT_CAP: '50k',
          }),
        (error: unknown) =>
          error instanceof OAuthProviderConfigError &&
          /BOXEL_OAUTH_UNCONNECTED_CLIENT_CAP must be a whole number/.test(
            error.message,
          ),
      );
    });

    test('by default sits above what the new-client limit can register while the cleanup keeps a client', function (assert) {
      // Daily, in a time zone whose clock change makes one gap 25 hours: the
      // gap counts that hour whether or not the next week holds the change.
      let gap = longestOAuthProviderCleanupGapSeconds();
      assert.true(gap >= DAY_SECONDS + 3600, `${gap} counts the 25-hour gap`);
      assert.true(gap <= DAY_SECONDS + 2 * 3600, `${gap} is about a day`);
      assert.strictEqual(
        unconnectedClientCapWarning(
          DEFAULT_UNCONNECTED_CLIENT_CAP,
          DEFAULT_NEW_CLIENT_LIMIT,
          longestOAuthProviderCleanupGapSeconds(),
        ),
        undefined,
      );
    });

    test('warns when a raised limit or a sparser cleanup lets a flood within the limit fill the cap', function (assert) {
      let raised = {
        ...DEFAULT_NEW_CLIENT_LIMIT,
        overall: { requests: 3000, windowSeconds: 3600 },
      };
      assert.strictEqual(
        unconnectedClientCapWarning(
          DEFAULT_UNCONNECTED_CLIENT_CAP,
          raised,
          DAY_SECONDS,
        ),
        'BOXEL_OAUTH_UNCONNECTED_CLIENT_CAP is 500000, but the new-client limit can register 579000 OAuth clients while the cleanup keeps one that never connected: a flood within the limit can fill the cap and refuse registration for everyone',
      );
      assert.notStrictEqual(
        unconnectedClientCapWarning(
          DEFAULT_UNCONNECTED_CLIENT_CAP,
          DEFAULT_NEW_CLIENT_LIMIT,
          7 * DAY_SECONDS,
        ),
        undefined,
        'a weekly cleanup',
      );
    });

    module('counting', function (hooks) {
      let dbAdapter: PgAdapter;
      let userId: string;

      setupDB(hooks, {
        beforeEach: async (_dbAdapter: PgAdapter) => {
          dbAdapter = _dbAdapter;
          let matrixId = `@cap-${randomBytes(6).toString('hex')}:localhost`;
          ({ id: userId } = await insertUser(
            dbAdapter,
            matrixId,
            `cus_${matrixId}`,
            null,
          ));
        },
      });

      async function insertClient({
        connected = false,
      }: { connected?: boolean } = {}): Promise<string> {
        let clientId = newDynamicClientId();
        await dbAdapter.execute(
          `INSERT INTO oauth_provider_dynamic_clients
             (client_id, metadata, last_connected_at)
             VALUES ($1, '{}'::jsonb, CASE WHEN $2::boolean THEN now() END)`,
          { bind: [clientId, connected] },
        );
        return clientId;
      }

      async function insertGrant(
        clientId: string,
        { exchanged }: { exchanged: boolean },
      ): Promise<string> {
        let id = randomBytes(32).toString('base64url');
        await dbAdapter.execute(
          `INSERT INTO oauth_provider_grants
             (id, user_id, client_id, resources, renewing, created_at,
              expires_at, exchanged_at)
             VALUES ($1, $2, $3, '{}'::jsonb, true, now(),
                     now() + interval '30 days',
                     CASE WHEN $4::boolean THEN now() END)`,
          { bind: [id, userId, clientId, exchanged] },
        );
        return id;
      }

      test('admits below the cap, busy past four fifths of it, and refuses at it', async function (assert) {
        let outcomes = [];
        for (let i = 0; i < 5; i++) {
          outcomes.push(await checkUnconnectedClientCap(dbAdapter, 5));
          await insertClient();
        }
        outcomes.push(await checkUnconnectedClientCap(dbAdapter, 5));
        assert.deepEqual(outcomes, [
          { admitted: true, busy: false },
          { admitted: true, busy: false },
          { admitted: true, busy: false },
          { admitted: true, busy: false },
          { admitted: true, busy: true },
          { admitted: false, reason: 'full' },
        ]);
      });

      async function insertClients(count: number): Promise<void> {
        for (let i = 0; i < count; i++) {
          await insertClient();
        }
      }

      test('a process reuses a count below the alert mark for up to a minute', async function (assert) {
        let nowMs = 0;
        // Ten kept, busy past eight.
        let cap = new UnconnectedClientCap(dbAdapter, 10, {
          now: () => nowMs,
        });
        let outcomes = [await cap.check()];
        // Registered through other processes, unseen until it counts again.
        await insertClients(8);
        outcomes.push(await cap.check());
        nowMs += 59_999;
        outcomes.push(await cap.check());
        nowMs += 1;
        outcomes.push(await cap.check());
        assert.deepEqual(outcomes, [
          { admitted: true, busy: false },
          { admitted: true, busy: false },
          { admitted: true, busy: false },
          { admitted: true, busy: true },
        ]);
      });

      test('a process counts every time past the alert mark', async function (assert) {
        let nowMs = 0;
        let cap = new UnconnectedClientCap(dbAdapter, 10, {
          now: () => nowMs,
        });
        await insertClients(8);
        let outcomes = [await cap.check(), await cap.check()];
        // Registered through other processes, seen at once.
        await insertClients(2);
        outcomes.push(await cap.check());
        assert.deepEqual(outcomes, [
          { admitted: true, busy: true },
          { admitted: true, busy: true },
          { admitted: false, reason: 'full' },
        ]);
      });

      test('counts only clients that never connected', async function (assert) {
        // Connected, by its own mark.
        await insertClient({ connected: true });
        // Connected by an exchanged grant.
        await insertGrant(await insertClient(), { exchanged: true });
        // Connected by a grant a realm server on the previous revision
        // stored tokens for without marking the exchange.
        let grantId = await insertGrant(await insertClient(), {
          exchanged: false,
        });
        await dbAdapter.execute(
          `INSERT INTO oauth_provider_tokens
             (id_hash, kind, grant_id, scope, payload, expires_at, rotation)
             VALUES (decode(md5(random()::text), 'hex'), 'RefreshToken', $1,
                     '', '{}'::jsonb, now() + interval '30 days', 0)`,
          { bind: [grantId] },
        );
        assert.deepEqual(
          await checkUnconnectedClientCap(dbAdapter, 1),
          { admitted: true, busy: true },
          'none of those counts',
        );

        // A grant the user approved but whose code was never exchanged
        // connected nothing.
        await insertGrant(await insertClient(), { exchanged: false });
        assert.deepEqual(await checkUnconnectedClientCap(dbAdapter, 1), {
          admitted: false,
          reason: 'full',
        });
      });
    });

    test('refuses when the count cannot be read', async function (assert) {
      let unreachable = {
        execute: async () => {
          throw new Error('connection refused');
        },
      } as unknown as DBAdapter;
      assert.deepEqual(await checkUnconnectedClientCap(unreachable, 5), {
        admitted: false,
        reason: 'unavailable',
      });
    });

    test('warns past the alert mark or at the cap, at most once a minute', function (assert) {
      let nowMs = 0;
      let warnings: string[] = [];
      let alert = new UnconnectedClientAlert(1000, {
        now: () => nowMs,
        warn: (message) => warnings.push(message),
      });
      alert.note({ admitted: true, busy: false });
      alert.note({ admitted: false, reason: 'unavailable' });
      assert.strictEqual(warnings.length, 0, 'not busy, or not counted');

      alert.note({ admitted: true, busy: true });
      nowMs += 59_999;
      alert.note({ admitted: false, reason: 'full' });
      assert.deepEqual(warnings, [
        'more than 800 OAuth clients registered by dynamic client registration have never connected; registration is refused for everyone at 1000 (BOXEL_OAUTH_UNCONNECTED_CLIENT_CAP) until the daily cleanup deletes some: check that it runs',
      ]);
      nowMs += 1;
      alert.note({ admitted: false, reason: 'full' });
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
