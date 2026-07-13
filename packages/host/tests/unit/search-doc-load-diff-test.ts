import { module, test } from 'qunit';

import { newLoadEntries } from '@cardstack/host/routes/render/meta';

// The store's completed-load histories are bounded top-N lists that persist
// across renders on a warm tab; `newLoadEntries` extracts just the loads a
// settle loop performed by multiset-diffing snapshots taken around it.
module('Unit | render meta | newLoadEntries', function () {
  const A = { url: 'https://realm.example/a', ms: 12 };
  const B = { url: 'https://realm.example/b', ms: 340 };
  const C = { url: 'https://realm.example/c', ms: 5 };

  test('returns entries present only in the after snapshot', function (assert) {
    assert.deepEqual(newLoadEntries([A], [A, B]), [B]);
  });

  test('returns everything when the before snapshot is empty', function (assert) {
    assert.deepEqual(newLoadEntries([], [A, B]), [A, B]);
  });

  test('multiset semantics: a repeated (url, ms) pair only reports the excess occurrences', function (assert) {
    assert.deepEqual(newLoadEntries([A, A], [A, A, A, B]), [A, B]);
  });

  test('an entry evicted from the bounded history produces nothing', function (assert) {
    assert.deepEqual(newLoadEntries([A, C], [A, B]), [B]);
  });

  test('same url with a different ms is a distinct load', function (assert) {
    let rerun = { url: A.url, ms: 99 };
    assert.deepEqual(newLoadEntries([A], [A, rerun]), [rerun]);
  });
});
