import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  GoogleServiceAccountKeyError,
  GoogleServiceAccountRejectedError,
  GoogleTokenEndpointUnavailableError,
  configureGoogleTokens,
  deserializeGoogleServiceAccount,
  googleAccessToken,
  parseGoogleServiceAccountKey,
  resetGoogleTokens,
  serializeGoogleServiceAccount,
  signGoogleAssertion,
  type GoogleServiceAccountCredential,
} from '../lib/outbound/google-service-account.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { logLinesDuring } from './helpers/log-capture.ts';

// A Google service account's key file mints access tokens: the platform signs
// a JWT with its private key and exchanges it at the token endpoint. These
// tests run that against a stub token endpoint.

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function keyFile(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'boxel-test',
    private_key_id: 'kid-0123456789',
    private_key: PRIVATE_KEY_PEM,
    client_email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
    client_id: '1234567890',
    token_uri: 'https://elsewhere.example/token',
    ...overrides,
  });
}

function credential(
  overrides: Partial<GoogleServiceAccountCredential> = {},
): GoogleServiceAccountCredential {
  return {
    ...parseGoogleServiceAccountKey({ keyFile: keyFile(), scopes: SCOPES }),
    ...overrides,
  };
}

function decodeSegment(segment: string) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function keyErrorOf(fn: () => unknown): GoogleServiceAccountKeyError {
  try {
    fn();
  } catch (e) {
    if (e instanceof GoogleServiceAccountKeyError) {
      return e;
    }
    throw e;
  }
  throw new Error('expected the key to be refused');
}

