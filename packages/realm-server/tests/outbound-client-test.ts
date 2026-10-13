import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { logger } from '@cardstack/runtime-common';
import {
  guardedLookup,
  isMetadataAddress,
  isPublicAddress,
} from '../lib/outbound/address-policy.ts';
import {
  checkOutboundSettings,
  configureOutbound,
  isDeployedServerURL,
  outboundFetch,
  OutboundRefusedError,
  outboundSettingsFromEnv,
  OutboundSettingsError,
  OutboundTimeoutError,
  resetOutbound,
  startOutboundGuard,
} from '../lib/outbound/client.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';

// Every line logged on the `outbound` channel while `fn` runs, at info and
// louder whatever LOG_LEVELS says.
async function outboundLogDuring(
  fn: () => Promise<void>,
): Promise<{ level: string; message: string }[]> {
  let log = logger('outbound');
  let lines: { level: string; message: string }[] = [];
  let originalFactory = log.methodFactory;
  let originalLevel = log.getLevel();
  log.methodFactory = (methodName, level, loggerName) => {
    let raw = originalFactory(methodName, level, loggerName);
    return (...args: unknown[]) => {
      lines.push({ level: methodName, message: args.map(String).join(' ') });
      raw(...args);
    };
  };
  log.setLevel('info');
  try {
    await fn();
  } finally {
    log.methodFactory = originalFactory;
    log.setLevel(originalLevel);
  }
  return lines;
}

async function refusal(
  promise: Promise<unknown>,
): Promise<OutboundRefusedError | OutboundTimeoutError | unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

function lookupAddresses(
  hostname: string,
  resolved: string[],
): Promise<{ error?: Error; addresses?: { address: string }[] }> {
  let lookup = guardedLookup({
    resolveHost: async () => resolved,
    isAllowlisted: () => false,
  });
  return new Promise((resolve) =>
    lookup(hostname, { all: true }, (error: any, addresses: any) =>
      resolve(error ? { error } : { addresses }),
    ),
  );
}

