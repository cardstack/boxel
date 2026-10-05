import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type Koa from 'koa';
import {
  CLIENT_CLASS_HEADER,
  CLIENT_IP_HEADER,
  DEFAULT_ANONYMOUS_RATE_LIMIT,
  INFRA_CLIENT_CLASS,
  isMatrixUserId,
  normalizeIP,
  parseAddressRange,
  parseAddressRanges,
  parseIP,
  parseRateLimit,
  parseRateLimitSpec,
  rangesContain,
  resolveAnonymousAccess,
} from '@cardstack/runtime-common';
import {
  clientAddress,
  clientAddressSettingsFromEnv,
} from '../middleware/client-address.ts';

// Addresses come from the ranges reserved for documentation (RFC 5737 for
// IPv4, RFC 3849 for IPv6), so none of them is anyone's.
const CALLER = '192.0.2.10';
const FORGED = '198.51.100.7';
const OUR_NAT = '203.0.113.5';
const LOAD_BALANCER_PEER = '10.0.0.12';

function contains(range: string, address: string) {
  let parsedRange = parseAddressRange(range);
  let parsedAddress = parseIP(address);
  if (!parsedRange || !parsedAddress) {
    throw new Error(`test fixture ${range} / ${address} does not parse`);
  }
  return rangesContain([parsedRange], parsedAddress);
}

