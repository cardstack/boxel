import { module, test } from 'qunit';

import { VirtualNetwork } from '@cardstack/runtime-common';

// `realmForReference` answers which realm holds a given reference, and is what
// lets a query-backed field target "wherever these references live" without a
// card definition holding the realm mappings itself.
//
// The cases below mirror how a realm-server actually registers realms: the base
// realm gets both a URL mapping (from the `https://cardstack.com/base/` space)
// and a prefix mapping, scoped realms get a prefix mapping, and everything else
// is self-mapped by URL only. A reference may arrive in any of those spellings.
module('VirtualNetwork | realmForReference', function () {
  const REAL_BASE = 'https://realm.example/base/';
  const VIRTUAL_BASE = 'https://cardstack.com/base/';
  const CATALOG = 'https://realm.example/catalog/';
  const EXPERIMENTS = 'https://realm.example/experiments/';
  const USER = 'https://realm.example/user/alice/';

  function network() {
    let vn = new VirtualNetwork();
    // base: reachable at a real URL, addressed as a virtual one, and prefixed
    vn.addURLMapping(new URL(VIRTUAL_BASE), new URL(REAL_BASE));
    vn.addRealmMapping('@cardstack/base/', REAL_BASE);
    // catalog: prefixed
    vn.addRealmMapping('@cardstack/catalog/', CATALOG);
    // realms with no prefix at all — registered only by a self URL mapping
    vn.addURLMapping(new URL(EXPERIMENTS), new URL(EXPERIMENTS));
    vn.addURLMapping(new URL(USER), new URL(USER));
    return vn;
  }

  test('places a prefix-form reference', function (assert) {
    assert.strictEqual(
      network().realmForReference('@cardstack/catalog/Theme/brand'),
      CATALOG,
    );
  });

  test('places a real-URL reference', function (assert) {
    assert.strictEqual(
      network().realmForReference(`${CATALOG}Theme/brand`),
      CATALOG,
    );
  });

  test('places a reference written in a virtual URL space', function (assert) {
    // `https://cardstack.com/base/...` names base through a URL mapping rather
    // than through its prefix or its real URL.
    assert.strictEqual(
      network().realmForReference(`${VIRTUAL_BASE}Theme/brand`),
      VIRTUAL_BASE,
    );
  });

  test('answers with the URL the realm calls itself', function (assert) {
    // base is served as the virtual URL and its index rows are stored under it,
    // so both spellings must fold to that rather than to the mapping target.
    let vn = network();
    assert.strictEqual(
      vn.realmForReference('@cardstack/base/Theme/brand'),
      VIRTUAL_BASE,
      'the prefix spelling folds to the virtual URL',
    );
    assert.strictEqual(
      vn.realmForReference(`${REAL_BASE}Theme/brand`),
      VIRTUAL_BASE,
      'the real URL folds to the virtual URL',
    );
  });

  test('places a realm that has no prefix mapping', function (assert) {
    // Most realms are registered only by a self URL mapping; matching prefix
    // mappings alone would leave them unplaceable.
    let vn = network();
    assert.strictEqual(
      vn.realmForReference(`${EXPERIMENTS}Post/1`),
      EXPERIMENTS,
    );
    assert.strictEqual(vn.realmForReference(`${USER}Note/1`), USER);
  });

  test('attributes a nested realm to the deepest match', function (assert) {
    // `/user/alice/` is a realm and `/user/` is not, so a realm cannot be
    // recovered by counting path segments — longest match decides.
    let vn = network();
    vn.addURLMapping(
      new URL('https://realm.example/user/'),
      new URL('https://realm.example/user/'),
    );
    assert.strictEqual(vn.realmForReference(`${USER}Note/1`), USER);
  });

  test('returns undefined for a reference no realm holds', function (assert) {
    assert.strictEqual(
      network().realmForReference('https://elsewhere.example/Note/1'),
      undefined,
    );
  });
});
