import { module, test } from 'qunit';

import {
  ensureFullMatrixUserId,
  userIdFromUsername,
} from '@cardstack/runtime-common/matrix-client';
import {
  federationBaseURLs,
  isMatrixServerName,
  isUserOfMatrixServer,
  matrixServerNameOf,
  parseMatrixFederationAllowlist,
} from '@cardstack/runtime-common/matrix-server-name';

module('Unit | matrix server name', function () {
  module('user ids', function () {
    test('a localpart is qualified with the configured server name, not a hostname', function (assert) {
      assert.strictEqual(
        userIdFromUsername('someone', 'example.test'),
        '@someone:example.test',
      );
      assert.strictEqual(
        userIdFromUsername('someone', 'localhost'),
        '@someone:localhost',
        'the development homeserver is named localhost whatever host serves it',
      );
      assert.strictEqual(
        userIdFromUsername('someone', 'matrix.example.test:8448'),
        '@someone:matrix.example.test:8448',
        'a server name may carry a port',
      );
    });

    test('a full user id is kept as it is', function (assert) {
      assert.strictEqual(
        ensureFullMatrixUserId('@someone:other.example', 'example.test'),
        '@someone:other.example',
        'a user of another server stays on it',
      );
      assert.strictEqual(
        ensureFullMatrixUserId('@someone:example.test', 'example.test'),
        '@someone:example.test',
      );
    });

    test('a bare localpart, with or without a sigil, is put on the configured server', function (assert) {
      assert.strictEqual(
        ensureFullMatrixUserId('someone', 'example.test'),
        '@someone:example.test',
      );
      assert.strictEqual(
        ensureFullMatrixUserId('@someone', 'example.test'),
        '@someone:example.test',
      );
    });

    test('the server a user id names', function (assert) {
      assert.strictEqual(
        matrixServerNameOf('@someone:example.test'),
        'example.test',
      );
      assert.strictEqual(
        matrixServerNameOf('@someone:example.test:8448'),
        'example.test:8448',
        'the first colon ends the localpart; the rest is the server',
      );
      assert.strictEqual(matrixServerNameOf('someone'), undefined);
      assert.strictEqual(matrixServerNameOf('@someone'), undefined);
      assert.strictEqual(matrixServerNameOf('@someone:'), undefined);
      assert.strictEqual(matrixServerNameOf('@:example.test'), undefined);
    });

    test('whether a user is on a server is an exact match on the server name', function (assert) {
      assert.true(
        isUserOfMatrixServer('@someone:example.test', 'example.test'),
      );
      assert.false(
        isUserOfMatrixServer('@someone:other.example', 'example.test'),
      );
      assert.false(
        isUserOfMatrixServer('@someone:sub.example.test', 'example.test'),
        'a subdomain is another server',
      );
      assert.false(
        isUserOfMatrixServer('@someone:example.test:8448', 'example.test'),
        'a port makes a different server name',
      );
      assert.false(isUserOfMatrixServer('someone', 'example.test'));
    });
  });

  module('server names', function () {
    test('hostnames and IP literals, with an optional port, are server names', function (assert) {
      for (let name of [
        'localhost',
        'example.test',
        'matrix.example.test:8448',
        '192.0.2.1',
        '192.0.2.1:8448',
        '[2001:db8::1]',
        '[2001:db8::1]:8448',
      ]) {
        assert.true(isMatrixServerName(name), `${name} is a server name`);
      }
    });

    test('anything that could carry a path, a scheme or a user is not', function (assert) {
      for (let name of [
        '',
        'https://example.test',
        'example.test/.well-known',
        'example.test?x=1',
        '@someone:example.test',
        'exa mple.test',
        'example.test:notaport',
        'a'.repeat(256),
      ]) {
        assert.false(isMatrixServerName(name), `${name} is not a server name`);
      }
    });
  });

  module('federation allowlist', function () {
    test('an unset or empty list names no server', function (assert) {
      assert.deepEqual(parseMatrixFederationAllowlist(undefined), []);
      assert.deepEqual(parseMatrixFederationAllowlist(''), []);
      assert.deepEqual(parseMatrixFederationAllowlist(' , '), []);
    });

    test('server names are read from a comma-separated list, trimmed and deduplicated', function (assert) {
      assert.deepEqual(
        parseMatrixFederationAllowlist(
          ' other.example, matrix.example.test:8448 ,other.example',
        ),
        ['other.example', 'matrix.example.test:8448'],
      );
    });

    test('an entry that is not a server name is a configuration error', function (assert) {
      assert.throws(
        () => parseMatrixFederationAllowlist('other.example,https://x'),
        /not a Matrix server name/,
      );
    });
  });

  module('federation discovery', function () {
    function fetchAnswering(
      answers: Record<string, { status: number; body?: unknown }>,
    ) {
      let requested: string[] = [];
      let fetchImpl = (async (input: string | URL | Request) => {
        let url = typeof input === 'string' ? input : input.toString();
        requested.push(url);
        let answer = answers[url];
        if (!answer) {
          throw new TypeError('fetch failed');
        }
        return new Response(
          answer.body === undefined ? null : JSON.stringify(answer.body),
          { status: answer.status },
        );
      }) as typeof globalThis.fetch;
      return { fetchImpl, requested };
    }

    test('a well-known delegation is tried first, then the federation port, then HTTPS', async function (assert) {
      let { fetchImpl, requested } = fetchAnswering({
        'https://example.test/.well-known/matrix/server': {
          status: 200,
          body: { 'm.server': 'matrix.example.test:443' },
        },
      });
      assert.deepEqual(await federationBaseURLs('example.test', fetchImpl), [
        'https://matrix.example.test:443/',
        'https://example.test:8448/',
        'https://example.test/',
      ]);
      assert.deepEqual(requested, [
        'https://example.test/.well-known/matrix/server',
      ]);
    });

    test('a delegate without a port is on the federation port', async function (assert) {
      let { fetchImpl } = fetchAnswering({
        'https://example.test/.well-known/matrix/server': {
          status: 200,
          body: { 'm.server': 'matrix.example.test' },
        },
      });
      assert.deepEqual(await federationBaseURLs('example.test', fetchImpl), [
        'https://matrix.example.test:8448/',
        'https://example.test:8448/',
        'https://example.test/',
      ]);
    });

    test('a server without a well-known answer is tried on its own name', async function (assert) {
      let unreachable = fetchAnswering({});
      assert.deepEqual(
        await federationBaseURLs('example.test', unreachable.fetchImpl),
        ['https://example.test:8448/', 'https://example.test/'],
      );
      let notFound = fetchAnswering({
        'https://example.test/.well-known/matrix/server': { status: 404 },
      });
      assert.deepEqual(
        await federationBaseURLs('example.test', notFound.fetchImpl),
        ['https://example.test:8448/', 'https://example.test/'],
      );
    });

    test('a well-known answer that is not a server name is ignored', async function (assert) {
      let { fetchImpl } = fetchAnswering({
        'https://example.test/.well-known/matrix/server': {
          status: 200,
          body: { 'm.server': 'https://evil.example/path' },
        },
      });
      assert.deepEqual(await federationBaseURLs('example.test', fetchImpl), [
        'https://example.test:8448/',
        'https://example.test/',
      ]);
    });

    test('an IP literal or an explicit port is used as it is, without a well-known lookup', async function (assert) {
      let { fetchImpl, requested } = fetchAnswering({});
      assert.deepEqual(
        await federationBaseURLs('matrix.example.test:8449', fetchImpl),
        ['https://matrix.example.test:8449/'],
      );
      assert.deepEqual(await federationBaseURLs('192.0.2.1', fetchImpl), [
        'https://192.0.2.1:8448/',
      ]);
      assert.deepEqual(
        await federationBaseURLs('[2001:db8::1]:8449', fetchImpl),
        ['https://[2001:db8::1]:8449/'],
      );
      assert.deepEqual(requested, [], 'nothing was fetched');
    });

    test('text that is not a server name resolves to no URL', async function (assert) {
      let { fetchImpl, requested } = fetchAnswering({});
      assert.deepEqual(
        await federationBaseURLs('example.test/../other', fetchImpl),
        [],
      );
      assert.deepEqual(requested, []);
    });
  });
});
