import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { RealmServer, RealmHttpServer } from '../server.ts';
import {
  closeServer,
  matrixURL,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import {
  appOrigin,
  createSecureOrigin,
  secureOriginHeaders,
} from '../lib/secure-origin.ts';
import { isListedOrigin } from '@cardstack/secure-origin/security/app-origins.js';
import { redactResponse } from '@cardstack/secure-origin/security/redact.js';
import { PAGE_PATHS } from '@cardstack/secure-origin/shell/pages.js';
import {
  registerSecureOriginHost,
  scrubRequestTelemetry,
} from '../lib/request-telemetry.ts';

const realmURL = new URL('http://127.0.0.1:4444/test/');
const requireFromTest = createRequire(import.meta.url);

const securePackage = dirname(
  requireFromTest.resolve('@cardstack/secure-origin/package.json'),
);

// The secure origin's build: each entry document and the files it loads, and
// the committed record of which modules each file holds.
const buildDir = join(securePackage, 'dist');
const buildManifest: Record<string, string[]> = JSON.parse(
  readFileSync(join(buildDir, 'manifest.json'), 'utf8'),
).entries;
const buildRecord: {
  files: Record<string, { modules?: { package: string; module: string }[] }>;
} = JSON.parse(
  readFileSync(join(dirname(buildDir), 'build-record.json'), 'utf8'),
);

// The files an entry document loads, without the document itself.
function loadedFiles(document: string): string[] {
  return buildManifest[document].filter((name) => name !== document);
}

function contentTypeOf(name: string): string {
  return name.endsWith('.css') ? 'text/css' : 'text/javascript';
}

function entryScript(path: string): RegExp {
  return new RegExp(
    `<script type="module"(?: crossorigin)? src="${path.replace(/[.]/g, '\\.')}">`,
  );
}
const secureOriginURL = new URL('https://secure.example.test/secure');
const secureHost = secureOriginURL.host;

const fileSystem = {
  'person.gts': `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Person extends CardDef {
      @field firstName = contains(StringField);
    }
  `,
  'person-1.json': {
    data: {
      attributes: { firstName: 'Mango' },
      meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
    },
  },
  'notes.txt': 'plain realm asset',
};

// Paths that something other than the secure origin serves: the realm itself,
// a card instance, a card module, a realm asset, a server endpoint, the base
// realm, the host app's service worker and the server root.
const NON_SHELL_PATHS: { path: string; accept: string }[] = [
  { path: '/test/', accept: SupportedMimeType.CardJson },
  { path: '/test/', accept: 'text/html' },
  { path: '/test/person-1', accept: SupportedMimeType.CardJson },
  { path: '/test/person.gts', accept: '*/*' },
  { path: '/test/person', accept: '*/*' },
  { path: '/test/notes.txt', accept: '*/*' },
  { path: '/test/_info', accept: SupportedMimeType.RealmInfo },
  { path: '/_server-session', accept: SupportedMimeType.JSON },
  { path: '/base/card-api', accept: '*/*' },
  { path: '/auth-service-worker.js', accept: '*/*' },
  { path: '/', accept: 'text/html' },
  { path: '/secure/other', accept: 'text/html' },
  { path: '/secure/sign-in/', accept: 'text/html' },
  { path: '/secure/keys/', accept: 'text/html' },
  { path: '/secure/keys/share', accept: 'text/html' },
  { path: '/secure/keys/key-1', accept: 'text/html' },
  { path: '/secure/keys/key-1/share/more', accept: 'text/html' },
  { path: '/secure/keys/not%20a%20key/share', accept: 'text/html' },
  { path: '/secure/index.html', accept: 'text/html' },
  { path: '/secure/credentials/', accept: 'text/html' },
  { path: '/secure/credentials.html', accept: 'text/html' },
];

// The shell's own page talks to the realm server and the Matrix server it was
// configured with, and its sign-in may hand a session to the CLI's loopback
// listener.
const SHELL_PAGE_HEADERS = {
  connectSrc: [realmURL.origin, new URL(matrixURL).origin],
  formAction: ['http://127.0.0.1:*'],
};

function assertSecureOriginHeaders(
  assert: Assert,
  response: { headers: Record<string, string> },
  label: string,
  options?: Parameters<typeof secureOriginHeaders>[0],
) {
  for (let [name, value] of Object.entries(secureOriginHeaders(options))) {
    assert.strictEqual(
      response.headers[name.toLowerCase()],
      value,
      `${label}: ${name}`,
    );
  }
  assert.strictEqual(
    response.headers['access-control-allow-origin'],
    undefined,
    `${label}: no CORS headers`,
  );
}

module(basename(import.meta.filename), function () {
  module('secure origin headers', function () {
    test('lock the page down by default', function (assert) {
      let headers = secureOriginHeaders();
      let csp = headers['Content-Security-Policy'];
      assert.ok(csp.includes(`default-src 'self'`), 'default-src is self');
      assert.ok(csp.includes(`frame-ancestors 'none'`), 'no page may frame it');
      assert.notOk(
        csp.includes('unsafe-inline'),
        'inline script is not allowed',
      );
      assert.strictEqual(headers['X-Frame-Options'], 'DENY');
      assert.strictEqual(headers['Referrer-Policy'], 'no-referrer');
    });

    test('a page that talks to another server names only that server', function (assert) {
      let csp = secureOriginHeaders({
        connectSrc: ['https://matrix.example.test'],
      })['Content-Security-Policy'];
      assert.ok(
        csp.includes(`connect-src 'self' https://matrix.example.test`),
        'connect-src names the server',
      );
      assert.notOk(
        secureOriginHeaders()['Content-Security-Policy'].includes(
          'connect-src',
        ),
        'by default a page talks to nothing but its own origin',
      );
    });

    test('a page that submits a form elsewhere names only where', function (assert) {
      let csp = secureOriginHeaders({ formAction: ['http://127.0.0.1:*'] })[
        'Content-Security-Policy'
      ];
      assert.ok(
        csp.includes(`form-action 'self' http://127.0.0.1:*`),
        'form-action names the loopback listener',
      );
      assert.ok(
        secureOriginHeaders()['Content-Security-Policy'].includes(
          `form-action 'self';`,
        ),
        'by default a form submits nowhere but its own origin',
      );
    });

    test('a route framed by the app names only that origin', function (assert) {
      let headers = secureOriginHeaders({
        frameAncestors: ['https://app.example.test'],
      });
      assert.ok(
        headers['Content-Security-Policy'].includes(
          'frame-ancestors https://app.example.test',
        ),
        'frame-ancestors names the app origin',
      );
      assert.strictEqual(
        headers['X-Frame-Options'],
        undefined,
        'X-Frame-Options, which cannot name an origin, is left out',
      );
    });
  });

  module('credential fields app origins', function () {
    const listed = [
      'https://app.example.test',
      'https://*.preview.example.test',
      'http://*.dev.example.test:4200',
    ];

    test('an origin the realm server lists is talked to', function (assert) {
      assert.true(isListedOrigin('https://app.example.test', listed));
    });

    test('a subdomain of a wildcard origin is talked to', function (assert) {
      assert.true(
        isListedOrigin('https://my-branch.preview.example.test', listed),
      );
      assert.true(
        isListedOrigin('https://a.b.preview.example.test', listed),
        'at any depth, as frame-ancestors allows',
      );
      assert.true(
        isListedOrigin('http://branch.dev.example.test:4200', listed),
        'with the port it names',
      );
    });

    test('anything else is not', function (assert) {
      for (let origin of [
        'https://preview.example.test',
        'https://evilpreview.example.test',
        'https://preview.example.test.evil.test',
        'http://my-branch.preview.example.test',
        'https://my-branch.preview.example.test:8443',
        'http://branch.dev.example.test',
        'https://app.example.test.evil.test',
        'https://app.example.test/',
        'null',
        '',
      ]) {
        assert.false(isListedOrigin(origin, listed), origin || '(empty)');
      }
    });

    test('a port wildcard stands for any port of its host, and nothing else', function (assert) {
      let loopback = ['http://localhost:*', 'http://127.0.0.1:*'];
      for (let origin of [
        'http://localhost:4200',
        'http://localhost:7357',
        'http://localhost',
        'http://127.0.0.1:4200',
      ]) {
        assert.true(isListedOrigin(origin, loopback), origin);
      }
      for (let origin of [
        'https://localhost:4200',
        'http://localhost.evil.test:4200',
        'http://evil.localhost:4200',
        'http://127.0.0.2:4200',
        'http://127.0.0.1.evil.test:4200',
        'http://localhost:4200/',
        'http://localhost:*',
        'http://[::1]:4200',
      ]) {
        assert.false(isListedOrigin(origin, loopback), origin);
      }
      assert.true(
        isListedOrigin('http://[::1]:4200', ['http://[::1]:*']),
        'an IPv6 host with a port wildcard',
      );
    });

    test('an app origin is configured as a single origin, its port optionally any', function (assert) {
      assert.strictEqual(
        appOrigin('http://localhost:*'),
        'http://localhost:*',
        'a port wildcard is kept',
      );
      assert.strictEqual(
        appOrigin('HTTP://LocalHost:*'),
        'http://localhost:*',
        'and normalized as an origin is',
      );
      assert.strictEqual(
        appOrigin('https://app.example.test/some/path'),
        'https://app.example.test',
        'an origin with a path is reduced to the origin',
      );
      assert.strictEqual(
        appOrigin('https://*.preview.example.test'),
        'https://*.preview.example.test',
      );
      assert.strictEqual(
        appOrigin('http://[::1]:4201'),
        'http://[::1]:4201',
        'an IPv6 origin is kept',
      );
      assert.strictEqual(
        appOrigin('http://[::1]:*'),
        'http://[::1]:*',
        'with a port wildcard too',
      );
      for (let origin of [
        '*',
        'http://*',
        'http://*:*',
        'http:',
        'http://localhost:4200:*',
        'http://localhost:80:*',
        'https://localhost:443:*',
        'http://localhost/:*',
        'http://localhost/path:*',
        'http://*.[::1]:*',
        'file:///tmp',
        'not a url',
      ]) {
        assert.throws(
          () => appOrigin(origin),
          /is not an app origin/,
          `${origin} is refused`,
        );
      }
    });

    test('a port wildcard origin is named in frame-ancestors and in the page', async function (assert) {
      let origin = createSecureOrigin(
        new URL('https://secure-loopback.example.test/secure'),
        {
          matrixURL: new URL(matrixURL),
          realmServerURL: new URL('https://realms.example.test/'),
          appOrigins: [
            'https://app.example.test',
            'http://localhost:*',
            'http://127.0.0.1:*',
          ],
        },
      );
      let headers: Record<string, string> = {};
      let ctx = {
        path: '/secure/credentials',
        method: 'GET',
        host: 'secure-loopback.example.test',
        set(values: Record<string, string>) {
          Object.assign(headers, values);
        },
      } as any;
      await origin.handle(ctx);
      assert.strictEqual(ctx.status, 200, 'status');
      assert.ok(
        headers['Content-Security-Policy'].includes(
          'frame-ancestors https://app.example.test http://localhost:* http://127.0.0.1:*',
        ),
        headers['Content-Security-Policy'],
      );
      assert.ok(
        String(ctx.body).includes(
          '<meta name="boxel-app-origins" content="https://app.example.test http://localhost:* http://127.0.0.1:*" />',
        ),
        'the page lists them',
      );
    });

    test('a wildcard origin is named in frame-ancestors and in the page', async function (assert) {
      let origin = createSecureOrigin(
        new URL('https://secure-wildcard.example.test/secure'),
        {
          matrixURL: new URL(matrixURL),
          realmServerURL: new URL('https://realms.example.test/'),
          appOrigins: [
            'https://app.example.test',
            'https://*.preview.example.test',
          ],
        },
      );
      let headers: Record<string, string> = {};
      let ctx = {
        path: '/secure/credentials',
        method: 'GET',
        host: 'secure-wildcard.example.test',
        set(values: Record<string, string>) {
          Object.assign(headers, values);
        },
      } as any;
      await origin.handle(ctx);
      assert.strictEqual(ctx.status, 200, 'status');
      assert.ok(
        headers['Content-Security-Policy'].includes(
          'frame-ancestors https://app.example.test https://*.preview.example.test',
        ),
        headers['Content-Security-Policy'],
      );
      assert.ok(
        String(ctx.body).includes(
          '<meta name="boxel-app-origins" content="https://app.example.test https://*.preview.example.test" />',
        ),
        'the page lists both',
      );
    });
  });

  module('credential fields response redaction', function () {
    test('a password echoed in a failed response is cut out', function (assert) {
      let result = redactResponse(
        {
          ok: false,
          status: 403,
          body: {
            errcode: 'M_FORBIDDEN',
            error: 'Wrong password: hunter2hunter2',
            user_id: '@hunter2hunter2:localhost',
          },
        },
        ['hunter2hunter2'],
      );
      assert.deepEqual(result, {
        ok: false,
        status: 403,
        body: {
          errcode: 'M_FORBIDDEN',
          error: 'Wrong password: [redacted]',
          user_id: '@[redacted]:localhost',
        },
      });
    });

    test("a successful sign-in keeps its session when the password is part of the user's ID", function (assert) {
      let session = {
        user_id: '@samepassword:localhost',
        access_token: 'syt_samepassword_token',
        device_id: 'SAMEPASSWORD',
        home_server: 'localhost',
        well_known: { 'm.homeserver': { base_url: 'http://localhost:8008' } },
      };
      let result = redactResponse(
        {
          ok: true,
          status: 200,
          body: { ...session, note: 'echoed samepassword' },
        },
        ['samepassword'],
      );
      assert.deepEqual(
        result.body,
        { ...session, note: 'echoed [redacted]' },
        'session fields are untouched; anything else is still redacted',
      );
    });
  });

  module('secure origin telemetry', function () {
    test('an event raised during a secure-origin request keeps only its method and path', function (assert) {
      registerSecureOriginHost('secure.telemetry.test');
      let event = scrubRequestTelemetry({
        request: {
          method: 'POST',
          url: 'https://secure.telemetry.test/secure?ticket=abc',
          headers: { host: 'secure.telemetry.test', cookie: 'a=b' },
          cookies: { a: 'b' },
          query_string: 'ticket=abc',
          data: '{"value":"sk-live-123"}',
        },
      });
      assert.deepEqual(event.request as unknown, {
        method: 'POST',
        url: 'https://secure.telemetry.test/secure',
      });
    });

    test('the explicit default port does not hide a secure-origin request', function (assert) {
      registerSecureOriginHost('secure.telemetry.test');
      let event = scrubRequestTelemetry({
        request: {
          method: 'POST',
          headers: { ':authority': 'secure.telemetry.test:443' },
          data: 'secret',
        },
      });
      assert.deepEqual(event.request as unknown, { method: 'POST' });
    });

    test('an event from any other request is left alone', function (assert) {
      registerSecureOriginHost('secure.telemetry.test');
      let request = {
        method: 'POST',
        url: 'https://app.telemetry.test/test/card',
        headers: { host: 'app.telemetry.test' },
        data: '{"attributes":{}}',
      };
      let event = scrubRequestTelemetry({ request: { ...request } });
      assert.deepEqual(event.request, request);
    });
  });

  module('secure origin routing', function (hooks) {
    let request: SuperTest<Test>;
    let realmServer: RealmServer;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem,
      secureOriginURL,
      onRealmSetup(args) {
        request = args.request;
        realmServer = args.testRealmServer.testRealmServer;
      },
    });

    test('serves the page shell with the locked-down headers', async function (assert) {
      for (let path of ['/secure', '/secure/']) {
        let response = await request
          .get(path)
          .set('Host', secureHost)
          .set('Accept', 'text/html');
        assert.strictEqual(response.status, 200, `${path}: status`);
        assert.ok(
          response.headers['content-type'].startsWith('text/html'),
          `${path}: content type`,
        );
        assertSecureOriginHeaders(assert, response, path, SHELL_PAGE_HEADERS);
        assert.ok(
          entryScript('/secure/shell.js').test(response.text),
          `${path}: loads the shell's entry point`,
        );
        assert.notOk(
          /<script(?![^>]*\bsrc=)[^>]*>/.test(response.text),
          `${path}: has no inline script`,
        );
        assert.notOk(
          new RegExp(`(src|href)="${realmURL.origin}`).test(response.text),
          `${path}: loads nothing from the realm origin`,
        );
        assert.ok(
          response.text.includes(
            `<meta name="boxel-realm-server-url" content="${realmURL.origin}/" />`,
          ),
          `${path}: names the realm server its pages talk to`,
        );
        assert.ok(
          response.text.includes(
            `<meta name="boxel-matrix-url" content="${new URL(matrixURL).href}" />`,
          ),
          `${path}: names the Matrix server its pages talk to`,
        );
        assert.ok(
          response.text.includes(
            `<meta name="boxel-app-origins" content="${realmURL.origin}" />`,
          ),
          `${path}: names the app origins a sign-in may be handed back to`,
        );
      }
    });

    test("serves the page shell at each of its pages' paths", async function (assert) {
      for (let page of [
        ...PAGE_PATHS,
        'keys/0b6c1e9e-5a1f-4c47-9d0e-2f5b8f6f1a3c/share',
      ]) {
        let path = `/secure/${page}`;
        let response = await request
          .get(path)
          .set('Host', secureHost)
          .set('Accept', 'text/html');
        assert.strictEqual(response.status, 200, `${path}: status`);
        assertSecureOriginHeaders(assert, response, path, SHELL_PAGE_HEADERS);
        assert.ok(
          entryScript('/secure/shell.js').test(response.text),
          `${path}: is the shell, whose router shows the page`,
        );
      }
    });

    test("serves the modes' scripts with the locked-down headers", async function (assert) {
      let shellModules = loadedFiles('index.html').flatMap((name) =>
        (buildRecord.files[name].modules ?? []).map(({ module }) => module),
      );
      for (let name of [
        'session.js',
        'sign-in-page.gts',
        'cli-sign-in-page.gts',
        'cli-auth-page.gts',
        'cli-wait-notice.gts',
        'google-callback.gts',
        'sign-in-form.gts',
        'cli-handoff.js',
        'urls.js',
        'sign-in-copy.js',
        'register.gts',
        'verify-email.gts',
        'registration.ts',
        'forgot-password.gts',
        'reset-password.gts',
        'reset-link.ts',
        'new-password-fields.gts',
        'input-group.gts',
        'matrix.js',
      ]) {
        assert.ok(
          shellModules.some((module) => module.endsWith(`/${name}`)),
          `${name}: built into the files the shell loads`,
        );
      }
      for (let name of loadedFiles('index.html')) {
        let response = await request
          .get(`/secure/${name}`)
          .set('Host', secureHost);
        assert.strictEqual(response.status, 200, `${name}: status`);
        assert.ok(
          response.headers['content-type'].startsWith(contentTypeOf(name)),
          `${name}: content type`,
        );
        assertSecureOriginHeaders(assert, response, name);
      }
    });

    test("serves the shell's own script and stylesheet", async function (assert) {
      let script = await request
        .get('/secure/shell.js')
        .set('Host', secureHost);
      assert.strictEqual(script.status, 200, 'script status');
      assert.ok(
        script.headers['content-type'].startsWith('text/javascript'),
        'script content type',
      );
      assertSecureOriginHeaders(assert, script, 'shell.js');

      let style = await request
        .get('/secure/shell.css')
        .set('Host', secureHost);
      assert.strictEqual(style.status, 200, 'stylesheet status');
      assert.ok(
        style.headers['content-type'].startsWith('text/css'),
        'stylesheet content type',
      );
    });

    test("serves boxel-ui's design tokens and typeface as boxel-ui has them", async function (assert) {
      let stylesDir = dirname(
        createRequire(import.meta.url).resolve(
          '@cardstack/boxel-ui/styles/fonts.css',
        ),
      );
      for (let [name, type] of [
        ['variables.css', 'text/css'],
        ['theme.css', 'text/css'],
        ['IBMPlexSansVar-Roman.woff2', 'font/woff2'],
      ]) {
        let response = await request
          .get(`/secure/${name}`)
          .set('Host', secureHost)
          .buffer(true)
          .parse((res, done) => {
            let chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          });
        assert.strictEqual(response.status, 200, `${name}: status`);
        assert.ok(
          response.headers['content-type'].startsWith(type),
          `${name}: content type`,
        );
        assertSecureOriginHeaders(assert, response, name);
        assert.true(
          (response.body as Buffer).equals(readFileSync(join(stylesDir, name))),
          `${name}: boxel-ui's own file`,
        );
      }
    });

    test('answers HEAD for the shell without a body', async function (assert) {
      let response = await request.head('/secure').set('Host', secureHost);
      assert.strictEqual(response.status, 200);
      assert.notOk(response.text, 'no body');
      assertSecureOriginHeaders(assert, response, 'HEAD', SHELL_PAGE_HEADERS);
    });

    test('refuses other methods on the shell', async function (assert) {
      let response = await request
        .post('/secure')
        .set('Host', secureHost)
        .set('Content-Type', 'application/json')
        .send({ value: 'sk-live-123' });
      assert.strictEqual(response.status, 405);
      assert.strictEqual(response.headers['allow'], 'GET, HEAD');
      assertSecureOriginHeaders(assert, response, 'POST');
    });

    test('serves no realm, card module, realm asset or server route', async function (assert) {
      for (let { path, accept } of NON_SHELL_PATHS) {
        let response = await request
          .get(path)
          .set('Host', secureHost)
          .set('Accept', accept);
        assert.strictEqual(response.status, 404, `${path} (${accept}): 404`);
        assertSecureOriginHeaders(assert, response, path);
        assert.strictEqual(
          response.text,
          'Not Found',
          `${path} (${accept}): no realm content`,
        );
      }

      let preflight = await request
        .options('/test/person-1')
        .set('Host', secureHost)
        .set('Origin', 'https://app.example.test')
        .set('Access-Control-Request-Method', 'PATCH');
      assert.strictEqual(preflight.status, 404, 'CORS preflight: 404');
      assertSecureOriginHeaders(assert, preflight, 'CORS preflight');

      let write = await request
        .post('/test/')
        .set('Host', secureHost)
        .set('Accept', SupportedMimeType.CardJson)
        .send({ data: { type: 'card' } });
      assert.strictEqual(write.status, 404, 'a write to the realm: 404');
    });

    test('recognises its host with the default port spelled out', async function (assert) {
      let response = await request
        .get('/test/person.gts')
        .set('Host', `${secureHost}:443`)
        .set('Accept', '*/*');
      assert.strictEqual(response.status, 404);
      assertSecureOriginHeaders(assert, response, 'explicit port');
    });

    test('leaves the realm origin as it was', async function (assert) {
      let module = await request.get('/test/person.gts').set('Accept', '*/*');
      assert.strictEqual(module.status, 200, 'card module');
      assert.ok(module.text.includes('Person'), 'card module body');
      assert.strictEqual(
        module.headers['content-security-policy'],
        undefined,
        'card module carries no secure-origin policy',
      );

      let instance = await request
        .get('/test/person-1')
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(instance.status, 200, 'card instance');

      let asset = await request.get('/test/notes.txt').set('Accept', '*/*');
      assert.strictEqual(asset.status, 200, 'realm asset');
      assert.strictEqual(asset.text, 'plain realm asset', 'realm asset body');

      let shellPath = await request.get('/secure').set('Accept', 'text/html');
      assert.notOk(
        shellPath.text.includes('/secure/shell.js'),
        'the shell is not served on the realm origin',
      );
    });

    test('serves the credential fields to be framed by the app alone', async function (assert) {
      let response = await request
        .get('/secure/credentials')
        .query({ form: 'login', origin: realmURL.origin })
        .set('Host', secureHost)
        .set('Accept', 'text/html');
      assert.strictEqual(response.status, 200, 'status');
      assert.ok(
        response.headers['content-type'].startsWith('text/html'),
        'content type',
      );
      let csp: string = response.headers['content-security-policy'];
      assert.ok(
        csp.includes(`frame-ancestors ${realmURL.origin}`),
        `only the app's origin may frame it (${csp})`,
      );
      assert.ok(
        csp.includes(
          `connect-src 'self' ${matrixURL.origin} ${realmURL.origin}`,
        ),
        `it may talk to the Matrix server and the realm server, and nothing else (${csp})`,
      );
      assert.ok(csp.includes(`default-src 'self'`), 'default-src is self');
      assert.notOk(csp.includes('unsafe-inline'), 'no inline script');
      assert.strictEqual(
        response.headers['x-frame-options'],
        undefined,
        'no X-Frame-Options, which would refuse the framing',
      );
      assert.strictEqual(response.headers['cache-control'], 'no-store');
      assert.strictEqual(response.headers['referrer-policy'], 'no-referrer');
      assert.strictEqual(
        response.headers['access-control-allow-origin'],
        undefined,
        'no CORS headers',
      );
      assert.ok(
        response.text.includes(
          `<meta name="boxel-matrix-url" content="${matrixURL.href}" />`,
        ),
        'names the Matrix server a password is sent to',
      );
      assert.ok(
        response.text.includes(
          `<meta name="boxel-realm-server-url" content="${realmURL.origin}/" />`,
        ),
        "names the realm server a new password's sessions are ended at",
      );
      assert.ok(
        response.text.includes(
          `<meta name="boxel-app-origins" content="${realmURL.origin}" />`,
        ),
        'names the app origins it talks to',
      );
      assert.ok(
        entryScript('/secure/credentials.js').test(response.text),
        "loads the fields' entry point",
      );
      assert.notOk(
        /<script(?![^>]*\bsrc=)[^>]*>/.test(response.text),
        'has no inline script',
      );
    });

    test("serves the credential fields' script, stylesheet and font, framable by no one", async function (assert) {
      let credentialModules = loadedFiles('credentials.html').flatMap((name) =>
        (buildRecord.files[name].modules ?? []).map(({ module }) => module),
      );
      for (let name of ['credentials.js', 'app-origins.js', 'redact.js']) {
        assert.ok(
          credentialModules.some((module) => module.endsWith(`/${name}`)),
          `${name}: built into the files the credential fields load`,
        );
      }
      assert.ok(
        loadedFiles('credentials.html').includes('credentials.css'),
        "the fields' stylesheet is built",
      );
      for (let [path, type] of loadedFiles('credentials.html').map((name) => [
        `/secure/${name}`,
        contentTypeOf(name),
      ])) {
        let response = await request.get(path).set('Host', secureHost);
        assert.strictEqual(response.status, 200, `${path}: status`);
        assert.ok(
          response.headers['content-type'].startsWith(type),
          `${path}: content type`,
        );
        assertSecureOriginHeaders(assert, response, path);
      }
    });

    test('refuses other methods on the credential fields', async function (assert) {
      let response = await request
        .post('/secure/credentials')
        .set('Host', secureHost)
        .set('Content-Type', 'application/json')
        .send({ password: 'hunter22' });
      assert.strictEqual(response.status, 405);
      assert.strictEqual(response.headers['allow'], 'GET, HEAD');
    });

    test('the credential fields are not served on the realm origin', async function (assert) {
      let response = await request
        .get('/secure/credentials')
        .set('Accept', 'text/html');
      assert.notOk(
        response.text.includes('/secure/credentials.js'),
        'the realm origin does not serve the fields',
      );
    });

    test('a dedicated listener serves the secure origin and nothing else', async function (assert) {
      let listener: RealmHttpServer = realmServer.listenSecureOrigin(0);
      try {
        await new Promise<void>((resolve) =>
          listener.listening ? resolve() : listener.once('listening', resolve),
        );
        let secureRequest = supertest(listener);

        let shell = await secureRequest
          .get('/secure')
          .set('Accept', 'text/html');
        assert.strictEqual(shell.status, 200, 'shell');
        assertSecureOriginHeaders(assert, shell, 'shell', SHELL_PAGE_HEADERS);

        // Whatever Host it is given, this listener never reaches a realm.
        for (let host of [realmURL.host, secureHost]) {
          for (let { path, accept } of NON_SHELL_PATHS) {
            let response = await secureRequest
              .get(path)
              .set('Host', host)
              .set('Accept', accept);
            assert.strictEqual(
              response.status,
              404,
              `${host}${path} (${accept}): 404`,
            );
          }
        }
      } finally {
        await closeServer(listener);
      }
    });
  });
});
