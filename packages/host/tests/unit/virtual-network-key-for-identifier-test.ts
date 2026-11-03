import { module, test } from 'qunit';

import { VirtualNetwork } from '@cardstack/runtime-common';

// `keyForIdentifier` is the URL a browser can open for an id: the copy-URL
// menu actions copy what it returns.
module('VirtualNetwork | keyForIdentifier', function () {
  const SKILLS = 'https://realm.example/skills/';
  const SERVED = 'https://realm.example/served/';
  const ALIAS = 'https://alias.example/served/';

  function network() {
    let vn = new VirtualNetwork();
    vn.addRealmMapping('@cardstack/skills/', SKILLS);
    vn.addURLMapping(new URL(ALIAS), new URL(SERVED));
    return vn;
  }

  test('folds a prefix-form id onto the realm URL', function (assert) {
    assert.strictEqual(
      network().keyForIdentifier(
        '@cardstack/skills/skills/design-review/SKILL.md',
      ),
      `${SKILLS}skills/design-review/SKILL.md`,
    );
  });

  test('folds an aliased URL onto the URL it is served from', function (assert) {
    assert.strictEqual(
      network().keyForIdentifier(`${ALIAS}card-api`),
      `${SERVED}card-api`,
    );
  });

  test('keeps an id nothing maps', function (assert) {
    assert.strictEqual(
      network().keyForIdentifier('@unknown/realm/Person/1'),
      '@unknown/realm/Person/1',
    );
  });
});