module(basename(import.meta.filename), function () {
  module('reading a key file', function () {
    test('keeps what minting needs, with the subject and scopes', function (assert) {
      let parsed = parseGoogleServiceAccountKey({
        keyFile: keyFile(),
        subject: ' owner@example.com ',
        scopes: [...SCOPES, ...SCOPES, 'openid'],
      });
      assert.deepEqual(
        {
          clientEmail: parsed.clientEmail,
          privateKeyId: parsed.privateKeyId,
          subject: parsed.subject,
          scopes: parsed.scopes,
        },
        {
          clientEmail: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
          privateKeyId: 'kid-0123456789',
          subject: 'owner@example.com',
          scopes: [...SCOPES, 'openid'],
        },
      );
      assert.strictEqual(parsed.privateKey, PRIVATE_KEY_PEM);
      assert.deepEqual(
        deserializeGoogleServiceAccount(serializeGoogleServiceAccount(parsed)),
        parsed,
        'the sealed form reads back as the same credential',
      );
    });

    test('a blank subject acts as the service account itself', function (assert) {
      let parsed = parseGoogleServiceAccountKey({
        keyFile: keyFile(),
        subject: '  ',
        scopes: SCOPES,
      });
      assert.strictEqual(parsed.subject, null);
    });

    test('refuses what is not a usable service account key, without quoting it', function (assert) {
      let cases: [string, () => unknown, RegExp][] = [
        [
          'not JSON',
          () =>
            parseGoogleServiceAccountKey({
              keyFile: `{"private_key": "${PRIVATE_KEY_PEM.slice(0, 80)}`,
              scopes: SCOPES,
            }),
          /not valid JSON/,
        ],
        [
          'another kind of key file',
          () =>
            parseGoogleServiceAccountKey({
              keyFile: keyFile({ type: 'authorized_user' }),
              scopes: SCOPES,
            }),
          /not a service account key file/,
        ],
        [
          'no email',
          () =>
            parseGoogleServiceAccountKey({
              keyFile: keyFile({ client_email: undefined }),
              scopes: SCOPES,
            }),
          /client_email/,
        ],
        [
          'not an RSA key',
          () =>
            parseGoogleServiceAccountKey({
              keyFile: keyFile({
                private_key: generateKeyPairSync('ed25519')
                  .privateKey.export({ type: 'pkcs8', format: 'pem' })
                  .toString(),
              }),
              scopes: SCOPES,
            }),
          /not an RSA private key/,
        ],
        [
          'a mangled key',
          () =>
            parseGoogleServiceAccountKey({
              keyFile: keyFile({ private_key: 'not a key' }),
              scopes: SCOPES,
            }),
          /not an RSA private key/,
        ],
        [
          'no scopes',
          () =>
            parseGoogleServiceAccountKey({ keyFile: keyFile(), scopes: [] }),
          /at least one scope/,
        ],
        [
          'a scope with a space',
          () =>
            parseGoogleServiceAccountKey({
              keyFile: keyFile(),
              scopes: ['a b'],
            }),
          /no spaces/,
        ],
        [
          'a subject that is not an email address',
          () =>
            parseGoogleServiceAccountKey({
              keyFile: keyFile(),
              subject: 'owner',
              scopes: SCOPES,
            }),
          /email address of the user to act as/,
        ],
      ];
      for (let [name, fn, message] of cases) {
        let error = keyErrorOf(fn);
        assert.true(message.test(error.message), `${name}: ${error.message}`);
        let quotesKey =
          error.message.includes('BEGIN PRIVATE KEY') ||
          error.message.includes(PRIVATE_KEY_PEM.split('\n')[1]);
        assert.false(quotesKey, `${name}: the message quotes none of the key`);
      }
    });
  });

  module('the assertion', function () {
    test('is an RS256 JWT for the token endpoint, signed by the key', function (assert) {
      let now = Date.UTC(2026, 9, 1, 12, 0, 0);
      let jwt = signGoogleAssertion(
        credential({ subject: 'owner@example.com' }),
        { tokenEndpoint: 'https://oauth2.googleapis.com/token', now },
      );
      let [header, claims, signature] = jwt.split('.');
      assert.deepEqual(decodeSegment(header), {
        alg: 'RS256',
        typ: 'JWT',
        kid: 'kid-0123456789',
      });
      assert.deepEqual(decodeSegment(claims), {
        iss: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
        sub: 'owner@example.com',
        scope: SCOPES.join(' '),
        aud: 'https://oauth2.googleapis.com/token',
        iat: now / 1000,
        exp: now / 1000 + 3600,
      });
      assert.true(
        verify(
          'RSA-SHA256',
          Buffer.from(`${header}.${claims}`),
          createPublicKey(PRIVATE_KEY_PEM),
          Buffer.from(signature, 'base64url'),
        ),
        'the signature verifies with the key file’s public key',
      );
    });

    test('names no subject when the key acts as the service account itself', function (assert) {
      let jwt = signGoogleAssertion(credential(), {
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        now: Date.now(),
      });
      assert.false('sub' in decodeSegment(jwt.split('.')[1]));
    });
  });

  module('minting', function (hooks) {
    let vendor: StubVendor;
    let now: number;

    hooks.before(async function () {
      vendor = await startStubVendor();
    });
    hooks.after(async function () {
      await vendor.close();
    });
    hooks.beforeEach(function () {
      vendor.requests.length = 0;
      vendor.googleTokenAnswers.length = 0;
      vendor.googleTokensMinted.length = 0;
      vendor.googleTokenLifetime = 3600;
      now = Date.UTC(2026, 9, 1, 12, 0, 0);
      configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
      configureGoogleTokens({
        tokenEndpoint: `${vendor.url}/google-token`,
        retryDelaysMs: [1, 1],
        now: () => now,
      });
    });
    hooks.afterEach(function () {
      resetGoogleTokens();
      resetOutbound();
    });

    test('exchanges a signed assertion for an access token', async function (assert) {
      let token = await googleAccessToken('key-1', credential());
      assert.strictEqual(token, 'stub-access-1');
      assert.strictEqual(vendor.requests.length, 1);
      let [sent] = vendor.requests;
      assert.strictEqual(sent.method, 'POST');
      assert.strictEqual(
        sent.headers['content-type'],
        'application/x-www-form-urlencoded',
      );
      let form = new URLSearchParams(sent.body);
      assert.strictEqual(
        form.get('grant_type'),
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
      );
      let claims = decodeSegment(form.get('assertion')!.split('.')[1]);
      assert.strictEqual(
        claims.aud,
        `${vendor.url}/google-token`,
        'the assertion is for the platform’s token endpoint, not the key file’s token_uri',
      );
      assert.false(
        sent.body.includes(PRIVATE_KEY_PEM.split('\n')[1]),
        'the private key itself is never sent',
      );
    });

    test('reuses a token until shortly before it expires, then mints again', async function (assert) {
      let key = credential();
      assert.strictEqual(
        await googleAccessToken('key-1', key),
        'stub-access-1',
      );
      now += 54 * 60 * 1000;
      assert.strictEqual(
        await googleAccessToken('key-1', key),
        'stub-access-1',
        'still cached with six minutes left',
      );
      now += 2 * 60 * 1000;
      assert.strictEqual(
        await googleAccessToken('key-1', key),
        'stub-access-2',
        'minted again within five minutes of expiry',
      );
      assert.strictEqual(vendor.requests.length, 2);
    });

    test('keeps a short-lived token for half its life', async function (assert) {
      vendor.googleTokenLifetime = 120;
      let key = credential();
      await googleAccessToken('key-1', key);
      now += 59 * 1000;
      assert.strictEqual(
        await googleAccessToken('key-1', key),
        'stub-access-1',
      );
      now += 2 * 1000;
      assert.strictEqual(
        await googleAccessToken('key-1', key),
        'stub-access-2',
      );
    });

    test('concurrent calls for one key mint once', async function (assert) {
      let key = credential();
      let tokens = await Promise.all(
        Array.from({ length: 5 }, () => googleAccessToken('key-1', key)),
      );
      assert.deepEqual(tokens, Array(5).fill('stub-access-1'));
      assert.strictEqual(vendor.requests.length, 1);
    });

    test('each key, and each value a key is replaced with, mints its own token', async function (assert) {
      let key = credential();
      assert.strictEqual(
        await googleAccessToken('key-1', key),
        'stub-access-1',
      );
      assert.strictEqual(
        await googleAccessToken('key-2', key),
        'stub-access-2',
        'another key',
      );
      assert.strictEqual(
        await googleAccessToken(
          'key-1',
          credential({ scopes: ['https://www.googleapis.com/auth/drive'] }),
        ),
        'stub-access-3',
        'the same key after its value was replaced',
      );
    });

    test('a key Google refuses is rejected at once, not retried', async function (assert) {
      vendor.googleTokenAnswers.push({
        status: 400,
        body: {
          error: 'invalid_grant',
          error_description: 'Invalid JWT Signature.',
        },
      });
      try {
        await googleAccessToken('key-1', credential());
        assert.ok(false, 'expected a refusal');
      } catch (e) {
        assert.true(e instanceof GoogleServiceAccountRejectedError);
        assert.strictEqual(
          (e as GoogleServiceAccountRejectedError).error,
          'invalid_grant',
        );
      }
      assert.strictEqual(vendor.requests.length, 1);
    });

    test('a refusal is not cached: the next call asks again', async function (assert) {
      vendor.googleTokenAnswers.push({
        status: 401,
        body: { error: 'invalid_client' },
      });
      await googleAccessToken('key-1', credential()).catch(() => undefined);
      assert.strictEqual(
        await googleAccessToken('key-1', credential()),
        'stub-access-1',
      );
    });

    test('a 5xx or a temporary error is retried', async function (assert) {
      vendor.googleTokenAnswers.push(
        { status: 503, body: { error: 'backend_error' } },
        { status: 400, body: { error: 'temporarily_unavailable' } },
      );
      assert.strictEqual(
        await googleAccessToken('key-1', credential()),
        'stub-access-1',
      );
      assert.strictEqual(vendor.requests.length, 3);
    });

    test('an endpoint failing through every retry is unavailable, and says nothing of the key', async function (assert) {
      vendor.googleTokenAnswers.push(
        { status: 500, body: {} },
        { status: 502, body: {} },
        { status: 503, body: {} },
      );
      let lines = await logLinesDuring(
        ['google-service-account', 'outbound'],
        async () => {
          try {
            await googleAccessToken('key-1', credential());
            assert.ok(false, 'expected a refusal');
          } catch (e) {
            assert.true(e instanceof GoogleTokenEndpointUnavailableError);
            assert.false(
              String((e as Error).message).includes('stub-access'),
              'the error carries no token',
            );
          }
        },
      );
      assert.strictEqual(vendor.requests.length, 3, 'tried three times');
      assert.true(lines.length > 0, 'each failure is logged');
      let secretLine = PRIVATE_KEY_PEM.split('\n')[1];
      assert.false(
        lines.some((line) => line.message.includes(secretLine)),
        'no log line carries the private key',
      );
    });

    test('an endpoint that does not answer is retried, then unavailable', async function (assert) {
      configureGoogleTokens({
        tokenEndpoint: 'http://127.0.0.1:1/token',
      });
      try {
        await googleAccessToken('key-1', credential());
        assert.ok(false, 'expected a refusal');
      } catch (e) {
        assert.true(e instanceof GoogleTokenEndpointUnavailableError);
      }
    });
  });
});
