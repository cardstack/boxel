import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  MODULE_DOOR,
  SOURCE_DOOR,
  packageStoreForRealm,
  parseRealmPackageDoor,
} from '../lib/package-store.ts';

// The package serve doors are no longer @koa/router routes, and this file
// changed with them.
//
// IT USED TO GUARD A ROUTE PATTERN. `/_packages/(.*)` was written first;
// @koa/router 14 uses path-to-regexp 8, which removed bare capture groups and
// THROWS from `router.get()` rather than failing to match — so the failure was
// not "that endpoint 404s", it was the realm server refusing to boot with an
// error naming path-to-regexp and not the line that caused it.
//
// That hazard is gone because the pattern is gone. The doors now hang off a
// REALM (`<realm>/_packages/…`), whose path is not a fixed number of segments,
// so they are a middleware over a pure parser instead — see
// `lib/package-store.ts` for why the realm is in the URL at all.
//
// The tests moved with the grammar rather than being deleted with the route.
// Getting this parser wrong is worse than a 404: it decides where a realm's
// path ends, so a mistake here silently reassigns a package to another realm's
// namespace, which is the exact failure the address change exists to prevent.

module(basename(import.meta.filename), function () {
  module('parseRealmPackageDoor', function () {
    test('splits a realm path from the package address', function (assert) {
      let door = parseRealmPackageDoor(
        '/atlas/_packages/lib/three@0.169.0/build/three.module.js',
      );
      assert.strictEqual(door?.realmPath, '/atlas/');
      assert.strictEqual(door?.door, MODULE_DOOR);
      assert.strictEqual(
        door?.rest,
        'lib/three@0.169.0/build/three.module.js',
        'the @ and every path segment survive the split',
      );
    });

    test('a deep path stays whole rather than stopping at the first slash', function (assert) {
      let door = parseRealmPackageDoor(
        '/atlas/_packages/lib/three@0.169.0/examples/jsm/loaders/GLTFLoader.js',
      );
      assert.strictEqual(
        door?.rest,
        'lib/three@0.169.0/examples/jsm/loaders/GLTFLoader.js',
      );
    });

    test('a multi-segment realm path is kept whole', function (assert) {
      // The reason this is a parser and not a route: nobody here knows how
      // many segments a realm has. The parser hands everything before the
      // marker to the realm registry and lets IT decide.
      let door = parseRealmPackageDoor(
        '/user/notes/_packages/acme/x@1.0.0/i.js',
      );
      assert.strictEqual(door?.realmPath, '/user/notes/');
      assert.strictEqual(door?.rest, 'acme/x@1.0.0/i.js');
    });

    test('the source door is recognised separately from the module door', function (assert) {
      let door = parseRealmPackageDoor('/atlas/_source/acme/x@1.0.0/index.gts');
      assert.strictEqual(door?.door, SOURCE_DOOR);
      assert.strictEqual(door?.rest, 'acme/x@1.0.0/index.gts');
    });

    test('a rootless address names no realm and is refused', function (assert) {
      // The old server-wide door. Refusing it here rather than treating the
      // server root as a realm is what makes its removal visible instead of
      // mysterious — a package address with no realm in it names nobody's
      // namespace.
      assert.strictEqual(
        parseRealmPackageDoor('/_packages/acme/x@1.0.0/i.js'),
        undefined,
      );
      assert.strictEqual(
        parseRealmPackageDoor('/_source/acme/x@1.0.0/i.gts'),
        undefined,
      );
    });

    test('a path with neither door defers', function (assert) {
      assert.strictEqual(
        parseRealmPackageDoor('/atlas/invoice-1.json'),
        undefined,
      );
      assert.strictEqual(parseRealmPackageDoor('/atlas/'), undefined);
    });

    test('the LEFTMOST marker wins when a pack ships one of its own', function (assert) {
      // A published Version may legitimately contain a directory called
      // `_packages`. Checking the doors in declaration order rather than by
      // position would let that file claim a realm of `/atlas/_source/x@1.0.0`
      // — a published file renaming the realm that governs it.
      let door = parseRealmPackageDoor(
        '/atlas/_source/x@1.0.0/_packages/inner.js',
      );
      assert.strictEqual(door?.realmPath, '/atlas/');
      assert.strictEqual(door?.door, SOURCE_DOOR);
      assert.strictEqual(door?.rest, 'x@1.0.0/_packages/inner.js');
    });
  });

  module('packageStoreForRealm', function () {
    test('roots a store under the host and the realm path', function (assert) {
      assert.strictEqual(
        packageStoreForRealm('/srv/store', 'https://app.example/atlas/'),
        '/srv/store/app.example/atlas',
      );
    });

    test('two realms on one server cannot share a root', function (assert) {
      // The whole point of the layout: collision is impossible by construction
      // rather than prevented by a rule somebody has to remember.
      let a = packageStoreForRealm('/srv/store', 'https://app.example/atlas/');
      let b = packageStoreForRealm(
        '/srv/store',
        'https://app.example/experiments/',
      );
      assert.notStrictEqual(a, b);
    });

    test('the same realm path on two hosts cannot collide either', function (assert) {
      let a = packageStoreForRealm('/srv/store', 'https://a.example/atlas/');
      let b = packageStoreForRealm('/srv/store', 'https://b.example/atlas/');
      assert.notStrictEqual(a, b);
    });

    test('a port is kept but made filesystem-safe', function (assert) {
      // `:` is legal in a POSIX filename and awkward in an S3 key, a Windows
      // checkout and a shell glob.
      assert.strictEqual(
        packageStoreForRealm('/srv/store', 'https://localhost:4201/atlas/'),
        '/srv/store/localhost_4201/atlas',
      );
    });

    test('a traversal segment is refused rather than sanitised', function (assert) {
      // Refused because any rewrite that makes `..` safe also makes two
      // distinct realms share a root, which is the failure this file exists to
      // prevent. Loud, because every realm URL comes from the registry rather
      // than from a request.
      assert.throws(
        () =>
          packageStoreForRealm('/srv/store', 'https://app.example/a/..%2Fb/'),
        /cannot root a package store/,
      );
    });
  });
});
