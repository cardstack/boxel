import { module, test } from 'qunit';

import {
  removeTopmost,
  unwindOrPush,
} from '@cardstack/host/utils/host-mode-stack';

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

module('Unit | host-mode-stack | removeTopmost', function () {
  test('removes the card and reports the change', function (assert) {
    let stack = ['b', 'c'];
    assert.true(removeTopmost(stack, 'b'));
    assert.deepEqual(stack, ['c']);
  });

  test('reports no change when the card is absent', function (assert) {
    let stack = ['b'];
    assert.false(removeTopmost(stack, 'c'));
    assert.deepEqual(stack, ['b'], 'the trail is untouched');
  });

  test('removes the topmost copy of a duplicated card', function (assert) {
    // Closing targets the copy on screen — the stack's top card. Removing the
    // first copy instead would leave the visible card in place and silently
    // drop one the user was not acting on.
    let stack = ['a', 'b', 'a'];
    assert.true(removeTopmost(stack, 'a'));
    assert.deepEqual(stack, ['a', 'b']);
  });

  test('closing a whole trail of duplicates from the top down empties it', function (assert) {
    // What a breadcrumb click does: close every card above the crumb, lowest
    // id first, one call each.
    let stack = ['a', 'b', 'a', 'b'];
    for (let cardId of ['b', 'a', 'b']) {
      removeTopmost(stack, cardId);
    }
    assert.deepEqual(stack, ['a'], 'unwinds to the clicked crumb');
  });
});
