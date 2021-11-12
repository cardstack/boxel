import { module, test } from 'qunit';
import BaseValue, { Value } from 'animations/value/index';
import LinearBehavior from 'animations/behaviors/linear';

module('Unit | BaseValue | Index', function () {
  module('keyframe generation with linear behavior', function () {
    test('from single keyframe motion with 3 frames', function (assert) {
      let value = new BaseValue('opacity', 0);
      assert.deepEqual(value.keyframes, []);

      value.applyBehavior(new LinearBehavior(), 1 as Value, 1);
      assert.deepEqual(value.keyframes, [{ opacity: 0 }, { opacity: 1 }]);

      value.applyBehavior(new LinearBehavior(), 0, 1);
      assert.deepEqual(value.keyframes, [{ opacity: 1 }, { opacity: 0 }]);
    });

    test('keyframes are generated at 60 FPS', function (assert) {
      let value = new BaseValue('opacity', 0);
      assert.deepEqual(value.keyframes, []);

      value.applyBehavior(new LinearBehavior(), 1, 100);
      assert.deepEqual(value.keyframes, [
        { opacity: 0 },
        { opacity: 0.16666666666666666 },
        { opacity: 0.3333333333333333 },
        { opacity: 0.5 },
        { opacity: 0.6666666666666666 },
        { opacity: 0.8333333333333334 },
        { opacity: 1 },
      ]);
    });

    test('interruption based on time is handled', function (assert) {
      let behavior = new LinearBehavior();
      let value = new BaseValue('opacity', 0, { transferVelocity: false });
      assert.deepEqual(value.keyframes, []);

      value.applyBehavior(behavior, 1, 100);
      assert.deepEqual(value.keyframes, [
        { opacity: 0 },
        { opacity: 0.16666666666666666 },
        { opacity: 0.3333333333333333 },
        { opacity: 0.5 },
        { opacity: 0.6666666666666666 },
        { opacity: 0.8333333333333334 },
        { opacity: 1 },
      ]);

      value.applyBehavior(behavior, 0.2, 34, 0, 50);
      assert.deepEqual(value.keyframes, [
        { opacity: 0.5 },
        { opacity: 0.35 },
        { opacity: 0.2 },
      ]);
    });

    test('keyframe generation with numerical units', function (assert) {
      let value = new BaseValue('left', '0px');
      assert.deepEqual(value.keyframes, []);

      value.applyBehavior(new LinearBehavior(), '100px', 33);
      assert.deepEqual(value.keyframes, [
        { left: '0px' },
        { left: '50px' },
        { left: '100px' },
      ]);
    });

    test('keyframe generation with interruption and velocity transfer', function (assert) {
      let value = new BaseValue('opacity', 0);
      assert.deepEqual(value.keyframes, []);

      let behavior = new LinearBehavior();
      value.applyBehavior(behavior, 1, 100);
      assert.deepEqual(value.keyframes, [
        { opacity: 0 },
        { opacity: 0.16666666666666666 },
        { opacity: 0.3333333333333333 },
        { opacity: 0.5 },
        { opacity: 0.6666666666666666 },
        { opacity: 0.8333333333333334 },
        { opacity: 1 },
      ]);

      value.applyBehavior(behavior, 0, 100, 0, 50);
      assert.deepEqual(value.keyframes, [
        { opacity: 0.5 },
        { opacity: 0.5833333333333334 },
        { opacity: 0.5000000000000001 },
        { opacity: 0.25 },
        { opacity: 0.16666666666666669 },
        { opacity: 0.08333333333333331 },
        { opacity: 0 },
      ]);
    });
  });
});
