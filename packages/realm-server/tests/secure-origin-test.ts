import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { RealmServer, RealmHttpServer } from '../server.ts';
import { closeServer, setupPermissionedRealmCached } from './helpers/index.ts';
import { secureOriginHeaders } from '../lib/secure-origin.ts';
import {
  registerSecureOriginHost,
  scrubSecureOriginEvent,
} from '../lib/secure-origin-telemetry.ts';

const realmURL = new URL('http://127.0.0.1:4444/test/');
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
  { path: '/secure/index.html', accept: 'text/html' },
];

function assertSecureOriginHeaders(
  assert: Assert,
  response: { headers: Record<string, string> },
  label: string,
) {
  for (let [name, value] of Object.entries(secureOriginHeaders())) {
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

  module('secure origin telemetry', function () {
    test('an event raised during a secure-origin request keeps only its method and path', function (assert) {
      registerSecureOriginHost('secure.telemetry.test');
      let event = scrubSecureOriginEvent({
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
      let event = scrubSecureOriginEvent({
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
      let event = scrubSecureOriginEvent({ request: { ...request } });
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
        assertSecureOriginHeaders(assert, response, path);
        assert.ok(
          response.text.includes(
            '<script type="module" src="/secure/shell.js">',
          ),
          `${path}: loads the shell's entry point`,
        );
        assert.notOk(
          /<script(?![^>]*\bsrc=)[^>]*>/.test(response.text),
          `${path}: has no inline script`,
        );
        assert.notOk(
          response.text.includes(realmURL.origin),
          `${path}: refers to nothing on the realm origin`,
        );
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

    test('answers HEAD for the shell without a body', async function (assert) {
      let response = await request.head('/secure').set('Host', secureHost);
      assert.strictEqual(response.status, 200);
      assert.notOk(response.text, 'no body');
      assertSecureOriginHeaders(assert, response, 'HEAD');
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
        assertSecureOriginHeaders(assert, shell, 'shell');

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