module(basename(import.meta.filename), function () {
  module('outbound address policy', function () {
    const refusedV4: [string, string][] = [
      ['loopback', '127.0.0.1'],
      ['private 10/8', '10.1.2.3'],
      ['private 172.16/12', '172.20.0.5'],
      ['private 192.168/16', '192.168.1.1'],
      ['link-local', '169.254.10.20'],
      ['metadata', '169.254.169.254'],
      ['carrier-grade NAT', '100.64.0.1'],
      ['unspecified', '0.0.0.0'],
      ['multicast', '224.0.0.1'],
    ];
    const refusedV6: [string, string][] = [
      ['loopback', '::1'],
      ['unique local', 'fd12:3456::1'],
      ['metadata', 'fd00:ec2::254'],
      ['link-local', 'fe80::1'],
      ['IPv4-mapped loopback, dotted', '::ffff:127.0.0.1'],
      ['IPv4-mapped loopback, hex', '::ffff:7f00:1'],
      ['IPv4-mapped metadata', '::ffff:169.254.169.254'],
      ['IPv4-mapped private', '::ffff:10.0.0.1'],
      ['NAT64 embedding a private address', '64:ff9b::a00:1'],
      ['6to4', '2002:a00:1::1'],
      ['segment-routing SID', '5f00::1'],
      ['benchmarking', '2001:2::1'],
      ['documentation 3fff::/20', '3fff::1'],
      ['dummy prefix', '100:0:0:1::1'],
    ];

    for (let [label, address] of refusedV4) {
      test(`refuses IPv4 ${label} (${address})`, async function (assert) {
        assert.false(isPublicAddress(address), 'not a public address');
        let { error } = await lookupAddresses('vendor.example', [address]);
        assert.ok(error, 'a host resolving to it is refused');
      });
    }

    for (let [label, address] of refusedV6) {
      test(`refuses IPv6 ${label} (${address})`, async function (assert) {
        assert.false(isPublicAddress(address), 'not a public address');
        let { error } = await lookupAddresses('vendor.example', [address]);
        assert.ok(error, 'a host resolving to it is refused');
      });
    }

    test('allows public IPv4 and IPv6, and IPv4-mapped public IPv4', async function (assert) {
      for (let address of [
        '8.8.8.8',
        '1.1.1.1',
        '104.18.0.1',
        '2606:4700::1111',
        '::ffff:8.8.8.8',
      ]) {
        assert.true(isPublicAddress(address), `${address} is public`);
      }
      let { error, addresses } = await lookupAddresses('vendor.example', [
        '8.8.8.8',
        '2606:4700::1111',
      ]);
      assert.notOk(error, 'a host resolving to public addresses is allowed');
      assert.deepEqual(
        addresses?.map((entry) => entry.address),
        ['8.8.8.8', '2606:4700::1111'],
        'the socket connects to exactly the addresses that were checked',
      );
    });

    test('refuses a host when any one of its addresses is not public', async function (assert) {
      let { error } = await lookupAddresses('vendor.example', [
        '8.8.8.8',
        '10.0.0.1',
      ]);
      assert.ok(error, 'one private answer refuses the host');
    });

    test('recognizes the metadata addresses in every form', function (assert) {
      assert.true(isMetadataAddress('169.254.169.254'));
      assert.true(isMetadataAddress('::ffff:169.254.169.254'));
      assert.true(isMetadataAddress('fd00:ec2::254'));
      assert.false(isMetadataAddress('169.254.169.253'));
    });
  });

  module('outbound client', function (hooks) {
    let vendor: StubVendor;

    hooks.before(async function () {
      vendor = await startStubVendor();
    });
    hooks.after(async function () {
      await vendor.close();
    });
    hooks.beforeEach(function () {
      vendor.requests.length = 0;
      configureOutbound({
        devAllowlist: ['127.0.0.1', 'localhost'],
        // Public-looking names resolve where each test says.
        resolveHost: async (hostname) =>
          hostname === 'rebind.test' ? ['10.0.0.7'] : ['127.0.0.1'],
      });
    });
    hooks.afterEach(function () {
      resetOutbound();
    });

    test('sends exactly the headers it is given', async function (assert) {
      let response = await outboundFetch({
        url: `${vendor.url}/echo`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vendor': 'one' },
        body: JSON.stringify({ hello: 'world' }),
        sizePath: 'system-key',
      });
      let echoed = await response.json();
      assert.strictEqual(echoed.headers['x-vendor'], 'one');
      assert.strictEqual(echoed.body, '{"hello":"world"}');
      assert.notOk(echoed.headers.authorization, 'no credential was added');
    });

    test('refuses plain HTTP to a host the allowlist does not name', async function (assert) {
      let error = await refusal(
        outboundFetch({
          url: 'http://vendor.example/v1',
          method: 'GET',
          headers: {},
          sizePath: 'system-key',
        }),
      );
      assert.true(error instanceof OutboundRefusedError);
      assert.strictEqual((error as OutboundRefusedError).reason, 'scheme');
    });

    test('refuses an IP literal destination that is not public, in both families', async function (assert) {
      for (let url of [
        'https://10.0.0.1/',
        'https://169.254.169.254/latest/meta-data/',
        'https://[::1]/',
        'https://[fd00:ec2::254]/',
        'https://[::ffff:127.0.0.1]/',
      ]) {
        let error = await refusal(
          outboundFetch({
            url,
            method: 'GET',
            headers: {},
            sizePath: 'system-key',
          }),
        );
        assert.strictEqual(
          (error as OutboundRefusedError)?.reason,
          'address',
          `${url} is refused`,
        );
      }
      assert.strictEqual(vendor.requests.length, 0);
    });

    test('refuses the metadata address even for an allowlisted host', async function (assert) {
      configureOutbound({
        devAllowlist: ['169.254.169.254', 'metadata.test'],
        resolveHost: async () => ['169.254.169.254'],
      });
      for (let url of [
        'http://169.254.169.254/latest/meta-data/',
        'http://metadata.test/latest/meta-data/',
      ]) {
        let error = await refusal(
          outboundFetch({
            url,
            method: 'GET',
            headers: {},
            sizePath: 'system-key',
          }),
        );
        assert.strictEqual(
          (error as OutboundRefusedError)?.reason,
          'address',
          `${url} is refused`,
        );
      }
    });

    test('refuses a hostname that resolves to a private address', async function (assert) {
      let error = await refusal(
        outboundFetch({
          url: 'https://rebind.test/v1',
          method: 'GET',
          headers: {},
          sizePath: 'system-key',
        }),
      );
      assert.true(error instanceof OutboundRefusedError);
      assert.strictEqual((error as OutboundRefusedError).reason, 'address');
    });

    test('a redirect into a private address is refused', async function (assert) {
      for (let to of ['https://10.0.0.1/x', 'https://rebind.test/x']) {
        let error = await refusal(
          outboundFetch({
            url: `${vendor.url}/redirect?to=${encodeURIComponent(to)}`,
            method: 'GET',
            headers: {},
            sizePath: 'system-key',
          }),
        );
        assert.strictEqual(
          (error as OutboundRefusedError)?.reason,
          'address',
          `redirect to ${to} is refused`,
        );
      }
    });

    test('a redirect to plain HTTP on a host the allowlist does not name is refused', async function (assert) {
      let error = await refusal(
        outboundFetch({
          url: `${vendor.url}/redirect?to=${encodeURIComponent('http://vendor.example/x')}`,
          method: 'GET',
          headers: {},
          sizePath: 'system-key',
        }),
      );
      assert.strictEqual((error as OutboundRefusedError)?.reason, 'scheme');
    });

    test('follows a same-origin redirect with the credential, and drops it on another origin', async function (assert) {
      let sameOrigin = await outboundFetch({
        url: `${vendor.url}/redirect?to=/echo`,
        method: 'GET',
        headers: { Authorization: 'Bearer vendor-key' },
        sizePath: 'system-key',
        credentialHeaders: ['Authorization'],
      });
      assert.strictEqual(
        (await sameOrigin.json()).headers.authorization,
        'Bearer vendor-key',
        'the credential follows a redirect on the same origin',
      );

      let crossOrigin = await outboundFetch({
        url: `${vendor.url}/redirect?to=${encodeURIComponent(`${vendor.alternateUrl}/echo`)}`,
        method: 'GET',
        headers: { Authorization: 'Bearer vendor-key', 'x-vendor': 'kept' },
        sizePath: 'system-key',
        credentialHeaders: ['Authorization'],
      });
      let echoed = await crossOrigin.json();
      assert.notOk(
        echoed.headers.authorization,
        'the credential is not sent to another origin',
      );
      assert.strictEqual(echoed.headers['x-vendor'], 'kept');
    });

    test('a 303 redirect continues as a GET without the body', async function (assert) {
      let response = await outboundFetch({
        url: `${vendor.url}/redirect?status=303&to=/echo`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
        sizePath: 'system-key',
      });
      let echoed = await response.json();
      assert.strictEqual(echoed.method, 'GET');
      assert.strictEqual(echoed.body, '');
    });

    test('stops after too many redirects', async function (assert) {
      configureOutbound({ maxRedirects: 2 });
      let error = await refusal(
        outboundFetch({
          url: `${vendor.url}/redirect?to=${encodeURIComponent('/redirect?to=/redirect%3Fto%3D/echo')}`,
          method: 'GET',
          headers: {},
          sizePath: 'system-key',
        }),
      );
      assert.strictEqual(
        (error as OutboundRefusedError)?.reason,
        'too-many-redirects',
      );
    });

    test('times out a destination that does not answer', async function (assert) {
      configureOutbound({ totalTimeoutMs: 200 });
      let started = Date.now();
      let error = await refusal(
        outboundFetch({
          url: `${vendor.url}/slow?ms=5000`,
          method: 'GET',
          headers: {},
          sizePath: 'system-key',
        }),
      );
      assert.true(error instanceof OutboundTimeoutError, 'a timeout error');
      assert.strictEqual((error as OutboundTimeoutError).phase, 'total');
      assert.true(Date.now() - started < 4000, 'gave up at the timeout');
    });

    test('a caller cancelling is passed through as its own abort', async function (assert) {
      let controller = new AbortController();
      let pending = outboundFetch({
        url: `${vendor.url}/slow?ms=5000`,
        method: 'GET',
        headers: {},
        signal: controller.signal,
        sizePath: 'system-key',
      });
      controller.abort(new Error('client went away'));
      let error = await refusal(pending);
      assert.false(error instanceof OutboundTimeoutError);
      assert.false(error instanceof OutboundRefusedError);
    });

    test('refuses an X-Boxel header', async function (assert) {
      let error = await refusal(
        outboundFetch({
          url: `${vendor.url}/echo`,
          method: 'GET',
          headers: { 'X-Boxel-Consuming-Realm': 'http://example/' },
          sizePath: 'system-key',
        }),
      );
      assert.strictEqual(
        (error as OutboundRefusedError)?.reason,
        'forbidden-header',
      );
      assert.strictEqual(vendor.requests.length, 0, 'nothing was sent');
    });

    test('passes a vendor error status through unchanged', async function (assert) {
      let response = await outboundFetch({
        url: `${vendor.url}/status/429`,
        method: 'GET',
        headers: {},
        sizePath: 'system-key',
      });
      assert.strictEqual(response.status, 429);
      assert.deepEqual(await response.json(), { status: 429 });
    });

    test('logs every response size', async function (assert) {
      let lines = await outboundLogDuring(async () => {
        let response = await outboundFetch({
          url: `${vendor.url}/large?bytes=1000`,
          method: 'GET',
          headers: {},
          sizePath: 'call-api',
        });
        await response.text();
      });
      let size = lines.find((line) =>
        line.message.startsWith('outbound response size:'),
      );
      assert.ok(size, 'the size is logged');
      assert.true(size!.message.includes('path=call-api'));
      assert.true(size!.message.includes('bytes=1000'));
      assert.true(size!.message.includes('outcome=complete'));
      assert.false(
        lines.some((line) => line.message.includes('wouldRefuse')),
        'nothing under the cap is flagged',
      );
    });

    test('observe mode logs a declared length over the cap and still delivers the body', async function (assert) {
      configureOutbound({
        responseSizeCaps: { 'system-key': 10_000, 'call-api': 10_000 },
      });
      let body = '';
      let lines = await outboundLogDuring(async () => {
        let response = await outboundFetch({
          url: `${vendor.url}/large?bytes=50000`,
          method: 'GET',
          headers: {},
          sizePath: 'system-key',
        });
        body = await response.text();
      });
      assert.strictEqual(body.length, 50_000, 'the whole body is delivered');
      let declared = lines.find((line) =>
        line.message.includes('wouldRefuse=declared-length'),
      );
      assert.ok(declared, 'the declared length over the cap is logged');
      assert.strictEqual(declared!.level, 'warn');
      assert.true(declared!.message.includes('declaredBytes=50000'));
      assert.true(
        lines.some((line) =>
          line.message.includes('wouldRefuse=stream-reached-cap'),
        ),
        'the stream passing the cap is logged too',
      );
    });

    test('observe mode counts a gzip bomb in decompressed bytes and still delivers it', async function (assert) {
      let decompressedBytes = 8 * 1024 * 1024;
      configureOutbound({
        responseSizeCaps: {
          'system-key': 1024 * 1024,
          'call-api': 1024 * 1024,
        },
      });
      let received = 0;
      let lines = await outboundLogDuring(async () => {
        let response = await outboundFetch({
          url: `${vendor.url}/gzip-bomb?bytes=${decompressedBytes}`,
          method: 'GET',
          headers: {},
          sizePath: 'system-key',
        });
        let reader = response.body!.getReader();
        for (;;) {
          let { done, value } = await reader.read();
          if (done) break;
          received += value!.byteLength;
        }
      });
      assert.strictEqual(received, decompressedBytes, 'nothing is refused yet');
      assert.false(
        lines.some((line) =>
          line.message.includes('wouldRefuse=declared-length'),
        ),
        'the compressed declared length is under the cap',
      );
      let reached = lines.find((line) =>
        line.message.includes('wouldRefuse=stream-reached-cap'),
      );
      assert.ok(reached, 'the decompressed stream passing the cap is logged');
      let size = lines.find((line) =>
        line.message.startsWith('outbound response size:'),
      );
      assert.true(
        size?.message.includes(`bytes=${decompressedBytes}`),
        'the size logged is the decompressed size',
      );
      assert.true(size?.message.includes('overCap=true'));
    });
  });

  module('outbound guard settings', function (hooks) {
    hooks.afterEach(function () {
      resetOutbound();
    });

    test('a deployed server is any server whose URL is not a local host', function (assert) {
      assert.true(isDeployedServerURL('https://app.boxel.ai'));
      assert.true(isDeployedServerURL('https://realms-staging.stack.cards/'));
      assert.false(isDeployedServerURL('http://localhost:4201'));
      assert.false(
        isDeployedServerURL('https://realm-server.my-env.localhost'),
      );
      assert.false(isDeployedServerURL('http://127.0.0.1:4445/'));
      assert.true(isDeployedServerURL('not a url'));
    });

    test('a deployed server refuses any allowlist entry', function (assert) {
      assert.throws(
        () =>
          checkOutboundSettings(
            { devAllowlist: ['localhost'] },
            { deployed: true },
          ),
        OutboundSettingsError,
      );
      assert.throws(
        () =>
          startOutboundGuard({
            serverURL: 'https://app.boxel.ai',
            env: { OUTBOUND_DEV_ALLOWLIST: 'localhost' },
          }),
        /must be empty on a deployed server/,
      );
    });

    test('a wildcard or non-host allowlist entry is refused everywhere', function (assert) {
      for (let entry of [
        '*',
        '*.example.com',
        'localhost:4201',
        '127.0.0.1:8080',
        'localhost:4201/x',
        'a b',
      ]) {
        assert.throws(
          () =>
            checkOutboundSettings(
              { devAllowlist: [entry] },
              { deployed: false },
            ),
          OutboundSettingsError,
          `"${entry}" is refused`,
        );
      }
    });

    test('an IPv6 literal allowlist entry is a host, not a port', function (assert) {
      for (let entry of ['::1', '[::1]']) {
        checkOutboundSettings({ devAllowlist: [entry] }, { deployed: false });
      }
      assert.ok(true, 'accepted');
    });

    test('a local server takes its allowlist and limits from the environment', function (assert) {
      startOutboundGuard({
        serverURL: 'http://localhost:4201',
        env: {
          OUTBOUND_DEV_ALLOWLIST: 'localhost, 127.0.0.1',
          OUTBOUND_RESPONSE_CAP_CALL_API_BYTES: '2048',
          OUTBOUND_TOTAL_TIMEOUT_MS: '5000',
        },
      });
      let settings = outboundSettingsFromEnv({
        OUTBOUND_DEV_ALLOWLIST: 'localhost, 127.0.0.1',
        OUTBOUND_RESPONSE_CAP_CALL_API_BYTES: '2048',
      });
      assert.deepEqual(settings.devAllowlist, ['localhost', '127.0.0.1']);
      assert.strictEqual(settings.responseSizeCaps?.['call-api'], 2048);
      assert.throws(
        () => outboundSettingsFromEnv({ OUTBOUND_TOTAL_TIMEOUT_MS: 'soon' }),
        OutboundSettingsError,
      );
    });

    test('a deployed server with no allowlist starts', function (assert) {
      startOutboundGuard({ serverURL: 'https://app.boxel.ai', env: {} });
      assert.ok(true, 'no error');
    });
  });
});
