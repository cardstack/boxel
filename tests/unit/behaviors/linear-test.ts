import { module, test } from 'qunit';
import LinearBehavior from 'animations/behaviors/linear';

module('Unit | Behaviors | Linear', function () {
  test('generates minimum of 2 frames', function (assert) {
    let behavior = new LinearBehavior();

    assert.deepEqual(behavior.toFrames({ from: 0, to: 1, duration: 0 }), [
      {
        value: 0,
        velocity: 0.000059999999999999995,
      },
      {
        value: 1,
        velocity: 0.000059999999999999995,
      },
    ]);
    assert.deepEqual(behavior.toFrames({ from: 1, to: 0, duration: 0 }), [
      {
        value: 1,
        velocity: -0.000059999999999999995,
      },
      {
        value: 0,
        velocity: -0.000059999999999999995,
      },
    ]);
  });

  test('does nothing when from and to are the same', function (assert) {
    let behavior = new LinearBehavior();

    assert.deepEqual(behavior.toFrames({ from: 1, to: 1, duration: 0 }), []);
    assert.deepEqual(behavior.toFrames({ from: 0, to: 0, duration: 0 }), []);
  });

  test('frames are generated at 60 FPS', function (assert) {
    let behavior = new LinearBehavior();

    let frames = behavior.toFrames({ from: 0, to: 1, duration: 100 });

    assert.equal(frames.length, 7);
    assert.deepEqual(frames, [
      {
        value: 0,
        velocity: 0.00001,
      },
      {
        value: 0.16666666666666666,
        velocity: 0.00001,
      },
      {
        value: 0.3333333333333333,
        velocity: 0.00001,
      },
      {
        value: 0.5,
        velocity: 0.00001,
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
        velocity: 0.00001,
      },
    ]);
  });

  test('takes a delay into account', function (assert) {
    let behavior = new LinearBehavior();

    let frames = behavior.toFrames({
      from: 0,
      to: 1,
      duration: 100,
      delay: 50,
    });

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
        velocity: 0.00001,
      },
      {
        value: 0.16666666666666666,
        velocity: 0.00001,
      },
      {
        value: 0.3333333333333333,
        velocity: 0.00001,
      },
      {
        value: 0.5,
        velocity: 0.00001,
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
        velocity: 0.00001,
      },
    ]);
  });

  test('takes previous frames into account', function (assert) {
    let behavior = new LinearBehavior();

    let previousFramesFromTime = [
      { value: 0.25, velocity: 0.000015 },
      { value: 0.5, velocity: 0.000015 },
      { value: 0.75, velocity: 0.000015 },
      { value: 1, velocity: 0.000015 },
    ];
    let frames = behavior.toFrames({
      from: 1,
      to: 0,
      duration: 100,
      previousFramesFromTime,
    });

    assert.equal(frames.length, 7);
    assert.deepEqual(frames, [
      {
        value: 0.25,
        velocity: 0, // TODO: fix this, there should be a velocity here from the frame before
      },
      {
        value: 0.6111111111111112,
        velocity: 0.00001333333333333333,
      },
      {
        value: 0.6944444444444444,
        velocity: -0.000003333333333333335,
      },
      {
        value: 0.5,
        velocity: -0.00001083333333333333,
      },
      {
        value: 0.33333333333333337,
        velocity: -0.00001,
      },
      {
        value: 0.16666666666666663,
        velocity: -0.00001,
      },
      {
        value: 0,
        velocity: -0.00001,
      },
    ]);
  });

  test('takes previous frames and delay into account', function (assert) {
    let behavior = new LinearBehavior();

    let previousFramesFromTime = [
      { value: 0.25, velocity: 0.000015 },
      { value: 0.5, velocity: 0.000015 },
      { value: 0.75, velocity: 0.000015 },
      { value: 1, velocity: 0.000015 },
    ];
    let frames = behavior.toFrames({
      from: 1,
      to: 0,
      duration: 100,
      delay: 50,
      previousFramesFromTime,
    });

    assert.equal(frames.length, 10);
    assert.deepEqual(frames, [
      {
        value: 0.25,
        velocity: 0,
      },
      {
        value: 0.6666666666666667,
        velocity: 0.000019999999999999998,
      },
      {
        value: 0.9166666666666666,
        velocity: 0.000009999999999999997,
      },
      {
        value: 1,
        velocity: -0.0000024999999999999977,
      },
      {
        value: 0.8333333333333334,
        velocity: -0.00001,
      },
      {
        value: 0.6666666666666667,
        velocity: -0.00001,
      },
      {
        value: 0.5,
        velocity: -0.00001,
      },
      {
        value: 0.33333333333333337,
        velocity: -0.00001,
      },
      {
        value: 0.16666666666666663,
        velocity: -0.00001,
      },
      {
        value: 0,
        velocity: -0.00001,
      },
    ]);
  });

  test('takes last frame and previous frames into account', function (assert) {
    let behavior = new LinearBehavior();

    let lastFrame = {
      value: 0,
      velocity: 0.000015,
    };
    let previousFramesFromTime = [
      { value: 0.25, velocity: 0.000015 },
      { value: 0.5, velocity: 0.000015 },
      { value: 0.75, velocity: 0.000015 },
      { value: 1, velocity: 0.000015 },
    ];
    let frames = behavior.toFrames({
      from: 1,
      to: 0,
      duration: 100,
      lastFrame,
      previousFramesFromTime,
    });

    assert.equal(frames.length, 7);
    assert.deepEqual(frames, [
      {
        value: 0.25,
        velocity: 0.000018333333333333333,
      },
      {
        value: 0.6111111111111112,
        velocity: 0.00001333333333333333,
      },
      {
        value: 0.6944444444444444,
        velocity: -0.000003333333333333335,
      },
      {
        value: 0.5,
        velocity: -0.00001083333333333333,
      },
      {
        value: 0.33333333333333337,
        velocity: -0.00001,
      },
      {
        value: 0.16666666666666663,
        velocity: -0.00001,
      },
      {
        value: 0,
        velocity: -0.00001,
      },
    ]);
  });
});
