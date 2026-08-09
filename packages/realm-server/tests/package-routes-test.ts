import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Router = require('@koa/router');

// This file exists because of a real outage, not a hypothetical one.
//
// The package serve route was first written `/_packages/(.*)`. @koa/router 14
// uses path-to-regexp 8, which removed bare capture groups and THROWS from
// `router.get()` rather than simply failing to match. The failure mode is
// therefore not "that endpoint 404s" — it is `createRoutes` throwing, the
// realm server refusing to start, and the whole dev stack coming down with
// an error that names path-to-regexp and not the line that caused it.
//
// A route pattern is executable configuration, and the cheapest place to
// find out it is malformed is here rather than at boot.
const PACKAGE_ROUTE = '/_packages/*rest';

function matchParams(pattern: string, path: string) {
  let router = new Router();
  router.get(pattern, () => {});
  let matched = router.match(path, 'GET');
  if (!matched.route) {
    return undefined;
  }
  let layer = matched.pathAndMethod[0];
  return layer.params(path, layer.captures(path));
}

module(basename(import.meta.filename), function () {
  module('the package serve route', function () {
    test('registers without throwing', function (assert) {
      let router = new Router();
      router.get(PACKAGE_ROUTE, () => {});
      assert.ok(true, 'path-to-regexp accepted the pattern');
    });

    test('captures the whole remainder, version and all', function (assert) {
      let params = matchParams(
        PACKAGE_ROUTE,
        '/_packages/lib/three@0.169.0/build/three.module.js',
      );
      assert.strictEqual(
        params?.rest,
        'lib/three@0.169.0/build/three.module.js',
        'the @ and every path segment survive routing',
      );
    });

    test('a deep path stays whole rather than stopping at the first slash', function (assert) {
      let params = matchParams(
        PACKAGE_ROUTE,
        '/_packages/lib/three@0.169.0/examples/jsm/loaders/GLTFLoader.js',
      );
      assert.strictEqual(
        params?.rest,
        'lib/three@0.169.0/examples/jsm/loaders/GLTFLoader.js',
      );
    });

    test('the old capture-group spelling still throws, so this guard stays meaningful', function (assert) {
      // If path-to-regexp ever accepts `(.*)` again this assertion fails, and
      // the comment above needs revisiting rather than the route.
      assert.throws(
        () => {
          let router = new Router();
          router.get('/_packages/(.*)', () => {});
        },
        /Unexpected \(/,
        'bare capture groups are a registration-time error',
      );
    });
  });
});
