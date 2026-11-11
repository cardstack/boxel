import QUnit from 'qunit';
import { basename } from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createHostedIdentityVerifier,
  createLocalIdentityVerifier,
} from '../lib/hosted-identity.ts';
import { createLocalIdentityBroker } from '../lib/local-identity-broker.ts';
import { startLocalIdentityServer } from '../lib/local-identity-server.ts';
import {
  createRealmIdentityResolver,
  createMatrixOpenIdTokenVerifier,
  createRealmOwnerNamespace,
} from '../lib/realm-identity.ts';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { fetchSessionRoom, insertPermissions } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB } from './helpers/index.ts';
import { retrieveTokenClaim } from '../utils/jwt.ts';
import handleCreateSession from '../handlers/handle-create-session.ts';
import { realmURLFor } from '../handlers/create-realm.ts';
import { realmDiskPath } from '../lib/realm-disk-path.ts';
import handleDelegateSession from '../handlers/handle-delegate-session.ts';
import { requestDelegatedUserRealmSession } from '@cardstack/runtime-common/user-delegated-realm-server-session';
import { verifyJWT } from '../jwt.ts';
import Koa from 'koa';
import { createLocalIdentityStore } from '../lib/local-identity-store.ts';
import type { NativeSecretEncryption } from '../lib/local-secrets.ts';

const { module, test } = QUnit;
const binding = {
  hostedUserId: '@alice:stack.cards',
  localUserId: '@alice:default.boxel.localhost',
};
const now = 1_792_888_000;
const lifetime = 30 * 24 * 60 * 60;

