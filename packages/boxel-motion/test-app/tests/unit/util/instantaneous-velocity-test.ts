import { instantaneousVelocity } from '@cardstack/boxel-motion/utils';
import { module, test } from 'qunit';

module('Unit | Util | instantaneousVelocity', function () {
  test('calculates the instantaneous velocity in units per second (60FPS) based on the surrounding frames', function (assert) {
    let frames = [
      {
        value: 0,
        velocity: 0,
      },
      {
        value: 10,
        velocity: 0,
      },
      {
        value: 20,
        velocity: 0,
      },
    ];

    assert.equal(instantaneousVelocity(1, frames), 0.0006);
  });

  test('returns a velocity of 0 if there is no previous frame', function (assert) {
    let frames = [
      {
        value: 0,
        velocity: 0,
      },
      {
        value: 10,
        velocity: 0,
      },
      {
        value: 20,
        velocity: 0,
      },
    ];

    assert.equal(instantaneousVelocity(0, frames), 0);
  });

  test('returns a velocity of 0 if there is no next frame', function (assert) {
    let frames = [
      {
        value: 0,
        velocity: 0,
      },
      {
        value: 10,
        velocity: 0,
      },
      {
        value: 20,
        velocity: 0,
      },
    ];

    assert.equal(instantaneousVelocity(2, frames), 0);
  });
});
