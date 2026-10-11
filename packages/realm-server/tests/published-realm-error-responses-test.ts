import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import { createJWT, setupPermissionedRealmCached } from './helpers/index.ts';

// A published realm is a public site: whatever it answers a crawler, a
// link-preview bot or a scanner, it answers to anyone. Its error documents
// keep the server stack only for a caller it can identify, and it answers the
// robots.txt every crawler asks for.

const BROKEN_MODULE = 'export const = ;\n';
const DEFAULT_ROBOTS = 'User-agent: *\nAllow: /\n';

function hasStack(body: string): boolean {
  return /"stack"\s*:/.test(body);
}

module(basename(import.meta.filename), function () {
  module('a published realm', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      permissions: { '*': ['read'] },
      fileSystem: { 'broken.gts': BROKEN_MODULE },
      published: true,
      onRealmSetup(args) {
        testRealm = args.testRealm;
        request = args.request;
      },
    });

    test('a missing path answers an anonymous caller without a stack', async function (assert) {
      let response = await request
        .get('/does-not-exist.png')
        .set('Accept', '*/*');
      assert.strictEqual(response.status, 404, response.text);
      assert.strictEqual(
        response.body.errors?.[0]?.status,
        404,
        'the error document is still served',
      );
      assert.ok(
        response.body.errors?.[0]?.message,
        'the error still says what went wrong',
      );
      assert.false(hasStack(response.text), `no stack: ${response.text}`);
    });

    test('a broken module answers an anonymous caller without a stack', async function (assert) {
      let response = await request.get('/broken').set('Accept', '*/*');
      assert.strictEqual(response.status, 406, response.text);
      assert.false(hasStack(response.text), `no stack: ${response.text}`);
    });

    test('a token that does not verify is treated as anonymous', async function (assert) {
      let response = await request
        .get('/does-not-exist.png')
        .set('Accept', '*/*')
        .set('Authorization', 'Bearer not-a-real-token');
      assert.strictEqual(response.status, 404, response.text);
      assert.false(hasStack(response.text), `no stack: ${response.text}`);
    });

    test('a caller with a verified session still gets the stack', async function (assert) {
      let response = await request
        .get('/does-not-exist.png')
        .set('Accept', '*/*')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, '@reader:localhost', ['read'])}`,
        );
      assert.strictEqual(response.status, 404, response.text);
      assert.strictEqual(
        typeof response.body.errors?.[0]?.stack,
        'string',
        'the stack is served to a caller the realm can identify',
      );
    });

    test('robots.txt allows every crawler when the realm holds none', async function (assert) {
      let response = await request.get('/robots.txt').set('Accept', '*/*');
      assert.strictEqual(response.status, 200, response.text);
      assert.ok(
        response.get('content-type')?.startsWith('text/plain'),
        `served as text: ${response.get('content-type')}`,
      );
      assert.strictEqual(response.text, DEFAULT_ROBOTS);
    });
  });

  module("a published realm's own robots.txt", function (hooks) {
    let request: SuperTest<Test>;
    let ownRobots = 'User-agent: *\nDisallow: /drafts/\n';

    setupPermissionedRealmCached(hooks, {
      permissions: { '*': ['read'] },
      fileSystem: { 'robots.txt': ownRobots },
      published: true,
      onRealmSetup(args) {
        request = args.request;
      },
    });

    test('is served in place of the default', async function (assert) {
      let response = await request.get('/robots.txt').set('Accept', '*/*');
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(response.text, ownRobots);
    });
  });

  module('a realm that is not published', function (hooks) {
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      permissions: { '*': ['read'] },
      onRealmSetup(args) {
        request = args.request;
      },
    });

    test('keeps the stack in an anonymous error response', async function (assert) {
      let response = await request
        .get('/does-not-exist.png')
        .set('Accept', '*/*');
      assert.strictEqual(response.status, 404, response.text);
      assert.strictEqual(
        typeof response.body.errors?.[0]?.stack,
        'string',
        'stack removal is scoped to published realms',
      );
    });

    test('has no default robots.txt', async function (assert) {
      let response = await request.get('/robots.txt').set('Accept', '*/*');
      assert.strictEqual(response.status, 404, response.text);
    });
  });
});
