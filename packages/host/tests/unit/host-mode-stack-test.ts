import { module, test } from 'qunit';

import { unwindOrPush } from '@cardstack/host/utils/host-mode-stack';

module('Unit | host-mode-stack | unwindOrPush', function () {
  test('pushes a card that is not on the trail', function (assert) {
    let stack = ['b'];
    unwindOrPush(stack, 'c', 'a');
    assert.deepEqual(stack, ['b', 'c']);
  });

  test('pushes onto an empty trail', function (assert) {
    let stack: string[] = [];
    unwindOrPush(stack, 'b', 'a');
    assert.deepEqual(stack, ['b']);
  });

  test('clears the trail when the target is the primary card', function (assert) {
    let stack = ['b', 'c'];
    unwindOrPush(stack, 'a', 'a');
    assert.deepEqual(stack, [], 'everything above the root closes');
  });

  test('truncates above a card already mid-trail', function (assert) {
    let stack = ['b', 'c', 'd'];
    unwindOrPush(stack, 'b', 'a');
    assert.deepEqual(stack, ['b'], 'unwinds to the target, leaving it on top');
  });

  test('leaves the trail alone when the target is already on top', function (assert) {
    let stack = ['b', 'c'];
    unwindOrPush(stack, 'c', 'a');
    assert.deepEqual(stack, ['b', 'c']);
  });

  test('unwinds to the nearest occurrence of a duplicated card', function (assert) {
    // A hand-crafted or stale hostModeStack param is accepted verbatim, so
    // duplicates can still reach this even though pushing never creates them.
    let stack = ['a', 'b', 'a', 'c'];
    unwindOrPush(stack, 'a', 'primary');
    assert.deepEqual(
      stack,
      ['a', 'b', 'a'],
      'going back lands on the nearest copy, not the first one',
    );
  });

  test('a null primary card does not swallow the push', function (assert) {
    let stack = ['b'];
    unwindOrPush(stack, 'c', null);
    assert.deepEqual(stack, ['b', 'c']);
  });
});
