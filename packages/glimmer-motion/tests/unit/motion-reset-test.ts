/**
 * `resetMotion()` runs glimmer-motion's own resets and then every reset a
 * layer added with `registerMotionReset()`.
 */
import { registerMotionReset, resetMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

module('Unit | motion reset registry', function () {
  test('resetMotion runs each registered reset once, in the order added', function (assert) {
    const calls: string[] = [];
    const first = () => calls.push('first');
    const second = () => calls.push('second');
    const removeFirst = registerMotionReset(first);
    const removeSecond = registerMotionReset(second);
    registerMotionReset(first);
    try {
      resetMotion();
      assert.deepEqual(calls, ['first', 'second']);
    } finally {
      removeFirst();
      removeSecond();
    }
  });

  test('a removed reset no longer runs', function (assert) {
    let calls = 0;
    const remove = registerMotionReset(() => calls++);
    remove();
    resetMotion();
    assert.strictEqual(calls, 0);
  });
});
