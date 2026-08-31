import { module, test } from 'qunit';

import { VirtualNetwork, baseRealm } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import {
  realmIdentifierSegments,
  resolvedRealmURLHref,
} from '@cardstack/host/lib/realm-utils';

let { resolvedBaseRealmURL } = ENV;

// A realm identifier is either a URL or a registered prefix, and these two
// helpers are where that choice stops mattering to a caller: one names a realm
// without parsing it, the other resolves it without assuming it needs
// resolving. Both branches are asserted here because every identifier the app
// hands them today is URL-form — so the prefix branches would otherwise never
// execute, and no suite would notice a refactor that dropped them.
module('Unit | realm-utils', function (hooks) {
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(function () {
    virtualNetwork = new VirtualNetwork();
    // Registered the way host boot does it: the alias URL mapping plus the
    // canonical prefix mapping.
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    virtualNetwork.addRealmMapping('@cardstack/base/', resolvedBaseRealmURL);
  });

  module('realmIdentifierSegments', function () {
    test('takes a URL identifier apart by pathname', function (assert) {
      assert.deepEqual(
        realmIdentifierSegments('https://cardstack.com/base/'),
        ['base'],
        'a single-segment realm path yields that segment',
      );
      assert.deepEqual(
        realmIdentifierSegments('https://example.com/foo/bar/'),
        ['foo', 'bar'],
        'a nested realm path yields every segment',
      );
    });

    test('takes a prefix identifier apart by namespace', function (assert) {
      assert.deepEqual(
        realmIdentifierSegments('@cardstack/base/'),
        ['@cardstack', 'base'],
        'the prefix form keeps its scope segment rather than being parsed away',
      );
    });

    test('a realm at the root of its origin names no segments', function (assert) {
      assert.deepEqual(
        realmIdentifierSegments('https://example.com/'),
        [],
        'there is nothing to name, and this must not throw',
      );
    });

    test('the last segment names the realm in either form', function (assert) {
      // What the display paths actually read off the end of the array.
      for (let identifier of [
        'https://cardstack.com/base/',
        '@cardstack/base/',
      ]) {
        let segments = realmIdentifierSegments(identifier);
        assert.strictEqual(
          segments[segments.length - 1],
          'base',
          `${identifier} names the realm 'base'`,
        );
      }
    });
  });

  module('resolvedRealmURLHref', function () {
    test('resolves a registered prefix to its target URL', function (assert) {
      assert.strictEqual(
        resolvedRealmURLHref(virtualNetwork, '@cardstack/base/'),
        new URL(resolvedBaseRealmURL).href,
        'the prefix resolves through the realm mapping',
      );
    });

    test('leaves a URL identifier alone', function (assert) {
      assert.strictEqual(
        resolvedRealmURLHref(virtualNetwork, 'https://example.com/realm/'),
        'https://example.com/realm/',
        'a URL form needs no resolution and is returned unchanged',
      );
    });

    test('returns an unresolvable identifier untouched rather than throwing', function (assert) {
      // The distinction from `virtualNetwork.toURL`, which throws here. The
      // callers are display and lookup paths that must not fail a render over
      // a realm they cannot place.
      assert.strictEqual(
        resolvedRealmURLHref(virtualNetwork, '@unmapped/thing/'),
        '@unmapped/thing/',
        'an unregistered prefix comes back as given',
      );
      assert.throws(
        () => virtualNetwork.toURL('@unmapped/thing/'),
        'the underlying VirtualNetwork call is the one that throws',
      );
    });
  });
});
