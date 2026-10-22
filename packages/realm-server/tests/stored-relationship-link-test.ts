import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';
import { storedRelationshipLink } from '@cardstack/runtime-common/file-serializer';

const realmURL = new URL('http://test/realm/');
const relativeTo = new URL('http://test/realm/hassan.json');
const ownPrefix = '@test/realm/';
const otherPrefix = '@cardstack/catalog/';
const otherRealm = 'http://test/catalog/';

// One prefix maps onto the realm under test and another onto a second realm,
// so a reference can point either inside or outside the writing realm — the
// distinction the helper exists to draw.
function makeNetwork(): VirtualNetwork {
  let network = new VirtualNetwork();
  network.addRealmMapping(ownPrefix, realmURL.href);
  network.addRealmMapping(otherPrefix, otherRealm);
  return network;
}

function stored(selfLink: string): string {
  return storedRelationshipLink(selfLink, relativeTo, realmURL, makeNetwork());
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

    // Resolving a scoped reference whose prefix is not registered would join
    // it against the base as though it were relative.
    test('stores an unregistered scoped reference exactly as sent', function (assert) {
      assert.strictEqual(
        stored('@nobody/knows-this/Pet/vangogh'),
        '@nobody/knows-this/Pet/vangogh',
      );
    });

    test('stores a URL in a prefix-registered realm by its prefix', function (assert) {
      assert.strictEqual(
        stored(`${otherRealm}Pet/vangogh`),
        `${otherPrefix}Pet/vangogh`,
      );
    });

    test('stores a relative reference that leaves the realm by the prefix of the realm it lands in', function (assert) {
      assert.strictEqual(
        stored('../catalog/Pet/vangogh'),
        `${otherPrefix}Pet/vangogh`,
      );
    });

    test('stores a URL in a realm with no registered prefix resolved', function (assert) {
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
