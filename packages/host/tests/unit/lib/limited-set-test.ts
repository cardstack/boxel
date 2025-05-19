import { module, test } from 'qunit';

import LimitedSet from '@cardstack/host/lib/limited-set';

module('Unit | Lib | limited-set', function () {
  test('constructor sets the max size correctly', function (assert) {
    const set = new LimitedSet<number>(5);
    for (let i = 0; i < 10; i++) {
      set.add(i);
    }
    assert.strictEqual(set.size, 5, 'Set limits size to the max specified');
  });

  test('add() adds items to the set', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    assert.true(set.has('item1'), 'Item was added to the set');
    assert.strictEqual(set.size, 1, 'Set size is updated');
  });

  test('add() does not duplicate items', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    set.add('item1');
    assert.strictEqual(set.size, 1, 'Duplicate items are not added');
  });

  test('add() updates the position of existing items', function (assert) {
    const set = new LimitedSet<string>(3);
    set.add('item1');
    set.add('item2');
    set.add('item3');
    // item1 should be oldest now, but adding it again should make it newest
    set.add('item1');
    // Adding a new item should remove the oldest item (item2)
    set.add('item4');

    assert.true(set.has('item1'), 'item1 was kept (as it was refreshed)');
    assert.true(set.has('item3'), 'item3 was kept');
    assert.true(set.has('item4'), 'item4 was added');
    assert.false(set.has('item2'), 'item2 was removed as the oldest item');
  });

  test('has() returns true for items in the set', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    assert.true(set.has('item1'), 'has() returns true for existing items');
    assert.false(
      set.has('item2'),
      'has() returns false for non-existing items',
    );
  });

  test('delete() removes items from the set', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    set.add('item2');

    assert.true(
      set.delete('item1'),
      'delete() returns true when item was deleted',
    );
    assert.false(set.has('item1'), 'Item was removed from the set');
    assert.strictEqual(set.size, 1, 'Set size is updated');

    assert.false(
      set.delete('item3'),
      'delete() returns false when item was not in set',
    );
  });

  test('clear() empties the set', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    set.add('item2');

    set.clear();
    assert.strictEqual(set.size, 0, 'Set is emptied after clear()');
    assert.false(set.has('item1'), 'Items are removed after clear()');
  });

  test('toArray() returns array of all items', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    set.add('item2');

    const array = set.toArray();
    assert.strictEqual(array.length, 2, 'Array contains all items');
    assert.true(array.includes('item1'), 'Array contains item1');
    assert.true(array.includes('item2'), 'Array contains item2');
  });

  test('iteration works correctly', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    set.add('item2');

    const items = [];
    for (const item of set) {
      items.push(item);
    }

    assert.strictEqual(items.length, 2, 'Iterated over all items');
    assert.true(items.includes('item1'), 'Iteration includes item1');
    assert.true(items.includes('item2'), 'Iteration includes item2');
  });

  test('oldest items are removed when reaching max size', function (assert) {
    const set = new LimitedSet<number>(3);
    set.add(1);
    set.add(2);
    set.add(3);
    set.add(4);

    assert.strictEqual(set.size, 3, 'Set size is limited to max size');
    assert.false(set.has(1), 'Oldest item (1) was removed');
    assert.true(set.has(2), 'Newer items are kept');
    assert.true(set.has(3), 'Newer items are kept');
    assert.true(set.has(4), 'Newest item was added');
  });

  test('values() returns an iterator for all values in the set', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    set.add('item2');

    const values = set.values();
    const valuesArray = Array.from(values);

    assert.strictEqual(
      valuesArray.length,
      2,
      'Values iterator contains all items',
    );
    assert.true(
      valuesArray.includes('item1'),
      'Values iterator contains item1',
    );
    assert.true(
      valuesArray.includes('item2'),
      'Values iterator contains item2',
    );
  });

  test('values() can be used in for-of loops', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    set.add('item2');

    const items = [];
    for (const item of set.values()) {
      items.push(item);
    }

    assert.strictEqual(items.length, 2, 'Iterated over all items');
    assert.true(items.includes('item1'), 'Iteration includes item1');
    assert.true(items.includes('item2'), 'Iteration includes item2');
  });

  test('values() correctly reflects updates to the set', function (assert) {
    const set = new LimitedSet<string>(5);
    set.add('item1');
    set.add('item2');

    set.add('item3');
    set.delete('item1');

    const valuesArray = Array.from(set.values());

    assert.strictEqual(
      valuesArray.length,
      2,
      'Values iterator shows correct size',
    );
    assert.false(
      valuesArray.includes('item1'),
      'Deleted item is not in values',
    );
    assert.true(valuesArray.includes('item2'), 'Existing item is in values');
    assert.true(valuesArray.includes('item3'), 'New item is in values');
  });
});