function encryption(): NativeSecretEncryption {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const bytes = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
    },
    decryptString(value) {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        value.subarray(0, 12),
      );
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([
        decipher.update(value.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

async function fixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'boxel-native-identity-'),
  );
  const proof = {
    matrixServerName: 'stack.cards',
    openIdToken: randomBytes(24).toString('base64url'),
  };
  let requests = 0;
  let closed = false;
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
  const options = {
    directory,
    encryption: encryption(),
    stackId: 'default',
    localMatrixServerName: 'default.boxel.localhost',
    hostedVerifier: createHostedIdentityVerifier({
      NODE_ENV: 'test',
      BOXEL_HOSTED_IDENTITY_ISSUERS: JSON.stringify({
        'stack.cards': `http://127.0.0.1:${address.port}/`,
      }),
    }),
  };
  async function closeIssuer() {
    if (closed) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    closed = true;
  }
  return {
    options,
    proof,
    requests: () => requests,
    closeIssuer,
    async grantFile() {
      const entries = await readdir(path.join(directory, 'identity-grants'));
      if (entries.length !== 1) throw new Error('Expected one persisted grant');
      return path.join(directory, 'identity-grants', entries[0]!);
    },
    async close() {
      await closeIssuer();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function brokerFixture() {
  const f = await fixture();
  const tokens = new Map([
    ['local-account-proof', binding.localUserId],
    ['other-account-proof', '@other:default.boxel.localhost'],
  ]);
  let requests = 0;
  let redirect = false;
  let proofResponse: 'valid' | 'malformed' | 'foreign' | 'oversize' = 'valid';
  const invitations: string[][] = [];
  const server = createServer((request, response) => {
    requests++;
    const url = new URL(request.url!, 'http://127.0.0.1');
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/_matrix/client/v3/login') {
      response.end(
        JSON.stringify({
          user_id: '@realm_server:default.boxel.localhost',
          device_id: 'native-server',
          access_token: 'synthetic-server-token',
        }),
      );
      return;
    }
    if (url.pathname === '/_matrix/client/v3/account/whoami') {
      response.end(
        JSON.stringify({ user_id: '@realm_server:default.boxel.localhost' }),
      );
      return;
    }
    if (url.pathname === '/_matrix/client/v3/createRoom') {
      let body = '';
      request.on('data', (chunk) => (body += chunk.toString()));
      request.on('end', () => {
        invitations.push(JSON.parse(body).invite);
        response.end(
          JSON.stringify({
            room_id: '!linked-session:default.boxel.localhost',
          }),
        );
      });
      return;
    }
    if (url.pathname.startsWith('/_matrix/client/v3/rooms/')) {
      response.end(request.method === 'GET' ? '[]' : '{}');
      return;
    }
    if (redirect) {
      response.writeHead(302, { Location: '/leak' }).end();
      return;
    }
    const subject = tokens.get(url.searchParams.get('access_token') ?? '');
    if (url.pathname !== '/_matrix/federation/v1/openid/userinfo' || !subject) {
      response.writeHead(401).end('{}');
      return;
    }
    if (proofResponse === 'malformed')
      response.end('invalid JSON containing synthetic local-account-proof');
    else if (proofResponse === 'oversize') response.end('x'.repeat(20000));
    else
      response.end(
        JSON.stringify({
          sub: proofResponse === 'foreign' ? '@alice:foreign.example' : subject,
        }),
      );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected local test listener');
  const store = await createLocalIdentityStore(f.options);
  const broker = createLocalIdentityBroker({
    store,
    localVerifier: createLocalIdentityVerifier({
      matrixURL: `http://127.0.0.1:${address.port}/`,
      matrixServerName: f.options.localMatrixServerName,
    }),
  });
  const localProof = {
    matrixServerName: f.options.localMatrixServerName,
    openIdToken: 'local-account-proof',
  };
  const request = { ...binding, hostedProof: f.proof, localProof };
  return {
    ...f,
    broker,
    store,
    localProof,
    request,
    matrixURL: `http://127.0.0.1:${address.port}/`,
    invitations,
    proofResponse: (mode: typeof proofResponse) => {
      proofResponse = mode;
    },
    localRequests: () => requests,
    redirect: () => {
      redirect = true;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await f.close();
    },
  };
}

module(basename(import.meta.filename), function () {
  test('a verified binding survives restart and resolves offline until the 30-day boundary', async function (assert) {
    const f = await fixture();
    try {
      const first = await createLocalIdentityStore(f.options);
      assert.deepEqual(await first.link(binding, f.proof, now), binding);
      await f.closeIssuer();
      const restarted = await createLocalIdentityStore(f.options);
      assert.deepEqual(
        await restarted.resolve(binding.localUserId, now + lifetime - 1),
        binding,
      );
      assert.strictEqual(
        await restarted.resolve(binding.localUserId, now + lifetime),
        undefined,
      );
      assert.strictEqual(
        await restarted.resolve(binding.localUserId, now - 1),
        undefined,
      );
      assert.strictEqual(
        await restarted.resolve('@other:default.boxel.localhost', now + 1),
        undefined,
      );
      assert.strictEqual(
        f.requests(),
        1,
        'offline recovery makes no hosted request',
      );
      const keyBytes = await readFile(
        path.join(f.options.directory, 'identity-key.bin'),
      );
      const grantBytes = await readFile(await f.grantFile());
      assert.false(keyBytes.includes(Buffer.from('PRIVATE KEY')));
      assert.false(grantBytes.includes(Buffer.from(binding.hostedUserId)));
      assert.false(grantBytes.includes(Buffer.from(f.proof.openIdToken)));
      assert.strictEqual((await stat(await f.grantFile())).mode & 0o777, 0o600);
    } finally {
      await f.close();
    }
  });

  test('expired grants renew only after a new verified hosted proof', async function (assert) {
    const f = await fixture();
    try {
      const store = await createLocalIdentityStore(f.options);
      await store.link(binding, f.proof, now);
      await assert.rejects(
        store.link(
          binding,
          { ...f.proof, openIdToken: 'invalid' },
          now + lifetime,
        ),
        /Cannot verify hosted identity/,
      );
      assert.strictEqual(
        await store.resolve(binding.localUserId, now + lifetime),
        undefined,
      );
      await store.link(binding, f.proof, now + lifetime);
      const restarted = await createLocalIdentityStore(f.options);
      assert.deepEqual(
        await restarted.resolve(binding.localUserId, now + lifetime + 1),
        binding,
      );
      assert.strictEqual(f.requests(), 3);
    } finally {
      await f.close();
    }
  });

  test('a different hosted account cannot replace a binding, even after expiry', async function (assert) {
    const f = await fixture();
    try {
      const store = await createLocalIdentityStore(f.options);
      await store.link(binding, f.proof, now);
      const restarted = await createLocalIdentityStore(f.options);
      await assert.rejects(
        restarted.link(
          { ...binding, hostedUserId: '@other:stack.cards' },
          f.proof,
          now + lifetime,
        ),
        /already linked/,
      );
      assert.strictEqual(f.requests(), 1);
      assert.deepEqual(
        await restarted.resolve(binding.localUserId, now + 1),
        binding,
      );
    } finally {
      await f.close();
    }
  });

  test('concurrent initialization converges on one key and concurrent different accounts retain both grants', async function (assert) {
    const f = await fixture();
    try {
      const [left, right] = await Promise.all([
        createLocalIdentityStore(f.options),
        createLocalIdentityStore(f.options),
      ]);
      const second = {
        ...binding,
        localUserId: '@second:default.boxel.localhost',
      };
      await Promise.all([
        left.link(binding, f.proof, now),
        right.link(second, f.proof, now),
      ]);
      const restarted = await createLocalIdentityStore(f.options);
      assert.deepEqual(
        await restarted.resolve(binding.localUserId, now + 1),
        binding,
      );
      assert.deepEqual(
        await restarted.resolve(second.localUserId, now + 1),
        second,
      );
      assert.strictEqual(
        (await readdir(path.join(f.options.directory, 'identity-grants')))
          .length,
        2,
      );
      assert.strictEqual(
        (await readdir(f.options.directory)).filter((name) =>
          name.endsWith('.tmp'),
        ).length,
        0,
      );
    } finally {
      await f.close();
    }
  });

  test('corrupt ciphertext or an unavailable encryption backend never replaces the signing key', async function (assert) {
    const f = await fixture();
    try {
      await createLocalIdentityStore(f.options);
      const file = path.join(f.options.directory, 'identity-key.bin');
      const corrupt = randomBytes(100);
      await writeFile(file, corrupt);
      await assert.rejects(
        createLocalIdentityStore(f.options),
        /Cannot unlock native identity/,
      );
      await assert.rejects(
        createLocalIdentityStore({
          ...f.options,
          encryption: {
            ...f.options.encryption,
            isEncryptionAvailable: () => false,
          },
        }),
        /storage is unavailable/,
      );
      assert.deepEqual(await readFile(file), corrupt);
    } finally {
      await f.close();
    }
  });

  test('missing keys with existing grants fail instead of silently creating a new device', async function (assert) {
    const f = await fixture();
    try {
      const store = await createLocalIdentityStore(f.options);
      await store.link(binding, f.proof, now);
      const grant = await readFile(await f.grantFile());
      await unlink(path.join(f.options.directory, 'identity-key.bin'));
      await assert.rejects(
        createLocalIdentityStore(f.options),
        /key is missing/,
      );
      assert.deepEqual(await readFile(await f.grantFile()), grant);
    } finally {
      await f.close();
    }
  });

  test('a store cannot be opened as a different stack, homeserver or encryption identity', async function (assert) {
    const f = await fixture();
    try {
      const store = await createLocalIdentityStore(f.options);
      await store.link(binding, f.proof, now);
      await assert.rejects(
        createLocalIdentityStore({ ...f.options, stackId: 'other' }),
        /Invalid native identity key/,
      );
      await assert.rejects(
        createLocalIdentityStore({
          ...f.options,
          localMatrixServerName: 'other.boxel.localhost',
        }),
        /Invalid native identity key/,
      );
      await assert.rejects(
        createLocalIdentityStore({ ...f.options, encryption: encryption() }),
        /Cannot unlock native identity/,
      );
      assert.deepEqual(
        await store.resolve(binding.localUserId, now + 1),
        binding,
      );
    } finally {
      await f.close();
    }
  });

  test('loose file permissions and symbolic links fail closed without following the target', async function (assert) {
    const f = await fixture();
    try {
      const store = await createLocalIdentityStore(f.options);
      await store.link(binding, f.proof, now);
      const file = await f.grantFile();
      const encrypted = await readFile(file);
      await chmod(file, 0o644);
      await assert.rejects(
        store.resolve(binding.localUserId, now + 1),
        /Cannot unlock native identity/,
      );
      await chmod(file, 0o600);
      const target = path.join(f.options.directory, 'target.bin');
      await writeFile(target, encrypted, { mode: 0o600 });
      await unlink(file);
      await symlink(target, file);
      await assert.rejects(
        store.resolve(binding.localUserId, now + 1),
        /Cannot unlock native identity/,
      );
      assert.deepEqual(await readFile(target), encrypted);
    } finally {
      await f.close();
    }
  });

  test('corrupt grants fail without being replaced and account filenames are never supplied by the caller', async function (assert) {
    const f = await fixture();
    try {
      const store = await createLocalIdentityStore(f.options);
      await store.link(binding, f.proof, now);
      const file = await f.grantFile();
      const corrupt = randomBytes(100);
      await writeFile(file, corrupt);
      await assert.rejects(
        store.resolve(binding.localUserId, now + 1),
        /Cannot unlock native identity/,
      );
      await assert.rejects(
        store.link(binding, f.proof, now + 1),
        /Cannot unlock native identity/,
      );
      await assert.rejects(
        store.resolve('@alice:other.localhost', now),
        /Invalid linked local account/,
      );
      await assert.rejects(
        store.resolve('../../identity-key.bin', now),
        /Invalid linked local account/,
      );
      assert.deepEqual(await readFile(file), corrupt);
      assert.strictEqual(f.requests(), 1);
    } finally {
      await f.close();
    }
  });
});

module(`${basename(import.meta.filename)} | local proof broker`, function () {
  test('both accounts must be proved before linking, and local-only refresh distinguishes expired from unlinked', async function (assert) {
    const f = await brokerFixture();
    try {
      await assert.rejects(
        f.broker.link(
          {
            ...f.request,
            localProof: { ...f.localProof, openIdToken: 'invalid' },
          },
          now,
        ),
        /Cannot verify local identity/,
      );
      assert.false(await f.store.isLinked(binding.localUserId));
      assert.strictEqual(
        f.requests(),
        0,
        'bad local proof never reaches the hosted issuer',
      );
      await assert.rejects(
        f.broker.link(
          { ...f.request, localUserId: '@other:default.boxel.localhost' },
          now,
        ),
        /Cannot verify local identity/,
      );
      assert.false(await f.store.isLinked('@other:default.boxel.localhost'));
      await assert.rejects(
        f.broker.link(
          { ...f.request, hostedProof: { ...f.proof, openIdToken: 'invalid' } },
          now,
        ),
        /Cannot verify hosted identity/,
      );
      assert.false(await f.store.isLinked(binding.localUserId));
      assert.deepEqual(await f.broker.link(f.request, now), binding);
      await f.closeIssuer();
      assert.deepEqual(
        await f.broker.resolve(
          { localUserId: binding.localUserId, localProof: f.localProof },
          now + 1,
        ),
        { kind: 'verified', binding },
      );
      assert.deepEqual(
        await f.broker.resolve(
          { localUserId: binding.localUserId, localProof: f.localProof },
          now + lifetime,
        ),
        { kind: 'requires-verification', localUserId: binding.localUserId },
      );
      assert.deepEqual(
        await f.broker.resolve(
          {
            localUserId: '@other:default.boxel.localhost',
            localProof: { ...f.localProof, openIdToken: 'other-account-proof' },
          },
          now + 1,
        ),
        { kind: 'unlinked', localUserId: '@other:default.boxel.localhost' },
      );
      assert.strictEqual(
        f.requests(),
        2,
        'offline refresh never contacts the hosted issuer',
      );
    } finally {
      await f.close();
    }
  });

  test('the broker snapshots both identities and proofs before the local HTTP check', async function (assert) {
    const f = await brokerFixture();
    try {
      const request = {
        ...f.request,
        localProof: { ...f.localProof },
        hostedProof: { ...f.proof },
      };
      const pending = f.broker.link(request, now);
      request.localUserId = '@other:default.boxel.localhost';
      request.hostedUserId = '@other:stack.cards';
      request.localProof.openIdToken = 'changed';
      request.hostedProof.openIdToken = 'changed';
      assert.deepEqual(await pending, binding);
      assert.deepEqual(
        await f.store.resolve(binding.localUserId, now + 1),
        binding,
      );
    } finally {
      await f.close();
    }
  });

  test('a local proof from another issuer, a redirect or an invalid request grants no link', async function (assert) {
    const f = await brokerFixture();
    try {
      for (const request of [
        null,
        {},
        { ...f.request, localUserId: 1 },
        { ...f.request, localProof: {} },
        {
          ...f.request,
          hostedProof: { ...f.proof, openIdToken: 'x'.repeat(8193) },
        },
        { ...f.request, permissions: ['realm-owner'] },
      ]) {
        await assert.rejects(
          f.broker.link(request, now),
          /Invalid .* identity proof/,
        );
      }
      assert.strictEqual(f.localRequests(), 0);
      await assert.rejects(
        f.broker.link(
          {
            ...f.request,
            localProof: {
              ...f.localProof,
              matrixServerName: 'other.localhost',
            },
          },
          now,
        ),
        /Cannot verify local identity/,
      );
      assert.strictEqual(
        f.localRequests(),
        0,
        'unconfigured homeservers receive no proof',
      );
      f.redirect();
      await assert.rejects(
        f.broker.link(f.request, now),
        /Cannot verify local identity/,
      );
      assert.strictEqual(f.localRequests(), 1, 'the proof was not redirected');
      assert.strictEqual(f.requests(), 0);
      assert.false(await f.store.isLinked(binding.localUserId));
    } finally {
      await f.close();
    }
  });

  test('resolving a stored link requires a fresh local proof and rejects caller-supplied overrides', async function (assert) {
    const f = await brokerFixture();
    try {
      await f.broker.link(f.request, now);
      await assert.rejects(
        f.broker.resolve(
          {
            localUserId: binding.localUserId,
            localProof: { ...f.localProof, openIdToken: 'other-account-proof' },
          },
          now + 1,
        ),
        /Cannot verify local identity/,
      );
      await assert.rejects(
        f.broker.resolve(
          {
            localUserId: binding.localUserId,
            localProof: f.localProof,
            hostedUserId: '@other:stack.cards',
          },
          now + 1,
        ),
        /Invalid local identity proof/,
      );
      assert.strictEqual(f.requests(), 1);
    } finally {
      await f.close();
    }
  });

  test('the local verifier accepts only an explicit literal loopback origin', function (assert) {
    for (const matrixURL of [
      'http://example.com/',
      'https://127.0.0.1/',
      'http://localhost/',
      'http://127.0.0.1/path/',
      'http://user:secret@127.0.0.1/',
      'http://127.0.0.1/?proof=x',
      'http://127.0.0.1/#x',
    ]) {
      assert.throws(
        () =>
          createLocalIdentityVerifier({
            matrixURL,
            matrixServerName: 'default.boxel.localhost',
          }),
        /configured loopback origin/,
      );
    }
  });
});

module(
  `${basename(import.meta.filename)} | private native listener`,
  function () {
    test('the listener refuses page-origin, missing-authority, rebinding and oversized requests', async function (assert) {
      const f = await brokerFixture();
      const secret = randomBytes(32).toString('hex');
      const listener = await startLocalIdentityServer({
        broker: f.broker,
        hostedLogin: null,
        secret,
        port: 0,
      });
      const headers = {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      };
      try {
        for (const requestHeaders of [
          { 'Content-Type': 'application/json' },
          { ...headers, Origin: 'http://app.default.boxel.localhost:4242' },
          { ...headers, 'Sec-Fetch-Site': 'same-origin' },
          { ...headers, Host: 'rebinding.example' },
        ]) {
          const status = await new Promise<number | undefined>(
            (resolve, reject) => {
              const request = httpRequest(
                new URL('v1/resolve-verified', listener.url),
                { method: 'POST', headers: requestHeaders },
                (response) => {
                  response.resume();
                  resolve(response.statusCode);
                },
              );
              request.once('error', reject);
              request.end(JSON.stringify({ localUserId: binding.localUserId }));
            },
          );
          assert.strictEqual(
            status,
            401,
            Object.keys(requestHeaders).join(', '),
          );
        }
        for (const [route, body, status] of [
          ['v1/resolve-verified?proof=not-allowed', '{}', 404],
          ['v1/resolve-verified', '{', 400],
          ['v1/resolve-verified', 'x'.repeat(32769), 413],
          [
            'v1/resolve-verified',
            JSON.stringify({
              localUserId: binding.localUserId,
              hostedUserId: binding.hostedUserId,
            }),
            400,
          ],
        ] as const) {
          const response = await fetch(new URL(route, listener.url), {
            method: 'POST',
            headers,
            body,
          });
          assert.strictEqual(response.status, status);
          await response.body?.cancel();
        }
        assert.strictEqual(f.requests(), 0);
        assert.strictEqual(f.localRequests(), 0);
        const response = await fetch(new URL('v1/link', listener.url), {
          method: 'POST',
          headers,
          body: JSON.stringify(f.request),
        });
        assert.strictEqual(response.status, 200);
        assert.deepEqual(await response.json(), binding);
        assert.strictEqual(response.headers.get('cache-control'), 'no-store');
        const resolver = createRealmIdentityResolver({
          BOXEL_LOCAL_IDENTITY_BROKER_URL: listener.url,
          BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
        });
        await f.closeIssuer();
        assert.deepEqual(await resolver(binding.localUserId), {
          user: binding.hostedUserId,
          matrixUser: binding.localUserId,
        });
      } finally {
        await listener.stop();
        await f.close();
      }
    });

    test('incomplete configuration and a dead native listener never fall back to local identity', async function (assert) {
      const secret = randomBytes(32).toString('hex');
      for (const env of [
        { BOXEL_LOCAL_IDENTITY_BROKER_URL: 'http://127.0.0.1:1/' },
        { BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret },
        {
          BOXEL_LOCAL_IDENTITY_BROKER_URL: 'http://outside.example/',
          BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
        },
        {
          BOXEL_LOCAL_IDENTITY_BROKER_URL: 'http://127.0.0.1:1/?secret=x',
          BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
        },
      ]) {
        assert.throws(
          () => createRealmIdentityResolver(env),
          /Invalid native identity broker configuration/,
        );
      }
      const f = await brokerFixture();
      const listener = await startLocalIdentityServer({
        broker: f.broker,
        hostedLogin: null,
        secret,
        port: 0,
      });
      const resolver = createRealmIdentityResolver({
        BOXEL_LOCAL_IDENTITY_BROKER_URL: listener.url,
        BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
      });
      await listener.stop();
      try {
        await assert.rejects(
          resolver(binding.localUserId),
          /Native identity resolution unavailable/,
        );
        assert.deepEqual(
          await createRealmIdentityResolver({})(binding.localUserId),
          { user: binding.localUserId, matrixUser: binding.localUserId },
        );
      } finally {
        await f.close();
      }
    });
  },
);

module(
  `${basename(import.meta.filename)} | realm-server sessions`,
  function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    for (const kind of ['verified', 'expired', 'unlinked'] as const) {
      test(`${kind} binding uses the correct realm subject and local session room`, async function (assert) {
        const f = await brokerFixture();
        const secret = randomBytes(32).toString('hex');
        const realmSecretSeed = randomBytes(32).toString('hex');
        const linkedAt = Math.floor(Date.now() / 1000);
        if (kind !== 'unlinked')
          await f.broker.link(
            f.request,
            linkedAt - (kind === 'expired' ? lifetime : 0),
          );
        await f.closeIssuer();
        const listener = await startLocalIdentityServer({
          broker: f.broker,
          hostedLogin: null,
          secret,
          port: 0,
        });
        const matrixClient = new MatrixClient({
          matrixURL: new URL(f.matrixURL),
          serverName: f.options.localMatrixServerName,
          username: 'realm_server',
          password: 'synthetic-password',
        });
        const resolveMatrixRealmIdentity = createRealmIdentityResolver({
          BOXEL_LOCAL_IDENTITY_BROKER_URL: listener.url,
          BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
        });
        const server = createServer(
          new Koa()
            .use(
              handleCreateSession({
                dbAdapter,
                matrixClient,
                realmSecretSeed,
                resolveMatrixRealmIdentity,
                verifyMatrixOpenIdToken: createMatrixOpenIdTokenVerifier({
                  BOXEL_LOCAL_IDENTITY_BROKER_URL: listener.url,
                  BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
                  MATRIX_URL: f.matrixURL,
                  MATRIX_SERVER_NAME: f.options.localMatrixServerName,
                }),
              }),
            )
            .callback(),
        );
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('Expected auth listener');
        try {
          const response = await fetch(
            `http://127.0.0.1:${address.port}/_server-session`,
            {
              method: 'POST',
              body: JSON.stringify({ access_token: f.localProof.openIdToken }),
            },
          );
          assert.strictEqual(response.status, kind === 'expired' ? 400 : 201);
          if (kind === 'expired') {
            assert.strictEqual(response.headers.get('Authorization'), null);
            assert.deepEqual(f.invitations, []);
            assert.strictEqual(
              await fetchSessionRoom(dbAdapter, binding.hostedUserId),
              null,
            );
            assert.strictEqual(
              await fetchSessionRoom(dbAdapter, binding.localUserId),
              null,
            );
          } else {
            const expectedUser =
              kind === 'verified' ? binding.hostedUserId : binding.localUserId;
            const claims = retrieveTokenClaim(
              response.headers.get('Authorization')!,
              realmSecretSeed,
            );
            assert.strictEqual(claims.user, expectedUser);
            assert.strictEqual(
              claims.sessionRoom,
              '!linked-session:default.boxel.localhost',
            );
            assert.deepEqual(
              f.invitations,
              [[binding.localUserId]],
              'the DM stays on Tuwunel',
            );
            assert.strictEqual(
              await fetchSessionRoom(dbAdapter, expectedUser),
              claims.sessionRoom,
            );
            if (kind === 'verified')
              assert.strictEqual(
                await fetchSessionRoom(dbAdapter, binding.localUserId),
                null,
              );
          }
          await response.body?.cancel();
          assert.strictEqual(
            f.requests(),
            kind === 'unlinked' ? 0 : 1,
            'the server session needed no hosted network',
          );
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
          await listener.stop();
          await f.close();
        }
      });
    }
  },
);

module(`${basename(import.meta.filename)} | AI delegation`, function (hooks) {
  let dbAdapter: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  for (const kind of [
    'verified',
    'expired',
    'local-permission-only',
  ] as const) {
    test(`${kind} delegation respects hosted permissions and keeps the token read-only`, async function (assert) {
      const f = await brokerFixture();
      const secret = randomBytes(32).toString('hex');
      const realmSecretSeed = randomBytes(32).toString('hex');
      const aiBotDelegationSecret = randomBytes(32).toString('hex');
      const realm = new URL(
        'http://realm.default.boxel.localhost:4242/identity-test/',
      );
      const linkedAt =
        Math.floor(Date.now() / 1000) - (kind === 'expired' ? lifetime : 0);
      await f.broker.link(f.request, linkedAt);
      await f.closeIssuer();
      await insertPermissions(dbAdapter, realm, {
        [kind === 'local-permission-only'
          ? binding.localUserId
          : binding.hostedUserId]: ['read', 'write', 'realm-owner'],
      });
      const listener = await startLocalIdentityServer({
        broker: f.broker,
        hostedLogin: null,
        secret,
        port: 0,
      });
      const matrixClient = new MatrixClient({
        matrixURL: new URL(f.matrixURL),
        serverName: f.options.localMatrixServerName,
        username: 'realm_server',
        password: 'synthetic-password',
      });
      const resolveMatrixRealmIdentity = createRealmIdentityResolver({
        BOXEL_LOCAL_IDENTITY_BROKER_URL: listener.url,
        BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
      });
      const server = createServer(
        new Koa()
          .use(
            handleDelegateSession({
              dbAdapter,
              matrixClient,
              realmSecretSeed,
              serverURL: realm.origin + '/',
              aiBotDelegationSecret,
              resolveMatrixRealmIdentity,
            }),
          )
          .callback(),
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Expected delegation listener');
      try {
        const request = requestDelegatedUserRealmSession({
          realmServerURL: `http://127.0.0.1:${address.port}/`,
          secret: aiBotDelegationSecret,
          onBehalfOf: binding.localUserId,
          realm: realm.href,
        });
        if (kind === 'verified') {
          const session = await request;
          const claims = verifyJWT(session.token, realmSecretSeed);
          assert.strictEqual(claims.user, binding.hostedUserId);
          assert.strictEqual(claims.realm, realm.href);
          assert.true(claims.delegated);
          assert.deepEqual(claims.permissions, ['read']);
        } else {
          await assert.rejects(
            request,
            new RegExp(
              `delegation request rejected \\(${kind === 'expired' ? 401 : 403}\\)`,
            ),
          );
        }
        assert.strictEqual(
          f.requests(),
          1,
          'delegation used the saved offline grant',
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await listener.stop();
        await f.close();
      }
    });
  }
});

module(
  `${basename(import.meta.filename)} | native proof privacy`,
  function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });
    for (const mode of ['malformed', 'foreign', 'oversize'] as const) {
      test(`${mode} OpenID response never exposes the native proof or issues a session`, async function (assert) {
        const f = await brokerFixture();
        f.proofResponse(mode);
        const secret = randomBytes(32).toString('hex');
        const environment = {
          BOXEL_LOCAL_IDENTITY_BROKER_URL: 'http://127.0.0.1:1/',
          BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
          MATRIX_URL: f.matrixURL,
          MATRIX_SERVER_NAME: f.options.localMatrixServerName,
        };
        const matrixClient = new MatrixClient({
          matrixURL: new URL(f.matrixURL),
          serverName: f.options.localMatrixServerName,
          username: 'realm_server',
          password: 'synthetic-password',
        });
        const server = createServer(
          new Koa()
            .use(
              handleCreateSession({
                dbAdapter,
                matrixClient,
                realmSecretSeed: secret,
                resolveMatrixRealmIdentity:
                  createRealmIdentityResolver(environment),
                verifyMatrixOpenIdToken:
                  createMatrixOpenIdTokenVerifier(environment),
              }),
            )
            .callback(),
        );
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('Expected privacy test listener');
        const originalError = console.error;
        const errors: string[] = [];
        console.error = (...values: unknown[]) =>
          errors.push(values.map(String).join(' '));
        try {
          const response = await fetch(
            `http://127.0.0.1:${address.port}/_server-session`,
            {
              method: 'POST',
              body: JSON.stringify({ access_token: f.localProof.openIdToken }),
            },
          );
          assert.strictEqual(response.status, 400);
          assert.strictEqual(response.headers.get('Authorization'), null);
          const text = await response.text();
          for (const value of [
            f.localProof.openIdToken,
            f.matrixURL,
            'openid/userinfo',
          ]) {
            assert.false(text.includes(value));
            assert.false(errors.join('\n').includes(value));
          }
          assert.deepEqual(f.invitations, []);
          assert.strictEqual(
            await fetchSessionRoom(dbAdapter, binding.localUserId),
            null,
          );
          assert.strictEqual(f.requests(), 0);
        } finally {
          console.error = originalError;
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
          await f.close();
        }
      });
    }
  },
);

module(`${basename(import.meta.filename)} | owner namespaces`, function () {
  const environment = {
    BOXEL_LOCAL_IDENTITY_BROKER_URL: 'http://127.0.0.1:1/',
    BOXEL_LOCAL_IDENTITY_BROKER_SECRET: 'a'.repeat(64),
    MATRIX_SERVER_NAME: 'default.boxel.localhost',
  };

  test('the configured local user keeps its path while hosted homonyms get separate URLs and disk roots', function (assert) {
    const namespace = createRealmOwnerNamespace(environment);
    const serverURL = new URL('http://realm.default.boxel.localhost:4242/');
    const root = '/private/tmp/boxel-owner-namespace-tests';
    assert.strictEqual(
      realmURLFor(serverURL, namespace(binding.localUserId), 'personal'),
      serverURL.href + 'alice/personal/',
    );
    const users = [
      '@alice:boxel.ai',
      '@alice:stack.cards',
      '@alice:boxel.ai:8448',
      '@CAROL:boxel.ai',
      '@alice:Boxel.ai',
      '@matrix:default.boxel.localhost',
      '@..:boxel.ai',
      '@alice/../../etc:boxel.ai',
    ];
    const diskPaths = new Set<string>();
    for (const user of users) {
      const ownerNamespace = namespace(user);
      const url = new URL(realmURLFor(serverURL, ownerNamespace, 'personal'));
      const disk = realmDiskPath(
        { kind: 'source', disk_id: `${ownerNamespace}/personal` },
        root,
      );
      assert.true(url.pathname.startsWith('/matrix/'));
      assert.strictEqual(disk, path.resolve(root, ownerNamespace, 'personal'));
      assert.true(disk!.startsWith(root + '/matrix/'));
      assert.false(
        diskPaths.has(disk!.toLowerCase()),
        'case-insensitive filesystems do not merge identities',
      );
      diskPaths.add(disk!.toLowerCase());
    }
    assert.true(namespace('@alice:boxel.ai').includes('/boxel.ai/'));
    assert.true(namespace('@alice:stack.cards').includes('/stack.cards/'));
  });

  test('namespace selection uses the configured server name and preserves existing hosted defaults', function (assert) {
    assert.strictEqual(
      createRealmOwnerNamespace({})('@alice:boxel.ai'),
      'alice',
    );
    const namespace = createRealmOwnerNamespace({
      ...environment,
      MATRIX_SERVER_NAME: 'boxel.ai',
    });
    assert.strictEqual(namespace('@alice:boxel.ai'), 'alice');
    assert.true(
      namespace(binding.localUserId).startsWith(
        'matrix/default.boxel.localhost/',
      ),
    );
    assert.throws(
      () =>
        createRealmOwnerNamespace({
          ...environment,
          MATRIX_SERVER_NAME: undefined,
        }),
      /configured Matrix server name/,
    );
    for (const user of [
      'alice',
      '@alice:..',
      '@alice:.',
      '@alice:outside/path',
      '@:boxel.ai',
    ]) {
      assert.throws(() => namespace(user), /Invalid realm owner/);
    }
  });
});
