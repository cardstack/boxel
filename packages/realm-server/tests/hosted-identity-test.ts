import QUnit from 'qunit';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createHostedIdentityVerifier } from '../lib/hosted-identity.ts';
import { isGuardedCall } from '../lib/outbound/guarded-call-context.ts';

const { module, test } = QUnit;
module('hosted-identity-test.ts', function () {
  test('only the configured issuer can prove the exact hosted MXID, without redirecting', async function (assert) {
    let proof = randomBytes(32).toString('base64url');
    let mode:
      | 'valid'
      | 'other-user'
      | 'other-server'
      | 'redirect'
      | 'malformed'
      | 'oversize' = 'valid';
    let requests = 0;
    let queryToken: string | null = null;
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      requests++;
      let url = new URL(request.url!, 'http://localhost');
      queryToken = url.searchParams.get('access_token');
      authorization = request.headers.authorization;
      assert.strictEqual(
        url.pathname,
        '/_matrix/federation/v1/openid/userinfo',
      );
      if (mode === 'redirect') {
        response.writeHead(302, { Location: '/leak' }).end();
        return;
      }
      if (mode === 'malformed') {
        response.end(`not JSON ${proof}`);
        return;
      }
      if (mode === 'oversize') {
        response.end('x'.repeat(20_000));
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          sub:
            mode === 'other-user'
              ? '@other:stack.cards'
              : mode === 'other-server'
                ? '@alice:evil.test'
                : '@alice:stack.cards',
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP listener');
    let verifier = createHostedIdentityVerifier({
      NODE_ENV: 'test',
      BOXEL_HOSTED_IDENTITY_ISSUERS: JSON.stringify({
        'stack.cards': `http://127.0.0.1:${address.port}`,
      }),
    });
    try {
      assert.strictEqual(
        await verifier.verify(
          { matrixServerName: 'stack.cards', openIdToken: proof },
          '@alice:stack.cards',
        ),
        '@alice:stack.cards',
      );
      assert.strictEqual(queryToken, proof);
      assert.strictEqual(authorization, undefined);
      for (let invalid of [
        'other-user',
        'other-server',
        'redirect',
        'malformed',
        'oversize',
      ] as const) {
        mode = invalid;
        assert.strictEqual(
          await verifier.verify(
            { matrixServerName: 'stack.cards', openIdToken: proof },
            '@alice:stack.cards',
          ),
          undefined,
          invalid,
        );
      }
      assert.strictEqual(requests, 6, 'the redirect was never followed');
      assert.strictEqual(
        await verifier.verify(
          { matrixServerName: 'evil.test', openIdToken: proof },
          '@alice:stack.cards',
        ),
        undefined,
      );
      assert.strictEqual(
        requests,
        6,
        'an unconfigured issuer receives no proof',
      );
      assert.false(
        isGuardedCall(),
        'guard context does not leak into the caller',
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('hosted endpoints require HTTPS and fail closed on incomplete configuration', function (assert) {
    for (let config of [
      undefined,
      '',
      '{}',
      '[]',
      '{"stack.cards":"http://example.com"}',
      '{"stack.cards":"https://user:secret@example.com"}',
      '{"stack.cards":"https://example.com/?secret=x"}',
    ]) {
      assert.throws(() =>
        createHostedIdentityVerifier({ BOXEL_HOSTED_IDENTITY_ISSUERS: config }),
      );
    }
    assert.ok(
      createHostedIdentityVerifier({
        BOXEL_HOSTED_IDENTITY_ISSUERS:
          '{"stack.cards":"https://matrix.stack.cards"}',
      }),
    );
  });
});