module(basename(import.meta.filename), function () {
  module('addresses', function () {
    test('an address is read in canonical form, however it was written', function (assert) {
      assert.strictEqual(normalizeIP('192.0.2.10'), '192.0.2.10');
      assert.strictEqual(
        normalizeIP('::ffff:192.0.2.10'),
        '192.0.2.10',
        'an IPv4-mapped IPv6 address is the IPv4 address it maps',
      );
      assert.strictEqual(
        normalizeIP('2001:DB8:0:0:0:0:0:1'),
        '2001:db8::1',
        'IPv6 is lower-cased and its longest zero run compressed',
      );
      assert.strictEqual(normalizeIP('2001:db8:0:1:0:0:0:0'), '2001:db8:0:1::');
      assert.strictEqual(normalizeIP('::'), '::');
      assert.strictEqual(normalizeIP('[2001:db8::1]'), '2001:db8::1');
    });

    test('text that is not an address is not read as one', function (assert) {
      for (let text of [
        '',
        'unknown',
        '192.0.2',
        '192.0.2.256',
        '192.0.2.010',
        '192.0.2.1.5',
        '2001:db8::1::2',
        '2001:db8:0:0:0:0:0:0:1',
        'fe80::1%eth0',
        '192.0.2.10:443',
      ]) {
        assert.strictEqual(parseIP(text), undefined, `"${text}" is refused`);
      }
    });

    test('a range contains the addresses under its prefix, and a single address only itself', function (assert) {
      assert.true(contains('192.0.2.0/24', '192.0.2.200'));
      assert.false(contains('192.0.2.0/24', '192.0.3.1'));
      assert.true(contains(CALLER, CALLER));
      assert.false(contains(CALLER, '192.0.2.11'));
      assert.true(contains('2001:db8::/32', '2001:db8:ffff::1'));
      assert.false(contains('2001:db8::/32', '2001:db9::1'));
      assert.false(
        contains('192.0.2.0/24', '2001:db8::1'),
        'a range never contains an address of the other family',
      );
      assert.true(
        contains('::ffff:192.0.2.0/120', '192.0.2.99'),
        'a mapped range is the IPv4 range it maps',
      );
      assert.true(contains('0.0.0.0/0', CALLER), 'a /0 holds every address');
    });

    test('a range with bits set below its prefix is refused rather than guessed at', function (assert) {
      assert.strictEqual(parseAddressRange('192.0.2.1/24'), undefined);
      assert.strictEqual(parseAddressRange('192.0.2.0/33'), undefined);
      assert.strictEqual(parseAddressRange('192.0.2.0/x'), undefined);
      assert.strictEqual(parseAddressRange('192.0.2.0/24/8'), undefined);
      let { ranges, invalid } = parseAddressRanges([
        '192.0.2.0/24',
        'nonsense',
        7,
      ]);
      assert.strictEqual(ranges.length, 1);
      assert.deepEqual(invalid, ['nonsense', '7']);
    });
  });

  module('rate limits', function () {
    test('a limit is whole requests per whole seconds, within bounds', function (assert) {
      assert.deepEqual(parseRateLimit({ requests: 10, windowSeconds: 60 }), {
        requests: 10,
        windowSeconds: 60,
      });
      for (let value of [
        { requests: 0, windowSeconds: 60 },
        { requests: 1.5, windowSeconds: 60 },
        { requests: 10, windowSeconds: 0 },
        { requests: 10, windowSeconds: 86_401 },
        { requests: '10', windowSeconds: 60 },
        { requests: 10 },
        [10, 60],
        'often',
      ]) {
        assert.strictEqual(
          parseRateLimit(value),
          undefined,
          `${JSON.stringify(value)} is not a limit`,
        );
      }
    });

    test('the platform limit is written requests/windowSeconds', function (assert) {
      assert.deepEqual(parseRateLimitSpec('120/30'), {
        requests: 120,
        windowSeconds: 30,
      });
      assert.deepEqual(parseRateLimitSpec(' 5 / 1 '), {
        requests: 5,
        windowSeconds: 1,
      });
      assert.strictEqual(parseRateLimitSpec('120'), undefined);
      assert.strictEqual(parseRateLimitSpec('120/0'), undefined);
      assert.strictEqual(parseRateLimitSpec(undefined), undefined);
    });

    test("a realm's own limit overrides the platform's, and anything that isn't a limit leaves the platform's", function (assert) {
      let platform = { requests: 50, windowSeconds: 10 };
      let own = resolveAnonymousAccess(
        { rateLimit: { requests: 5, windowSeconds: 60 } },
        platform,
      );
      assert.deepEqual(own.limit, { requests: 5, windowSeconds: 60 });
      assert.strictEqual(own.limitFrom, 'realm');

      let unset = resolveAnonymousAccess(
        { rateLimit: { requests: null, windowSeconds: null } },
        platform,
      );
      assert.deepEqual(unset.limit, platform, 'an unfilled field sets nothing');
      assert.strictEqual(unset.limitFrom, 'platform');

      let malformed = resolveAnonymousAccess(
        { rateLimit: { requests: -1, windowSeconds: 60 } },
        platform,
      );
      assert.deepEqual(malformed.limit, platform);
      assert.strictEqual(malformed.limitFrom, 'platform');

      assert.deepEqual(
        resolveAnonymousAccess({}).limit,
        DEFAULT_ANONYMOUS_RATE_LIMIT,
        'with no platform limit given, the built-in one applies',
      );
    });

    test('a blocklist keeps the entries that parse and names the ones that do not', function (assert) {
      let access = resolveAnonymousAccess({
        blocklist: [CALLER, '198.51.100.0/24', 'not-an-address'],
      });
      assert.strictEqual(access.blocklist.length, 2);
      assert.deepEqual(access.invalidBlocklistEntries, ['not-an-address']);
      assert.deepEqual(
        resolveAnonymousAccess({ blocklist: CALLER }).invalidBlocklistEntries,
        [JSON.stringify(CALLER)],
        'a blocklist that is not a list is itself an invalid entry',
      );
      assert.deepEqual(
        resolveAnonymousAccess({}).invalidBlocklistEntries,
        [],
        'no blocklist blocks nothing and is not invalid',
      );
    });
  });

  module('matrix user ids', function () {
    test('a full user id is one, and anything a setting could carry by mistake is not', function (assert) {
      assert.true(isMatrixUserId('@feedback-writer:localhost'));
      assert.true(isMatrixUserId('@writer.bot:boxel.ai'));
      assert.true(isMatrixUserId('@writer:matrix.example.test:8448'));
      for (let text of [
        'feedback-writer',
        '@feedback-writer',
        'feedback-writer:localhost',
        '@Feedback:localhost',
        ' @writer:localhost',
        '@writer:localhost ',
        '@wri ter:localhost',
        '',
      ]) {
        assert.false(isMatrixUserId(text), `"${text}" is not a user id`);
      }
    });
  });

  module('the caller address the realm server hands a realm', function () {
    async function addressed({
      trustedProxyHops,
      infra = [],
      peer = LOAD_BALANCER_PEER,
      headers = {},
    }: {
      trustedProxyHops: number;
      infra?: string[];
      peer?: string;
      headers?: Record<string, string | string[]>;
    }) {
      let request = {
        headers: { ...headers } as Record<string, string | string[]>,
        socket: { remoteAddress: peer },
      };
      let middleware = clientAddress({
        trustedProxyHops,
        infraAddresses: parseAddressRanges(infra).ranges,
      });
      await middleware(
        { req: request } as unknown as Koa.Context,
        async () => {},
      );
      return {
        ip: request.headers[CLIENT_IP_HEADER],
        kind: request.headers[CLIENT_CLASS_HEADER],
      };
    }

    test('behind the load balancer, the caller is the entry it appended, not one the caller wrote', async function (assert) {
      let { ip } = await addressed({
        trustedProxyHops: 1,
        headers: { 'x-forwarded-for': `${FORGED}, ${CALLER}` },
      });
      assert.strictEqual(ip, CALLER);
    });

    test('with nothing in front of the server, the caller is the socket peer and X-Forwarded-For is ignored', async function (assert) {
      let { ip } = await addressed({
        trustedProxyHops: 0,
        peer: `::ffff:${CALLER}`,
        headers: { 'x-forwarded-for': FORGED },
      });
      assert.strictEqual(ip, CALLER);
    });

    test('a copy of the headers the caller sent is never passed on', async function (assert) {
      let { ip, kind } = await addressed({
        trustedProxyHops: 1,
        headers: {
          [CLIENT_IP_HEADER]: OUR_NAT,
          [CLIENT_CLASS_HEADER]: INFRA_CLIENT_CLASS,
        },
      });
      assert.strictEqual(
        ip,
        undefined,
        'with no entry from the load balancer, the address is unknown',
      );
      assert.strictEqual(kind, undefined, 'and the caller is not ours');
    });

    test('an entry from the load balancer that is not an address leaves the caller unknown', async function (assert) {
      let { ip } = await addressed({
        trustedProxyHops: 1,
        headers: { 'x-forwarded-for': `${CALLER}, unknown` },
      });
      assert.strictEqual(ip, undefined);
    });

    test('IPv6 callers are named in canonical form', async function (assert) {
      let { ip } = await addressed({
        trustedProxyHops: 1,
        headers: { 'x-forwarded-for': '2001:DB8:0:0::7' },
      });
      assert.strictEqual(ip, '2001:db8::7');
    });

    test('a caller at one of our egress addresses is marked as ours', async function (assert) {
      let ours = await addressed({
        trustedProxyHops: 1,
        infra: [OUR_NAT],
        headers: { 'x-forwarded-for': OUR_NAT },
      });
      assert.strictEqual(ours.ip, OUR_NAT);
      assert.strictEqual(ours.kind, INFRA_CLIENT_CLASS);

      let theirs = await addressed({
        trustedProxyHops: 1,
        infra: [OUR_NAT],
        headers: { 'x-forwarded-for': `${OUR_NAT}, ${CALLER}` },
      });
      assert.strictEqual(
        theirs.kind,
        undefined,
        'naming our address earlier in the header does not make a caller ours',
      );
    });

    test('the settings come from the environment, and a malformed one stops the server', function (assert) {
      let settings = clientAddressSettingsFromEnv({
        BOXEL_TRUSTED_PROXY_HOPS: '1',
        BOXEL_INFRA_EGRESS_IPS: `${OUR_NAT}, 203.0.113.64/26`,
      });
      assert.strictEqual(settings.trustedProxyHops, 1);
      assert.strictEqual(settings.infraAddresses.length, 2);

      let unset = clientAddressSettingsFromEnv({});
      assert.strictEqual(unset.trustedProxyHops, 0);
      assert.deepEqual(unset.infraAddresses, []);

      assert.throws(
        () => clientAddressSettingsFromEnv({ BOXEL_TRUSTED_PROXY_HOPS: 'one' }),
        /BOXEL_TRUSTED_PROXY_HOPS/,
      );
      assert.throws(
        () =>
          clientAddressSettingsFromEnv({ BOXEL_INFRA_EGRESS_IPS: 'our-nat' }),
        /BOXEL_INFRA_EGRESS_IPS/,
      );
    });
  });
});
