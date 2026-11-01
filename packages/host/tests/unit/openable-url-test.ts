import { module, test } from 'qunit';

import { VirtualNetwork } from '@cardstack/runtime-common';

import { openableURL } from '@cardstack/host/utils/clipboard';

module('Unit | openableURL', function () {
  const SKILLS = 'https://realm.example/skills/';
  const USER = 'https://realm.example/user/alice/';

  function network() {
    let vn = new VirtualNetwork();
    vn.addRealmMapping('@cardstack/skills/', SKILLS);
    vn.addURLMapping(new URL(USER), new URL(USER));
    return vn;
  }

  test('turns a prefix-form id into the realm URL', function (assert) {
    assert.strictEqual(
      openableURL('@cardstack/skills/skills/design-review/SKILL.md', network()),
      `${SKILLS}skills/design-review/SKILL.md`,
    );
  });

  test('keeps a URL id as it is', function (assert) {
    assert.strictEqual(
      openableURL(`${USER}Person/1`, network()),
      `${USER}Person/1`,
    );
  });

  test('keeps an id no realm maps', function (assert) {
    assert.strictEqual(
      openableURL('@unknown/realm/Person/1', network()),
      '@unknown/realm/Person/1',
    );
  });
});
