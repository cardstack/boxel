import QUnit from 'qunit';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHostedIdentityVerifier } from '../lib/hosted-identity.ts';
import {
  createLocalIdentityGrantIssuer,
  createLocalIdentityGrantVerifier,
  type LocalIdentityGrantPolicy,
} from '../lib/local-identity-grant.ts';

const { module, test } = QUnit;
const policy: LocalIdentityGrantPolicy = {
  deviceId: 'device-native-test-123456',
  stackId: 'default',
  localMatrixServerName: 'default.boxel.localhost',
  maxOfflineSeconds: 3600,
};
const binding = {
  hostedUserId: '@alice:stack.cards',
  localUserId: '@alice:default.boxel.localhost',
};
const now = 1_792_888_000;

async function fixture() {
  const keys = generateKeyPairSync('ed25519');
  const proof = {
    matrixServerName: 'stack.cards',
    openIdToken: randomBytes(24).toString('base64url'),
  };
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    const url = new URL(request.url!, 'http://127.0.0.1');
    response.setHeader('Content-Type', 'application/json');
    if (
      url.pathname !== '/_matrix/federation/v1/openid/userinfo' ||
      url.searchParams.get('access_token') !== proof.openIdToken
    ) {
      response.writeHead(401).end('{}');
      return;
    }
    response.end(JSON.stringify({ sub: binding.hostedUserId }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected test listener');
  const hostedVerifier = createHostedIdentityVerifier({
    NODE_ENV: 'test',
    BOXEL_HOSTED_IDENTITY_ISSUERS: JSON.stringify({
      'stack.cards': `http://127.0.0.1:${address.port}/`,
    }),
  });
  const issuer = createLocalIdentityGrantIssuer({
    privateKey: keys.privateKey,
    policy,
    hostedVerifier,
  });
  return {
    ...keys,
    issuer,
    proof,
    hostedVerifier,
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

module('local-identity-grant-test.ts', function () {
  test('issuance snapshots the verified account and proof before awaiting the issuer', async function (assert) {
    const f = await fixture();
    try {
      const mutableBinding = { ...binding };
      const mutableProof = { ...f.proof };
      const pending = f.issuer.issue(mutableBinding, mutableProof, now);
      mutableBinding.hostedUserId = '@other:stack.cards';
      mutableBinding.localUserId = '@other:default.boxel.localhost';
      mutableProof.openIdToken = 'changed';
      const token = await pending;
      const verifier = createLocalIdentityGrantVerifier({
        publicKey: f.publicKey,
        policy,
      });
      assert.deepEqual(
        verifier.verify(token, binding.localUserId, now + 1),
        binding,
      );
      assert.strictEqual(
        verifier.verify(token, mutableBinding.localUserId, now + 1),
        undefined,
      );
    } finally {
      await f.close();
    }
  });

  test('a real hosted proof creates a grant verified offline only for its device, stack and local identity', async function (assert) {
    const f = await fixture();
    let token: string;
    try {
      token = await f.issuer.issue(binding, f.proof, now);
    } finally {
      await f.close();
    }
    const verifier = createLocalIdentityGrantVerifier({
      publicKey: f.publicKey,
      policy,
    });
    assert.deepEqual(
      verifier.verify(token, binding.localUserId, now + 1),
      binding,
    );
    assert.strictEqual(
      f.requests(),
      1,
      'offline verification makes no issuer request',
    );
    assert.strictEqual(
      verifier.verify(token, '@other:default.boxel.localhost', now + 1),
      undefined,
    );
    assert.strictEqual(
      verifier.verify(token, binding.localUserId, now - 1),
      undefined,
    );
    assert.strictEqual(
      verifier.verify(token, binding.localUserId, now + 3600),
      undefined,
    );
    for (const other of [
      { ...policy, stackId: 'other' },
      { ...policy, deviceId: 'another-native-device-123' },
      { ...policy, maxOfflineSeconds: 100 },
    ]) {
      assert.strictEqual(
        createLocalIdentityGrantVerifier({
          publicKey: f.publicKey,
          policy: other,
        }).verify(token, binding.localUserId, now + 1),
        undefined,
      );
    }
  });

  test('tampered payloads, other signing keys and malformed or extra claims are rejected', async function (assert) {
    const f = await fixture();
    try {
      const token = await f.issuer.issue(binding, f.proof, now);
      const verifier = createLocalIdentityGrantVerifier({
        publicKey: f.publicKey,
        policy,
      });
      const [payload, signature] = token.split('.');
      const claims = JSON.parse(
        Buffer.from(payload!, 'base64url').toString('utf8'),
      );
      const changed = Buffer.from(
        JSON.stringify({ ...claims, hostedUserId: '@other:stack.cards' }),
      ).toString('base64url');
      assert.strictEqual(
        verifier.verify(
          changed + '.' + signature,
          binding.localUserId,
          now + 1,
        ),
        undefined,
      );
      const extra = Buffer.from(
        JSON.stringify({ ...claims, permissions: ['write'] }),
      ).toString('base64url');
      const signedExtra =
        extra +
        '.' +
        sign(null, Buffer.from(extra), f.privateKey).toString('base64url');
      assert.strictEqual(
        verifier.verify(signedExtra, binding.localUserId, now + 1),
        undefined,
      );
      const otherKeys = generateKeyPairSync('ed25519');
      assert.strictEqual(
        createLocalIdentityGrantVerifier({
          publicKey: otherKeys.publicKey,
          policy,
        }).verify(token, binding.localUserId, now + 1),
        undefined,
      );
      for (const malformed of [
        null,
        {},
        '',
        'x'.repeat(5000),
        token + '.extra',
        token + '=',
      ]) {
        assert.strictEqual(
          verifier.verify(malformed, binding.localUserId, now + 1),
          undefined,
        );
      }
    } finally {
      await f.close();
    }
  });

  test('issuance requires the exact hosted proof and a local account on the configured homeserver', async function (assert) {
    const f = await fixture();
    try {
      await assert.rejects(
        f.issuer.issue(binding, { ...f.proof, openIdToken: 'invalid' }, now),
        /Cannot verify hosted identity/,
      );
      await assert.rejects(
        f.issuer.issue(
          { ...binding, hostedUserId: '@other:stack.cards' },
          f.proof,
          now,
        ),
        /Cannot verify hosted identity/,
      );
      await assert.rejects(
        f.issuer.issue(
          { ...binding, localUserId: '@alice:other.localhost' },
          f.proof,
          now,
        ),
        /Cannot issue native identity grant/,
      );
      await assert.rejects(
        f.issuer.issue(
          { ...binding, hostedUserId: binding.localUserId },
          f.proof,
          now,
        ),
        /Cannot issue native identity grant/,
      );
      assert.strictEqual(f.requests(), 2);
    } finally {
      await f.close();
    }
  });

  test('unlimited offline use requires an explicit policy on issuer and verifier', async function (assert) {
    const f = await fixture();
    try {
      const unlimited = { ...policy, maxOfflineSeconds: null };
      const issuer = createLocalIdentityGrantIssuer({
        privateKey: f.privateKey,
        policy: unlimited,
        hostedVerifier: f.hostedVerifier,
      });
      const token = await issuer.issue(binding, f.proof, now);
      assert.deepEqual(
        createLocalIdentityGrantVerifier({
          publicKey: f.publicKey,
          policy: unlimited,
        }).verify(token, binding.localUserId, now + 366 * 86400),
        binding,
      );
      assert.strictEqual(
        createLocalIdentityGrantVerifier({
          publicKey: f.publicKey,
          policy,
        }).verify(token, binding.localUserId, now + 1),
        undefined,
      );
      assert.throws(
        () =>
          createLocalIdentityGrantVerifier({
            publicKey: f.publicKey,
            policy: { ...policy, maxOfflineSeconds: 0 },
          }),
        /Invalid native identity grant policy/,
      );
    } finally {
      await f.close();
    }
  });
});
