/**
 * Choreo's test-support adds its resets to glimmer-motion's reset registry
 * with `registerMotionReset()`, so `resetMotion()` clears them too, and a
 * beacon claimed in one test is gone by the next.
 */
import '@cardstack/choreo/test-support';

import { measureBeacons, registerBeacon } from '@cardstack/choreo/beacons';
import { resetMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

module('Unit | motion reset registry', function () {
  test("resetMotion clears Choreo's beacon registry", function (assert) {
    const element = document.createElement('div');
    document.body.append(element);
    try {
      registerBeacon('trash', element);
      const root = document.body.getBoundingClientRect();
      assert.true(measureBeacons(root).has('trash'), 'the beacon is claimed');
      resetMotion();
      assert.false(measureBeacons(root).has('trash'), 'the claim is gone');
    } finally {
      element.remove();
    }
  });
});
