import { module, test } from 'qunit';
import LinearBehavior from 'animations/behaviors/linear';

module('Unit | Behaviors | Linear', function () {
  test('generates minimum of 2 frames', function (assert) {
    let behavior = new LinearBehavior();

    assert.deepEqual(behavior.toFrames(0, 1, 0, 0), [0, 1]);
    assert.deepEqual(behavior.toFrames(1, 0, 0, 0), [1, 0]);
  });

  test('frames are generated at 60 FPS', function (assert) {
    let behavior = new LinearBehavior();

    let frames = behavior.toFrames(0, 1, 100, 0);

    assert.equal(frames.length, 7);
    assert.deepEqual(frames, [
      0,
      0.16666666666666666,
      0.3333333333333333,
      0.5,
      0.6666666666666666,
      0.8333333333333334,
      1,
    ]);
  });

  test('takes a delay into account', function (assert) {
    let behavior = new LinearBehavior();

    let frames = behavior.toFrames(0, 1, 100, 0, 50);

    assert.equal(frames.length, 10);
    assert.deepEqual(frames, [
      0,
      0,
      0,
      0,
      0.16666666666666666,
      0.3333333333333333,
      0.5,
      0.6666666666666666,
      0.8333333333333334,
      1,
    ]);
  });

  test('takes previous frames into account', function (assert) {
    let behavior = new LinearBehavior();

    let previousFrames = [0.25, 0.5, 0.75, 1];
    let frames = behavior.toFrames(1, 0, 100, 0, 0, previousFrames);

    assert.equal(frames.length, 7);
    assert.deepEqual(frames, [
      0.25,
      0.6111111111111112,
      0.6944444444444444,
      0.5,
      0.33333333333333337,
      0.16666666666666663,
      0,
    ]);
  });

  test('takes previous frames and delay into account', function (assert) {
    let behavior = new LinearBehavior();

    let previousFrames = [0.25, 0.5, 0.75, 1];
    let frames = behavior.toFrames(1, 0, 100, 0, 50, previousFrames);

    assert.equal(frames.length, 10);
    assert.deepEqual(frames, [
      0.25,
      0.6666666666666667,
      0.9166666666666666,
      1,
      0.8333333333333334,
      0.6666666666666667,
      0.5,
      0.33333333333333337,
      0.16666666666666663,
      0,
    ]);
  });
});
