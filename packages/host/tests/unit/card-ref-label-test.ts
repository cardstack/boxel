import { module, test } from 'qunit';

import { cardRefLabel } from '@cardstack/host/lib/reply-furniture';

module('Unit | cardRefLabel', function () {
  test('a card is named by its id, as words', function (assert) {
    assert.strictEqual(
      cardRefLabel('https://realm.example/team/ClubMember/lena-ruiz'),
      'Lena Ruiz',
    );
    assert.strictEqual(
      cardRefLabel('https://realm.example/team/Plan/autumn_relaunch.json'),
      'Autumn Relaunch',
    );
  });

  test('a file keeps its name and extension', function (assert) {
    assert.strictEqual(
      cardRefLabel('https://realm.example/team/notes/plan.md'),
      'plan.md',
    );
  });

  test('a trailing slash, a query or an escape does not leak into the name', function (assert) {
    assert.strictEqual(
      cardRefLabel('https://realm.example/team/Member/omar-haddad/?x=1#top'),
      'Omar Haddad',
    );
    assert.strictEqual(
      cardRefLabel('https://realm.example/team/Member/ren%C3%A9e'),
      'Renée',
    );
    assert.strictEqual(cardRefLabel(undefined), '');
  });

  test('a card with an opaque id is named by the folder it sits in', function (assert) {
    assert.strictEqual(
      cardRefLabel(
        'https://realm.example/catalog/41e20f-wedding-table-seating-planner/CardListing/6241aa1f-0a8a-45f3-9b8b-57ac600070c4',
      ),
      'Wedding Table Seating Planner',
    );
    assert.strictEqual(
      cardRefLabel('https://realm.example/team/Member/omar-haddad'),
      'Omar Haddad',
      'a readable id still names it',
    );
  });
});
