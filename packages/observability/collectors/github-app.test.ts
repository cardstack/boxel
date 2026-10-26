import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';

import { appJwt, githubAppFromEnv } from './github-app.ts';

test('the App JWT is signed with the key and lasts under ten minutes', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwt = appJwt('12345', privateKey, 1_000_000);
  const [header, payload, signature] = jwt.split('.');

  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
    alg: 'RS256',
    typ: 'JWT',
  });
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.deepEqual(claims, { iat: 999_940, exp: 1_000_540, iss: '12345' });
  assert.ok(claims.exp - claims.iat <= 600);
  assert.equal(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    ),
    true,
  );
});

test('no App settings means dry-run', () => {
  assert.equal(githubAppFromEnv({}), null);
});

test('a partial set of App settings is refused', () => {
  assert.throws(
    () => githubAppFromEnv({ SPILL_APP_ID: '1', SPILL_APP_PRIVATE_KEY: 'k' }),
    /SPILL_APP_INSTALLATION_ID/,
  );
});

test('escaped newlines in the private key are restored', () => {
  const config = githubAppFromEnv({
    SPILL_APP_ID: '1',
    SPILL_APP_INSTALLATION_ID: '2',
    SPILL_APP_PRIVATE_KEY: '-----BEGIN KEY-----\\nabc\\n-----END KEY-----',
  });
  assert.equal(
    config?.privateKey,
    '-----BEGIN KEY-----\nabc\n-----END KEY-----',
  );
});
