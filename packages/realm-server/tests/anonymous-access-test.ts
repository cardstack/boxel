import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type Koa from 'koa';
import {
  CLIENT_CLASS_HEADER,
  CLIENT_IP_HEADER,
  INFRA_CLIENT_CLASS,
  isMatrixUserId,
  normalizeIP,
  parseAddressRange,
  parseAddressRanges,
  parseIP,
  parseRateLimit,
  parseRateLimitSpec,
  rangesContain,
  rateLimitKey,
} from '@cardstack/runtime-common';
import {
  blocklistCloses,
  compileGrantExpression,
  readBlocklist,
  readRateLimitPart,
  settleTraffic,
  type CompiledGrantExpression,
  type GrantExpressionName,
  type GrantExpressionParser,
  type GrantTraffic,
} from '@cardstack/runtime-common/card-operations/grant-expressions';
import * as bxl from '@cardstack/bxl';
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

// The parser a realm compiles a grant's expressions with.
const bxlParser = bxl as unknown as GrantExpressionParser;

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
      assert.strictEqual(
        normalizeIP('64:ff9b::192.0.2.1'),
        '64:ff9b::c000:201',
        'an embedded IPv4 address ends the address',
      );
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
        '1.2.3.4::',
        '1.2.3.4::1',
        '::1.2.3.4:1',
      ]) {
        assert.strictEqual(parseIP(text), undefined, `"${text}" is refused`);
      }
    });

    test('an IPv4 caller is counted by address, and an IPv6 caller by the /64 they are in', function (assert) {
      assert.strictEqual(rateLimitKey(parseIP(CALLER)!), CALLER);
      assert.strictEqual(
        rateLimitKey(parseIP(`::ffff:${CALLER}`)!),
        CALLER,
        'a mapped address is counted as the IPv4 address it maps',
      );
      assert.strictEqual(
        rateLimitKey(parseIP('2001:db8:1:2:aaaa:bbbb:cccc:dddd')!),
        '2001:db8:1:2::/64',
      );
      assert.strictEqual(
        rateLimitKey(parseIP('2001:db8:1:2::1')!),
        rateLimitKey(parseIP('2001:db8:1:2:ffff::9')!),
        'two addresses in one /64 share a budget',
      );
      assert.notStrictEqual(
        rateLimitKey(parseIP('2001:db8:1:2::1')!),
        rateLimitKey(parseIP('2001:db8:1:3::1')!),
      );
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
  });

  module("a grant's blocklist and rate limit", function () {
    const PLATFORM = { requests: 50, windowSeconds: 10 };

    function compiled(
      name: GrantExpressionName,
      source: string,
    ): CompiledGrantExpression {
      let outcome = compileGrantExpression(bxlParser, name, source);
      if ('problem' in outcome) {
        throw new Error(
          `test fixture ${source} does not compile: ${outcome.problem}`,
        );
      }
      return outcome;
    }

    function blocksAddress(traffic: GrantTraffic, address: string) {
      return rangesContain(traffic.blocklist.ranges, parseIP(address)!);
    }

    test('a blocklist is a comma-separated string, a list, or a string holding a JSON list', function (assert) {
      let csv = readBlocklist(`${CALLER}, 198.51.100.0/24`);
      assert.deepEqual(csv.invalid, []);
      assert.strictEqual(csv.ranges.length, 2);

      let list = readBlocklist([CALLER, '198.51.100.0/24']);
      assert.deepEqual(list.invalid, []);
      assert.deepEqual(
        list.ranges,
        csv.ranges,
        'a list reads as the string does',
      );

      let json = readBlocklist(` ["${CALLER}", "198.51.100.0/24"] `);
      assert.deepEqual(json.invalid, []);
      assert.deepEqual(
        json.ranges,
        csv.ranges,
        'and so does a JSON list in a string',
      );
    });

    test('blank entries of a comma-separated blocklist are dropped, so an empty string blocks nobody', function (assert) {
      let { ranges, invalid } = readBlocklist(`, ${CALLER},, ,`);
      assert.strictEqual(ranges.length, 1);
      assert.deepEqual(invalid, []);
      assert.deepEqual(readBlocklist(''), { ranges: [], invalid: [] });
      assert.deepEqual(readBlocklist('   '), { ranges: [], invalid: [] });
      assert.deepEqual(readBlocklist([]), { ranges: [], invalid: [] });
    });

    test('a blocklist entry that is not an address, or a blocklist that is not a list, is invalid', function (assert) {
      assert.deepEqual(
        readBlocklist(`${CALLER}, the spammer`).invalid,
        ['the spammer'],
        'an entry that is not an address is named',
      );
      assert.deepEqual(
        readBlocklist([CALLER, 7]).invalid,
        ['7'],
        'an entry of a list that is not a string',
      );
      assert.deepEqual(
        readBlocklist(`["${CALLER}"`).invalid,
        [`["${CALLER}"`],
        'a string that starts a JSON list and is not one',
      );
      for (let value of [42, true, null, { ip: CALLER }]) {
        assert.strictEqual(
          readBlocklist(value).invalid.length,
          1,
          `${JSON.stringify(value)} is not a blocklist`,
        );
      }
    });

    test('half of a rate limit is a whole number within the bounds a limit has', function (assert) {
      assert.strictEqual(readRateLimitPart('requests', 10), 10);
      assert.strictEqual(readRateLimitPart('windowSeconds', 600), 600);
      for (let [part, value] of [
        ['requests', 0],
        ['requests', -1],
        ['requests', 1.5],
        ['requests', 1_000_001],
        ['requests', '10'],
        ['requests', null],
        ['windowSeconds', 0],
        ['windowSeconds', 86_401],
        ['windowSeconds', '60'],
      ] as const) {
        assert.strictEqual(
          readRateLimitPart(part, value),
          undefined,
          `${JSON.stringify(value)} is no ${part}`,
        );
      }
    });

    test('a grant with neither blocks nobody and counts against the platform limit', async function (assert) {
      let traffic = await settleTraffic({}, {}, PLATFORM);
      assert.deepEqual(traffic.blocklist, { ranges: [], invalid: [] });
      assert.false(blocklistCloses(traffic));
      assert.deepEqual(traffic.limit, {
        ...PLATFORM,
        requestsFrom: 'platform',
        windowSecondsFrom: 'platform',
      });
    });

    test('a blocklist is read from the realm config or the policy card, in any of its forms', async function (assert) {
      for (let [label, blockedIps] of [
        ['a comma-separated string', `${CALLER}, 198.51.100.0/24`],
        ['a list', [CALLER, '198.51.100.0/24']],
        [
          'a JSON list in a string',
          JSON.stringify([CALLER, '198.51.100.0/24']),
        ],
      ] as const) {
        let fromConfig = await settleTraffic(
          { blocklist: compiled('blocklist', 'realmConfig("blockedIps")') },
          { realmConfig: { blockedIps } },
          PLATFORM,
        );
        assert.false(blocklistCloses(fromConfig), `${label}: is a blocklist`);
        assert.true(
          blocksAddress(fromConfig, CALLER),
          `${label}: blocks the address`,
        );
        assert.true(
          blocksAddress(fromConfig, '198.51.100.200'),
          `${label}: and the range`,
        );
        assert.false(
          blocksAddress(fromConfig, '192.0.2.11'),
          `${label}: and nobody else`,
        );
      }
      let fromPolicy = await settleTraffic(
        { blocklist: compiled('blocklist', 'policy("blockedIps")') },
        { realmConfig: {}, policy: { blockedIps: CALLER } },
        PLATFORM,
      );
      assert.true(
        blocksAddress(fromPolicy, CALLER),
        'read from the policy card',
      );
      let written = await settleTraffic(
        { blocklist: compiled('blocklist', `"${CALLER}"`) },
        {},
        PLATFORM,
      );
      assert.true(blocksAddress(written, CALLER), 'or written out');
    });

    test('a blocklist that is not a list of addresses closes the grant', async function (assert) {
      let blocklist = compiled('blocklist', 'realmConfig("blockedIps")');
      for (let [label, config] of [
        [
          'an entry that is not an address',
          { blockedIps: `${CALLER}, the spammer` },
        ],
        ['a value of the wrong type', { blockedIps: 42 }],
        ['a setting that is absent, which throws', {}],
      ] as const) {
        let traffic = await settleTraffic(
          { blocklist },
          { realmConfig: config },
          PLATFORM,
        );
        assert.true(blocklistCloses(traffic), `${label}: closes the grant`);
      }
      let thrown = await settleTraffic(
        { blocklist },
        { realmConfig: {} },
        PLATFORM,
      );
      assert.strictEqual(
        typeof thrown.blocklist.failed,
        'string',
        'and says it failed',
      );
      let invalid = await settleTraffic(
        { blocklist },
        { realmConfig: { blockedIps: `${CALLER}, the spammer` } },
        PLATFORM,
      );
      assert.deepEqual(
        invalid.blocklist.invalid,
        ['the spammer'],
        'naming the entry',
      );
    });

    test("each half of a rate limit is the grant's where it produces one, and the platform's otherwise", async function (assert) {
      let requestsOnly = await settleTraffic(
        {
          rateLimitRequests: compiled(
            'rateLimitRequests',
            'realmConfig("requests")',
          ),
        },
        { realmConfig: { requests: 5 } },
        PLATFORM,
      );
      assert.deepEqual(requestsOnly.limit, {
        requests: 5,
        windowSeconds: PLATFORM.windowSeconds,
        requestsFrom: 'grant',
        windowSecondsFrom: 'platform',
      });

      let windowOnly = await settleTraffic(
        {
          rateLimitWindowSeconds: compiled(
            'rateLimitWindowSeconds',
            'policy("windowSeconds")',
          ),
        },
        { realmConfig: {}, policy: { windowSeconds: 600 } },
        PLATFORM,
      );
      assert.deepEqual(windowOnly.limit, {
        requests: PLATFORM.requests,
        windowSeconds: 600,
        requestsFrom: 'platform',
        windowSecondsFrom: 'grant',
      });

      let both = await settleTraffic(
        {
          rateLimitRequests: compiled('rateLimitRequests', '20'),
          rateLimitWindowSeconds: compiled('rateLimitWindowSeconds', '600'),
        },
        {},
        PLATFORM,
      );
      assert.deepEqual(both.limit, {
        requests: 20,
        windowSeconds: 600,
        requestsFrom: 'grant',
        windowSecondsFrom: 'grant',
      });
    });

    test('a rate-limit expression that produces no limit leaves that half to the platform', async function (assert) {
      let grant = {
        rateLimitRequests: compiled(
          'rateLimitRequests',
          'realmConfig("requests")',
        ),
        rateLimitWindowSeconds: compiled(
          'rateLimitWindowSeconds',
          'realmConfig("windowSeconds")',
        ),
      };
      for (let [label, config] of [
        ['a string', { requests: '5', windowSeconds: '600' }],
        ['out of bounds', { requests: 0, windowSeconds: 86_401 }],
        ['not whole', { requests: 1.5, windowSeconds: 0.5 }],
        ['absent, which throws', {}],
      ] as const) {
        let traffic = await settleTraffic(
          grant,
          { realmConfig: config },
          PLATFORM,
        );
        assert.deepEqual(
          traffic.limit,
          {
            ...PLATFORM,
            requestsFrom: 'platform',
            windowSecondsFrom: 'platform',
          },
          label,
        );
        assert.false(blocklistCloses(traffic), `${label}: closes nothing`);
      }
      let mixed = await settleTraffic(
        grant,
        { realmConfig: { requests: 5, windowSeconds: 'a minute' } },
        PLATFORM,
      );
      assert.deepEqual(
        mixed.limit,
        {
          requests: 5,
          windowSeconds: PLATFORM.windowSeconds,
          requestsFrom: 'grant',
          windowSecondsFrom: 'platform',
        },
        'one half falls back without the other',
      );
    });

    test('a blocklist or rate limit may not read the target or the caller', function (assert) {
      for (let [name, source] of [
        ['blocklist', 'instance("blockedIps")'],
        ['rateLimitRequests', 'actor()'],
      ] as const) {
        let outcome = compileGrantExpression(bxlParser, name, source);
        assert.strictEqual(
          'code' in outcome ? outcome.code : undefined,
          'grant-expression-reads-target',
          `${name}: ${source}`,
        );
      }
      let actingUser = compileGrantExpression(
        bxlParser,
        'actingUser',
        'instance("submitter")',
      );
      assert.false(
        'problem' in actingUser,
        'an acting user may read the target',
      );
      let wrongType = compileGrantExpression(
        bxlParser,
        'rateLimitRequests',
        '"lots"',
      );
      assert.strictEqual(
        'code' in wrongType ? wrongType.code : undefined,
        'grant-expression-wrong-type',
        'a literal of the wrong kind is reported',
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
