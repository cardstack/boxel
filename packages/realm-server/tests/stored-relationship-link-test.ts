import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';
import { storedRelationshipLink } from '@cardstack/runtime-common/file-serializer';

const realmURL = new URL('http://test/realm/');
const relativeTo = new URL('http://test/realm/hassan.json');
const ownPrefix = '@cardstack/realm/';
const otherPrefix = '@cardstack/catalog/';
const otherRealm = 'http://test/catalog/';

// A VirtualNetwork stand-in that maps one prefix onto the realm under test and
// another onto a second realm, so a scoped reference can point either inside
// or outside the writing realm — the distinction the helper exists to draw.
function makeStubNetwork(): VirtualNetwork {
  let targets: [string, string][] = [
    [ownPrefix, realmURL.href],
    [otherPrefix, otherRealm],
  ];
  return {
    isRegisteredPrefix(reference: string) {
      return targets.some(([prefix]) => reference.startsWith(prefix));
    },
    resolveURL(reference: string, base: URL | string | undefined) {
      for (let [prefix, target] of targets) {
        if (reference.startsWith(prefix)) {
          return new URL(reference.slice(prefix.length), target);
        }
      }
      return new URL(reference, base ?? undefined);
    },
  } as unknown as VirtualNetwork;
}

function stored(selfLink: string): string {
  return storedRelationshipLink(
    selfLink,
    relativeTo,
    realmURL,
    makeStubNetwork(),
  );
}

module(basename(import.meta.filename), function () {
  module('storedRelationshipLink', function () {
    test('stores an in-realm URL relative', function (assert) {
      assert.strictEqual(stored('http://test/realm/jade'), './jade');
    });

    test('stores an in-realm scoped reference relative', function (assert) {
      // Regression: passing a scoped reference straight to
      // `maybeRelativeReference` returns it unchanged, because the pair is
      // mixed RRI/URL. Resolving first is what makes this relative.
      assert.strictEqual(stored(`${ownPrefix}jade`), './jade');
    });

    test('stores a cross-realm scoped reference exactly as sent', function (assert) {
      assert.strictEqual(
        stored(`${otherPrefix}Pet/vangogh`),
        `${otherPrefix}Pet/vangogh`,
      );
    });

    // The case the write suite caught and this stub originally hid: the stub
    // registered every prefix it was asked about, while the realm-server
    // harness registers only `@cardstack/base/`. Resolving an unregistered
    // scoped reference joins it against the base as though it were relative.
    test('stores an unregistered scoped reference exactly as sent', function (assert) {
      assert.strictEqual(
        stored('@nobody/knows-this/Pet/vangogh'),
        '@nobody/knows-this/Pet/vangogh',
      );
    });

    test('stores a cross-realm URL resolved', function (assert) {
      assert.strictEqual(
        stored('http://elsewhere/other/Pet/vangogh'),
        'http://elsewhere/other/Pet/vangogh',
      );
    });

    test('leaves a reference that will not resolve alone', function (assert) {
      let network = {
        isRegisteredPrefix: () => false,
        resolveURL() {
          throw new Error('nope');
        },
      } as unknown as VirtualNetwork;
      assert.strictEqual(
        storedRelationshipLink('::not a url::', relativeTo, realmURL, network),
        '::not a url::',
      );
    });
  });
});
