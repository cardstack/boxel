import { TweenBehavior } from '@cardstack/boxel-motion';
import { module, test } from 'qunit';

module('Unit | Behaviors | Tween', function () {
  test('generates minimum of 2 frames', function (assert) {
    let behavior = new TweenBehavior();

    assert.deepEqual(
      Array.from(behavior.getFrames({ from: 0, to: 1, duration: 0 })),
      [
        {
          value: 0,
          velocity: 0,
        },
        {
          value: 1,
          velocity: 0,
        },
      ],
    );
    assert.deepEqual(
      Array.from(behavior.getFrames({ from: 1, to: 0, duration: 0 })),
      [
        {
          value: 1,
          velocity: 0,
        },
        {
          value: 0,
          velocity: 0,
        },
      ],
    );
  });

  test('does nothing when from and to are the same', function (assert) {
    let behavior = new TweenBehavior();

    assert.deepEqual(
      Array.from(behavior.getFrames({ from: 1, to: 1, duration: 0 })),
      [],
    );
    assert.deepEqual(
      Array.from(behavior.getFrames({ from: 0, to: 0, duration: 0 })),
      [],
    );
  });

  test('frames are generated at 60 FPS (linear easing)', function (assert) {
    let behavior = new TweenBehavior();

    let frames = Array.from(
      behavior.getFrames({ from: 0, to: 1, duration: 100 }),
    );

    assert.equal(frames.length, 7);
    assert.deepEqual(frames, [
      {
        value: 0,
        velocity: 0,
      },
      {
        value: 0.16666666666666666,
        velocity: 0.000009999999999999999,
      },
      {
        value: 0.3333333333333333,
        velocity: 0.000009999999999999999,
      },
      {
        value: 0.5,
        velocity: 0.000009999999999999999,
      },
      {
        value: 0.6666666666666666,
        velocity: 0.00001,
      },
      {
        value: 0.8333333333333334,
        velocity: 0.00001,
      },
      {
        value: 1,
        velocity: 0,
      },
    ]);
  });

  test('takes a delay into account (linear easing)', function (assert) {
    let behavior = new TweenBehavior();

    let frames = Array.from(
      behavior.getFrames({
        from: 0,
        to: 1,
        duration: 100,
        delay: 50,
      }),
    );

    assert.equal(frames.length, 10);
    assert.deepEqual(frames, [
      {
        value: 0,
        velocity: 0,
      },
      {
        value: 0,
        velocity: 0,
      },
      {
        value: 0,
        velocity: 0,
      },
      {
        value: 0,
        velocity: 0,
      },
      {
        value: 0.16666666666666666,
        velocity: 0.000009999999999999999,
      },
      {
        value: 0.3333333333333333,
        velocity: 0.000009999999999999999,
      },
      {
        value: 0.5,
        velocity: 0.000009999999999999999,
      },
      {
        value: 0.6666666666666666,
        velocity: 0.00001,
      },
      {
        value: 0.8333333333333334,
        velocity: 0.00001,
      },
      {
        value: 1,
        velocity: 0,
      },
    ]);
  });
});
