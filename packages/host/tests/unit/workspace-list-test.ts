import { module, test } from 'qunit';

import {
  favoritesTileWidth,
  isHostedRealm,
  sortByCreatedAtDesc,
  unreachableRealmServersMessage,
  wallpaperImage,
} from '@cardstack/host/lib/workspace-list';

module('Unit | workspace list', function () {
  test('a realm is hosted once it has a published URL', function (assert) {
    assert.true(isHostedRealm({ lastPublishedAt: { 'https://a.test/': '1' } }));
    assert.false(isHostedRealm({ lastPublishedAt: {} }));
    assert.false(isHostedRealm({ lastPublishedAt: null }));
    assert.false(isHostedRealm({}));
  });

  test('a wallpaper is a quoted CSS image, and none without a background', function (assert) {
    assert.strictEqual(
      wallpaperImage('https://a.test/bg (1).png'),
      'url("https://a.test/bg (1).png")',
    );
    assert.strictEqual(wallpaperImage(null), undefined);
    assert.strictEqual(wallpaperImage(''), undefined);
  });

  test('sorts newest first, with undated realms last', function (assert) {
    let info: Record<string, { createdAt?: string }> = {
      old: { createdAt: '2026-01-01' },
      new: { createdAt: '2026-06-01' },
      undated: {},
    };
    assert.deepEqual(
      sortByCreatedAtDesc(['undated', 'old', 'new'], (url) => info[url]),
      ['new', 'old', 'undated'],
    );
  });

  test('names each unreachable server by host', function (assert) {
    assert.strictEqual(
      unreachableRealmServersMessage(
        ['https://a.test/', 'https://b.test:8080/'],
        false,
      ),
      'Couldn’t reach a.test, b.test:8080. Some workspaces may be missing — reload to try again.',
    );
    assert.strictEqual(
      unreachableRealmServersMessage(['not a url'], true),
      'Couldn’t reach not a url. Some workspaces may be missing — retrying…',
    );
  });

  test('favorite tiles take two tiles per three that fit', function (assert) {
    // Four fit per row, so two favorites span it.
    assert.strictEqual(favoritesTileWidth(1000, 200, 10), 410);
    // Three fit, rounded up to two favorites.
    assert.strictEqual(favoritesTileWidth(620, 200, 10), 305);
    assert.strictEqual(favoritesTileWidth(200, 200, 10), 200);
    assert.strictEqual(favoritesTileWidth(1000, 0, 10), null);
  });
});
