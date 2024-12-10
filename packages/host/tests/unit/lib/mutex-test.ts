import { waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import Mutex from '@cardstack/host/lib/mutex';

module('Unit | Utility | Mutex', function () {
  test('it prevents concurrent access', async function (assert) {
    let mutex = new Mutex();
    let lock1Acquired = false;
    let lock2Acquired = false;

    await mutex.dispatch(async () => {
      lock1Acquired = true;
      assert.true(lock1Acquired, 'First lock should be acquired');

      mutex.dispatch(async () => {
        lock2Acquired = true;
      });

      assert.false(lock2Acquired, 'Second lock should not be acquired yet');
    });

    await waitUntil(() => lock2Acquired);
    assert.true(
      lock2Acquired,
      'Second lock should be acquired after first is released',
    );
  });

  test('it handles multiple locks and unlocks', async function (assert) {
    let mutex = new Mutex();
    let lock1Acquired = false;
    let lock2Acquired = false;
    let lock3Acquired = false;
    let completeDispatch1 = false;
    let completeDispatch2 = false;
    let completeDispatch3 = false;

    mutex.dispatch(async () => {
      lock1Acquired = true;
      assert.true(lock1Acquired, 'First lock should be acquired');

      mutex.dispatch(async () => {
        lock2Acquired = true;
        await waitUntil(() => completeDispatch2);
      });

      mutex.dispatch(async () => {
        lock3Acquired = true;
        await waitUntil(() => completeDispatch3);
      });

      await waitUntil(() => completeDispatch1);
    });

    assert.false(lock2Acquired, 'Second lock should not be acquired yet');
    assert.false(lock3Acquired, 'Third lock should not be acquired yet');

    completeDispatch1 = true;

    await waitUntil(() => lock2Acquired);

    assert.true(
      lock2Acquired,
      'Second lock should be acquired after first is released',
    );
    assert.false(lock3Acquired, 'Third lock should not be acquired yet');

    completeDispatch2 = true;

    await waitUntil(() => lock3Acquired);
    assert.true(
      lock3Acquired,
      'Third lock should be acquired after second is released',
    );
    completeDispatch3 = true;
  });

  test('it handles errors within the dispatch method', async function (assert) {
    let mutex = new Mutex();
    let lockAcquired = false;
    let errorCaught: Error | undefined;

    try {
      await mutex.dispatch(async () => {
        lockAcquired = true;
        throw new Error('Test error');
      });
    } catch (e: any) {
      errorCaught = e;
    }

    assert.true(lockAcquired, 'Lock should be acquired');
    assert.strictEqual(
      errorCaught?.message,
      'Test error',
      'Error should be caught',
    );
  });
});
