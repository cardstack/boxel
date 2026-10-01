import { module, test } from 'qunit';
import {
  demoTuning,
  tuneMotion,
  tuneNumber,
  tuneVariants,
} from 'test-app/lib/demo-tuning';

module('Demo tuning boundary', function () {
  test('defaults preserve the exact demo values and object identities', function (assert) {
    const original = { type: 'spring', stiffness: 130, damping: 15 } as const;
    assert.strictEqual(tuneMotion('test-default', original, 'Carry'), original);
    assert.strictEqual(tuneNumber('test-default', 0.62, 'Timed rail'), 0.62);
    assert.deepEqual(Object.keys(demoTuning('test-default').definitions), [
      'Carry',
      'Timed rail',
    ]);
  });
  test('editing one named spring leaves other springs and tweens unchanged', function (assert) {
    const carry = { type: 'spring', stiffness: 130, damping: 15 } as const;
    const fade = { duration: 0.55 };
    demoTuning('test-independent').values = {
      Carry: { type: 'spring', stiffness: 200, damping: 20 },
    };
    assert.strictEqual(
      tuneMotion('test-independent', carry, 'Carry')?.stiffness,
      200
    );
    assert.strictEqual(tuneMotion('test-independent', carry, 'Return'), carry);
    assert.strictEqual(tuneMotion('test-independent', fade, 'Light'), fade);
    assert.strictEqual(tuneMotion('another-demo', carry, 'Carry'), carry);
  });
  test('variant controls change the intended property without flattening the scene', function (assert) {
    const original = { press: { scale: 0.44 }, hover: { scale: 1.1 } };
    demoTuning('test-variants').values = { 'Body press scale (×)': 0.7 };
    const result = tuneVariants('test-variants', original, 'Body');
    assert.strictEqual(result.press.scale, 0.7);
    assert.strictEqual(result.hover, original.hover);
    assert.strictEqual(original.press.scale, 0.44);
  });
  test('the named keyframe transition consumes curve edits and preserves repetition', function (assert) {
    const original = {
      duration: 1.35,
      ease: [0.22, 1, 0.36, 1],
      repeat: Infinity,
    } as const;
    demoTuning('test-curve').values = {
      transition: { type: 'easing', duration: 2, ease: [0.1, 0.2, 0.3, 1] },
    };
    const tween = tuneMotion('test-curve', original, 'transition');
    assert.strictEqual(tween?.duration, 2);
    assert.deepEqual(tween?.ease, [0.1, 0.2, 0.3, 1]);
    assert.strictEqual(tween?.repeat, Infinity);
    demoTuning('test-curve').values = {
      transition: { type: 'spring', stiffness: 200, damping: 20 },
    };
    const spring = tuneMotion('test-curve', original, 'transition');
    assert.strictEqual(spring?.stiffness, 200);
    assert.strictEqual(spring?.duration, undefined);
    assert.strictEqual(spring?.repeat, Infinity);
  });
});
