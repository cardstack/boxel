import QUnit from 'qunit';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jsonwebtoken from 'jsonwebtoken';
import {
  createHostedIdentityVerifier,
  createLocalIdentityVerifier,
} from '../lib/hosted-identity.ts';
import { createLocalIdentityBroker } from '../lib/local-identity-broker.ts';
import { startLocalIdentityServer } from '../lib/local-identity-server.ts';
import { createLocalHostedLoginClient } from '../lib/realm-identity.ts';
import handleLocalIdentityLogin from '../handlers/handle-local-identity-login.ts';
import { createSecureOrigin } from '../lib/secure-origin.ts';
import Koa from 'koa';
import cors from '@koa/cors';
import puppeteer from 'puppeteer';
import { createLocalIdentityStore } from '../lib/local-identity-store.ts';
import {
  createLocalHostedLogin,
  LocalHostedLoginError,
} from '../lib/local-hosted-login.ts';

const { module, test } = QUnit;

async function fixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'boxel-hosted-login-test-'),
  );
  const hostedUserId = '@teacher:boxel.ai';
  const matrixServerName = 'default.boxel.localhost';
  const localpart =
    'boxel_' + createHash('sha256').update(hostedUserId).digest('hex');
  const localUserId = `@${localpart}:${matrixServerName}`;
  const remoteToken = randomBytes(24).toString('base64url');
  const localToken = randomBytes(24).toString('base64url');
  const proofToken = randomBytes(24).toString('base64url');
  const matrixJwtSecret = randomBytes(32).toString('hex');
  const encryptionKey = randomBytes(32);
  const counters = {
    remoteLogouts: 0,
    localLogouts: 0,
    localLogins: 0,
    metadata: 0,
    leakedRedirects: 0,
    proofChecks: 0,
  };
  const loginIdentifiers: string[] = [];
  const mode = {
    rejectPassword: false,
    foreignProof: false,
    existingUnlinkedAccount: false,
    metadataFails: false,
    rateLimit: false,
    redirect: false,
  };
  let accountCreated = false;
  async function body(request: AsyncIterable<Buffer>) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const hosted = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, 'http://127.0.0.1');
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/leak') {
        counters.leakedRedirects++;
        response.end('{}');
        return;
      }
      if (url.pathname === '/_matrix/client/v3/login') {
        const value = await body(request);
        loginIdentifiers.push(value.identifier.type);
        if (mode.redirect) {
          response.writeHead(302, { Location: '/leak' }).end();
          return;
        }
        if (mode.rateLimit) {
          response.writeHead(429).end(JSON.stringify({ retry_after_ms: 1234 }));
          return;
        }
        const correctUser =
          value.identifier.type === 'm.id.user'
            ? ['teacher', hostedUserId].includes(value.identifier.user)
            : value.identifier.medium === 'email' &&
              value.identifier.address === 'teacher@example.test';
        if (
          mode.rejectPassword ||
          value.password !== 'test-only-password' ||
          !correctUser
        ) {
          response.writeHead(403).end(
            JSON.stringify({
              error: 'test-only-password must not be reflected',
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            user_id: hostedUserId,
            device_id: value.device_id,
            access_token: remoteToken,
          }),
        );
        return;
      }
      if (
        url.pathname ===
        `/_matrix/client/v3/user/${encodeURIComponent(hostedUserId)}/openid/request_token`
      ) {
        if (request.headers.authorization !== `Bearer ${remoteToken}`)
          throw new Error('Expected remote authority');
        response.end(
          JSON.stringify({
            matrix_server_name: 'boxel.ai',
            access_token: proofToken,
          }),
        );
        return;
      }
      if (url.pathname === '/_matrix/federation/v1/openid/userinfo') {
        counters.proofChecks++;
        if (url.searchParams.get('access_token') !== proofToken) {
          response.writeHead(401).end('{}');
          return;
        }
        response.end(
          JSON.stringify({
            sub: mode.foreignProof ? '@other:boxel.ai' : hostedUserId,
          }),
        );
        return;
      }
      if (url.pathname === '/_matrix/client/v3/logout') {
        if (request.headers.authorization !== `Bearer ${remoteToken}`)
          throw new Error('Expected isolated remote logout');
        counters.remoteLogouts++;
        response.end('{}');
        return;
      }
      response.writeHead(404).end('{}');
    })().catch(() => response.writeHead(500).end('{}'));
  });
  const local = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, 'http://127.0.0.1');
      response.setHeader('Content-Type', 'application/json');
      if (
        url.pathname ===
        `/_matrix/client/v3/profile/${encodeURIComponent(localUserId)}`
      ) {
        response
          .writeHead(accountCreated || mode.existingUnlinkedAccount ? 200 : 404)
          .end('{}');
        return;
      }
      if (url.pathname === '/_matrix/client/v3/login') {
        const value = await body(request);
        if (value.type !== 'org.matrix.login.jwt')
          throw new Error('JWT login required');
        const claims = jsonwebtoken.verify(value.token, matrixJwtSecret, {
          algorithms: ['HS256'],
          issuer: 'boxel-local',
          audience: 'boxel-local-matrix',
        });
        if (
          typeof claims === 'string' ||
          claims.sub !== localpart ||
          !claims.exp ||
          !claims.iat ||
          claims.exp - claims.iat !== 300
        )
          throw new Error('Invalid native JWT');
        counters.localLogins++;
        accountCreated = true;
        response.end(
          JSON.stringify({
            user_id: localUserId,
            device_id: 'local-device',
            access_token: localToken,
          }),
        );
        return;
      }
      if (
        url.pathname ===
        `/_matrix/client/v3/user/${encodeURIComponent(localUserId)}/account_data/app.boxel.hosted-identity`
      ) {
        const value = await body(request);
        if (
          request.headers.authorization !== `Bearer ${localToken}` ||
          value.hostedUserId !== hostedUserId
        )
          throw new Error('Invalid link metadata');
        if (mode.metadataFails) {
          response.writeHead(500).end('{}');
          return;
        }
        counters.metadata++;
        response.end('{}');
        return;
      }
      if (url.pathname === '/_matrix/client/v3/logout') {
        if (request.headers.authorization !== `Bearer ${localToken}`)
          throw new Error('Expected isolated local logout');
        counters.localLogouts++;
        response.end('{}');
        return;
      }
      response.writeHead(404).end('{}');
    })().catch(() => response.writeHead(500).end('{}'));
  });
  hosted.listen(0, '127.0.0.1');
  local.listen(0, '127.0.0.1');
  await Promise.all([once(hosted, 'listening'), once(local, 'listening')]);
  const hostedAddress = hosted.address();
  const localAddress = local.address();
  if (
    !hostedAddress ||
    typeof hostedAddress === 'string' ||
    !localAddress ||
    typeof localAddress === 'string'
  )
    throw new Error('Expected native login listeners');
  const hostedIssuers = {
    'boxel.ai': `http://127.0.0.1:${hostedAddress.port}/`,
  };
  const store = await createLocalIdentityStore({
    directory,
    stackId: 'default',
    localMatrixServerName: matrixServerName,
    hostedVerifier: createHostedIdentityVerifier({
      NODE_ENV: 'test',
      BOXEL_HOSTED_IDENTITY_ISSUERS: JSON.stringify(hostedIssuers),
    }),
    encryption: {
      isEncryptionAvailable: () => true,
      encryptString(value) {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
        const encrypted = Buffer.concat([
          cipher.update(value, 'utf8'),
          cipher.final(),
        ]);
        return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
      },
      decryptString(value) {
        const decipher = createDecipheriv(
          'aes-256-gcm',
          encryptionKey,
          value.subarray(0, 12),
        );
        decipher.setAuthTag(value.subarray(12, 28));
        return Buffer.concat([
          decipher.update(value.subarray(28)),
          decipher.final(),
        ]).toString('utf8');
      },
    },
  });
  const options = {
    store,
    hostedIssuers,
    matrixURL: `http://127.0.0.1:${localAddress.port}/`,
    matrixServerName,
    matrixJwtSecret,
  };
  return {
    mode,
    counters,
    store,
    options,
    localUserId,
    hostedUserId,
    localToken,
    remoteToken,
    proofToken,
    loginIdentifiers,
    login: createLocalHostedLogin(options, { NODE_ENV: 'test' }),
    async close() {
      for (const server of [hosted, local]) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function publicFixture(
  secureOriginURL = new URL(
    'http://secure.default.boxel.localhost:4242/secure',
  ),
) {
  const f = await fixture();
  const secret = randomBytes(32).toString('hex');
  const listener = await startLocalIdentityServer({
    broker: createLocalIdentityBroker({
      store: f.store,
      localVerifier: createLocalIdentityVerifier({
        matrixURL: f.options.matrixURL,
        matrixServerName: f.options.matrixServerName,
      }),
    }),
    hostedLogin: f.login,
    secret,
    port: 0,
  });
  const localHostedLogin = createLocalHostedLoginClient({
    BOXEL_LOCAL_IDENTITY_BROKER_URL: listener.url,
    BOXEL_LOCAL_IDENTITY_BROKER_SECRET: secret,
    MATRIX_SERVER_NAME: f.options.matrixServerName,
  });
  const server = createServer(
    new Koa()
      .use(
        cors({
          origin: secureOriginURL.origin,
          allowMethods: ['POST'],
          allowHeaders: ['Content-Type'],
        }),
      )
      .use(handleLocalIdentityLogin({ localHostedLogin, secureOriginURL }))
      .callback(),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected public sign-in listener');
  return {
    ...f,
    secret,
    privateURL: listener.url,
    secureOriginURL,
    publicURL: `http://127.0.0.1:${address.port}/_local-identity-login`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await listener.stop();
      await f.close();
    },
  };
}

module('local-hosted-login-test.ts', function () {
  test('hosted password proof creates a persistent link and short-lived local JWT login, returning no hosted credentials', async function (assert) {
    const f = await fixture();
    try {
      const now = Math.floor(Date.now() / 1000);
      const result = await f.login(
        { username: 'teacher', password: 'test-only-password' },
        now,
      );
      assert.deepEqual(result.binding, {
        hostedUserId: f.hostedUserId,
        localUserId: f.localUserId,
      });
      assert.strictEqual(result.auth.user_id, f.localUserId);
      assert.strictEqual(result.auth.access_token, f.localToken);
      for (const secret of [f.remoteToken, f.proofToken, 'test-only-password'])
        assert.false(JSON.stringify(result).includes(secret));
      assert.deepEqual(
        await f.store.resolve(f.localUserId, now + 1),
        result.binding,
      );
      await f.login(
        { username: f.hostedUserId, password: 'test-only-password' },
        now + 1,
      );
      assert.strictEqual(f.counters.remoteLogouts, 2);
      assert.strictEqual(f.counters.localLogouts, 0);
      assert.strictEqual(f.counters.localLogins, 2);
      assert.strictEqual(f.counters.metadata, 2);
    } finally {
      await f.close();
    }
  });

  test('email fallback remains inside the native password exchange', async function (assert) {
    const f = await fixture();
    try {
      await f.login(
        { username: 'teacher@example.test', password: 'test-only-password' },
        Math.floor(Date.now() / 1000),
      );
      assert.deepEqual(f.loginIdentifiers, ['m.id.user', 'm.id.thirdparty']);
      assert.strictEqual(f.counters.remoteLogouts, 1);
    } finally {
      await f.close();
    }
  });

  for (const mode of [
    'rejectPassword',
    'foreignProof',
    'existingUnlinkedAccount',
    'metadataFails',
    'rateLimit',
    'redirect',
  ] as const) {
    test(`${mode} fails safely without returning hosted credentials or taking over an account`, async function (assert) {
      const f = await fixture();
      f.mode[mode] = true;
      try {
        let caught: unknown;
        try {
          await f.login(
            { username: 'teacher', password: 'test-only-password' },
            Math.floor(Date.now() / 1000),
          );
        } catch (error) {
          caught = error;
        }
        assert.true(caught instanceof LocalHostedLoginError);
        if (!(caught instanceof LocalHostedLoginError))
          throw new Error('Expected typed login failure');
        assert.strictEqual(
          caught.status,
          mode === 'rejectPassword' ? 401 : mode === 'rateLimit' ? 429 : 503,
        );
        if (mode === 'rateLimit') assert.strictEqual(caught.retryAfterMs, 1234);
        for (const secret of [
          f.remoteToken,
          f.proofToken,
          'test-only-password',
          f.options.matrixURL,
        ])
          assert.false(caught.message.includes(secret));
        assert.strictEqual(
          f.counters.localLogins,
          mode === 'metadataFails' ? 1 : 0,
        );
        assert.strictEqual(
          f.counters.localLogouts,
          mode === 'metadataFails' ? 1 : 0,
        );
        assert.strictEqual(
          f.counters.remoteLogouts,
          ['foreignProof', 'existingUnlinkedAccount', 'metadataFails'].includes(
            mode,
          )
            ? 1
            : 0,
        );
        assert.strictEqual(f.counters.leakedRedirects, 0);
        if (mode !== 'metadataFails')
          assert.false(await f.store.isLinked(f.localUserId));
      } finally {
        await f.close();
      }
    });
  }

  test('production rejects plaintext issuers and caller-supplied routing fields', async function (assert) {
    const f = await fixture();
    try {
      assert.throws(
        () => createLocalHostedLogin(f.options, {}),
        /verified HTTPS/,
      );
      await assert.rejects(
        f.login(
          {
            username: 'teacher',
            password: 'test-only-password',
            matrixURL: 'https://outside.example/',
          },
          Math.floor(Date.now() / 1000),
        ),
        /Local sign-in is unavailable/,
      );
      assert.deepEqual(f.loginIdentifiers, []);
    } finally {
      await f.close();
    }
  });
});

module('local-hosted-login-test.ts > protected sign-in endpoint', function () {
  test('only the protected password origin can exchange credentials and the page receives only the local session', async function (assert) {
    const f = await publicFixture();
    try {
      const body = JSON.stringify({
        username: 'teacher',
        password: 'test-only-password',
      });
      for (const origin of [
        undefined,
        'http://app.default.boxel.localhost:4242',
        'http://outside.example',
      ]) {
        const response = await fetch(f.publicURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(origin ? { Origin: origin } : {}),
          },
          body,
        });
        assert.strictEqual(response.status, 403);
        await response.body?.cancel();
      }
      assert.deepEqual(f.loginIdentifiers, []);
      const response = await fetch(f.publicURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: f.secureOriginURL.origin,
        },
        body,
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('Cache-Control'), 'no-store');
      const text = await response.text();
      const auth = JSON.parse(text);
      assert.strictEqual(auth.user_id, f.localUserId);
      assert.strictEqual(auth.access_token, f.localToken);
      for (const value of [
        f.remoteToken,
        f.proofToken,
        f.secret,
        'test-only-password',
        f.privateURL,
      ])
        assert.false(text.includes(value));
      assert.strictEqual(f.counters.remoteLogouts, 1);
    } finally {
      await f.close();
    }
  });

  test('the protected endpoint limits failed sign-ins without exposing upstream error bodies', async function (assert) {
    const f = await publicFixture();
    f.mode.rejectPassword = true;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch(f.publicURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: f.secureOriginURL.origin,
          },
          body: JSON.stringify({
            username: 'teacher',
            password: 'test-only-password',
          }),
        });
        assert.strictEqual(response.status, attempt < 3 ? 401 : 429);
        const text = await response.text();
        assert.false(text.includes('test-only-password'));
        if (attempt === 3)
          assert.true(Number(response.headers.get('Retry-After')) > 0);
      }
      assert.strictEqual(f.loginIdentifiers.length, 3);
      assert.strictEqual(f.counters.localLogins, 0);
    } finally {
      await f.close();
    }
  });

  test('the secure frame names only the public sign-in endpoint, while hosted defaults leave the adapter disabled', async function (assert) {
    const f = await publicFixture();
    const publicURL = new URL(
      'http://realm.default.boxel.localhost:4242/_local-identity-login',
    );
    const secure = createSecureOrigin(f.secureOriginURL, {
      matrixURL: new URL(f.options.matrixURL),
      realmServerURL: new URL('/', publicURL),
      appOrigins: ['http://app.default.boxel.localhost:4242'],
      localIdentityLoginURL: publicURL,
    });
    const server = createServer(
      new Koa().use(async (ctxt) => secure.handle(ctxt)).callback(),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected secure frame listener');
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/secure/credentials`,
      );
      const html = await response.text();
      assert.strictEqual(response.status, 200);
      assert.true(
        html
          .replace(/\s+/g, ' ')
          .includes(
            `name="boxel-local-identity-login-url" content="${publicURL.href}"`,
          ),
      );
      assert.true(
        response.headers
          .get('Content-Security-Policy')!
          .includes(publicURL.origin),
      );
      assert.false(html.includes(f.secret));
      assert.false(html.includes(f.privateURL));
      assert.strictEqual(createLocalHostedLoginClient({}), null);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await f.close();
    }
  });
});

module('local-hosted-login-test.ts > browser password frame', function () {
  const browserTest = process.env.BOXEL_TEST_BROWSER_BINARY ? test : test.skip;
  for (const form of ['login', 'cli-login']) {
    browserTest(
      `${form} uses the protected frame and returns only the linked local session`,
      async function (assert) {
        let secure: ReturnType<typeof createSecureOrigin> | undefined;
        const secureServer = createServer(
          new Koa()
            .use(async (ctxt) => {
              if (secure) await secure.handle(ctxt);
              else ctxt.status = 503;
            })
            .callback(),
        );
        let frameURL = '';
        const parent = createServer((_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            `<!doctype html><html><head><title>Boxel protected login test</title></head><body><h1>Boxel protected sign-in</h1><iframe title="Password fields" style="width:650px;height:500px;border:0" src="${frameURL.replaceAll('&', '&amp;')}"></iframe><script>window.testMessages=[];window.addEventListener('message',event=>{if(event.source===document.querySelector('iframe').contentWindow)window.testMessages.push(event.data)});</script></body></html>`,
          );
        });
        secureServer.listen(0, '127.0.0.1');
        parent.listen(0, '127.0.0.1');
        await Promise.all([
          once(secureServer, 'listening'),
          once(parent, 'listening'),
        ]);
        const secureAddress = secureServer.address();
        const parentAddress = parent.address();
        if (
          !secureAddress ||
          typeof secureAddress === 'string' ||
          !parentAddress ||
          typeof parentAddress === 'string'
        )
          throw new Error('Expected browser fixture listeners');
        const secureOriginURL = new URL(
          `http://127.0.0.1:${secureAddress.port}/secure`,
        );
        const parentOrigin = `http://127.0.0.1:${parentAddress.port}`;
        const f = await publicFixture(secureOriginURL);
        secure = createSecureOrigin(secureOriginURL, {
          matrixURL: new URL(f.options.matrixURL),
          realmServerURL: new URL('/', f.publicURL),
          appOrigins: [parentOrigin],
          localIdentityLoginURL: new URL(f.publicURL),
        });
        const frame = new URL('credentials', secureOriginURL.href + '/');
        frame.hash = new URLSearchParams({
          form,
          origin: parentOrigin,
        }).toString();
        frameURL = frame.href;
        const browser = await puppeteer.launch({
          executablePath: process.env.BOXEL_TEST_BROWSER_BINARY,
          headless: true,
        });
        try {
          const page = await browser.newPage();
          await page.setViewport({ width: 960, height: 720 });
          await page.goto(parentOrigin);
          await page.waitForFunction(
            "window.testMessages.some(message => message.type === 'ready')",
          );
          const credentialFrame = page
            .frames()
            .find((candidate) =>
              candidate.url().startsWith(secureOriginURL.href),
            );
          if (!credentialFrame)
            throw new Error('Protected credential frame missing');
          await page.evaluate(
            (origin) =>
              document.querySelector('iframe')?.contentWindow?.postMessage(
                {
                  type: 'style',
                  properties: {},
                  inherited: {
                    color: 'black',
                    'font-family': 'Arial',
                    'font-size': '16px',
                  },
                  backdrop: 'white',
                  offset: { x: 0, y: 0 },
                  width: 650,
                },
                origin,
              ),
            secureOriginURL.origin,
          );
          await credentialFrame.waitForSelector('input[name="username"]', {
            visible: true,
          });
          await credentialFrame.type('input[name="username"]', 'teacher');
          await credentialFrame.type(
            'input[name="password"]',
            'test-only-password',
          );
          await page.screenshot({
            path: `/private/tmp/boxel-native-${form}-frame.png`,
            fullPage: true,
          });
          assert.strictEqual(
            await credentialFrame.$eval('input[name="username"]', (element) =>
              element instanceof HTMLInputElement ? element.value.length : -1,
            ),
            7,
            'username was typed into the protected frame',
          );
          assert.strictEqual(
            await credentialFrame.$eval('input[name="password"]', (element) =>
              element instanceof HTMLInputElement ? element.value.length : -1,
            ),
            18,
            'password was typed into the protected frame',
          );
          await page.waitForFunction(
            "window.testMessages.some(message => message.type === 'state' && message.complete)",
          );
          assert.true(
            await page.evaluate(
              () => document.querySelector('iframe')?.contentDocument === null,
            ),
            'the app cannot read protected password fields',
          );
          const id = 1;
          await page.evaluate(
            ({ origin, operation }) =>
              document
                .querySelector('iframe')
                ?.contentWindow?.postMessage(
                  { type: 'submit', id: 1, operation },
                  origin,
                ),
            { origin: secureOriginURL.origin, operation: form },
          );
          await page.waitForFunction(
            `window.testMessages.some(message => message.type === 'result' && message.id === ${id})`,
          );
          const result: unknown = await page.evaluate(
            `window.testMessages.find(message => message.type === 'result' && message.id === ${id})`,
          );
          if (
            !result ||
            typeof result !== 'object' ||
            !('body' in result) ||
            !result.body ||
            typeof result.body !== 'object' ||
            !('user_id' in result.body) ||
            !('ok' in result)
          )
            throw new Error('Expected frame sign-in result');
          assert.strictEqual(result.ok, true);
          assert.strictEqual(result.body.user_id, f.localUserId);
          const messages: unknown = await page.evaluate('window.testMessages');
          for (const value of [
            f.remoteToken,
            f.proofToken,
            f.secret,
            'test-only-password',
          ])
            assert.false(JSON.stringify(messages).includes(value));
          await page.screenshot({
            path: `/private/tmp/boxel-native-${form}-frame.png`,
            fullPage: true,
          });
        } finally {
          await browser.close();
          for (const server of [parent, secureServer]) {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }
          await f.close();
        }
      },
    );
  }
});
