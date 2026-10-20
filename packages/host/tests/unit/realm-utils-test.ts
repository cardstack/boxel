import { module, test } from 'qunit';

import {
  VirtualNetwork,
  baseRealm,
  registeredRealmURL,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import {
  canonicalRealmIdentifier,
  canonicalRealmIdentifiers,
  dedupeRealmsByIdentity,
  realmIdentifierSegments,
  realmURLDisplayText,
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

  module('realmURLDisplayText', function () {
    test('every spelling of a realm displays the URL the realm calls itself', function (assert) {
      for (let identifier of [
        baseRealm.url,
        '@cardstack/base/',
        resolvedBaseRealmURL,
      ]) {
        assert.strictEqual(
          realmURLDisplayText(virtualNetwork, identifier),
          'cardstack.com/base',
          `${identifier} displays as the base realm's own URL`,
        );
      }
    });

    test('an identifier no mapping covers is shown as given', function (assert) {
      assert.strictEqual(
        realmURLDisplayText(virtualNetwork, '@unmapped/thing/'),
        '@unmapped/thing/',
      );
    });
  });

  // The realm server's own reading of a federated request's realms, against
  // a network set up the way its boot sets it up (the same alias and prefix
  // mappings as above).
  module('registeredRealmURL', function () {
    test('names base by its alias whichever spelling the request uses', function (assert) {
      for (let spelling of [
        '@cardstack/base/',
        baseRealm.url,
        new URL(resolvedBaseRealmURL).href,
      ]) {
        assert.strictEqual(
          registeredRealmURL(virtualNetwork, spelling),
          baseRealm.url,
          spelling,
        );
      }
    });

    test('returns anything it cannot place as given', function (assert) {
      assert.strictEqual(
        registeredRealmURL(virtualNetwork, 'https://example.com/realm/'),
        'https://example.com/realm/',
      );
      assert.strictEqual(
        registeredRealmURL(virtualNetwork, '@unmapped/thing/'),
        '@unmapped/thing/',
      );
    });
  });

  // Membership compares a realm against card ids, which deserialization folds
  // to their registered prefix, so a realm is folded the same way whichever
  // spelling names it.
  module('canonicalRealmIdentifier', function (hooks) {
    hooks.beforeEach(function () {
      virtualNetwork.addRealmMapping(
        '@test/mapped/',
        'https://realms.example.com/mapped/',
      );
    });

    test('folds every spelling of the base realm to its prefix', function (assert) {
      let served = new URL(resolvedBaseRealmURL).href;
      for (let spelling of [
        baseRealm.url,
        served,
        '@cardstack/base/',
        '@cardstack/base',
        baseRealm.url.replace(/\/$/, ''),
        served.replace(/\/$/, ''),
      ]) {
        assert.strictEqual(
          canonicalRealmIdentifier(virtualNetwork, spelling),
          '@cardstack/base/',
          spelling,
        );
      }
      assert.strictEqual(
        virtualNetwork.unresolveURL(baseRealm.url.replace(/\/$/, '')),
        baseRealm.url.replace(/\/$/, ''),
        'the fold itself needs the slash, which is why the helper adds it',
      );
    });

    test('folds a prefixed realm and paths beneath it to the prefix', function (assert) {
      assert.strictEqual(
        canonicalRealmIdentifier(
          virtualNetwork,
          'https://realms.example.com/mapped/',
        ),
        '@test/mapped/',
      );
      assert.strictEqual(
        canonicalRealmIdentifier(virtualNetwork, '@test/mapped/'),
        '@test/mapped/',
      );
      assert.strictEqual(
        canonicalRealmIdentifier(
          virtualNetwork,
          'https://realms.example.com/mapped/sub',
        ),
        '@test/mapped/sub/',
      );
    });

    test('leaves a realm with no prefix as its URL', function (assert) {
      assert.strictEqual(
        canonicalRealmIdentifier(virtualNetwork, 'https://example.com/realm'),
        'https://example.com/realm/',
      );
      // A URL mapping alone, with no prefix registered for its target, is
      // not folded: there is no prefix for either side to become.
      virtualNetwork.addURLMapping(
        new URL('https://alias.example/r/'),
        new URL('https://served.example/r/'),
      );
      assert.strictEqual(
        canonicalRealmIdentifier(virtualNetwork, 'https://alias.example/r/'),
        'https://alias.example/r/',
      );
    });
  });

  // A realm list is keyed in the form card ids carry, and sent in the
  // spellings the caller used: either way, every spelling of one realm counts
  // once.
  module('realm lists', function () {
    test('canonicalRealmIdentifiers folds and dedupes, first spelling first', function (assert) {
      assert.deepEqual(
        canonicalRealmIdentifiers(virtualNetwork, [
          baseRealm.url,
          'https://example.com/realm',
          '@cardstack/base/',
          new URL(resolvedBaseRealmURL).href,
          '@unmapped/thing/',
        ]),
        ['@cardstack/base/', 'https://example.com/realm/', '@unmapped/thing/'],
      );
    });

    test('dedupeRealmsByIdentity keeps the caller spellings, one per realm', function (assert) {
      assert.deepEqual(
        dedupeRealmsByIdentity(virtualNetwork, [
          baseRealm.url,
          'https://example.com/realm',
          '@cardstack/base/',
          new URL(resolvedBaseRealmURL).href,
        ]),
        [baseRealm.url, 'https://example.com/realm/'],
      );
    });
  });
});
