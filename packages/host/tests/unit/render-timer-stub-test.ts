import { module, test } from 'qunit';

import {
  enableRenderTimerStub,
  beginTimerBlock,
  scheduleNativeTimeout,
} from '@cardstack/host/utils/render-timer-stub';

module('Unit | Utils | render timer stub', function () {
  test('pre-existing intervals still fire while timers are blocked', async function (assert) {
    assert.expect(1);
    let originalSetTimeout = window.setTimeout.bind(window);
    let restoreStub = enableRenderTimerStub();
    try {
      let intervalFired = false;
      let intervalHandle = window.setInterval(() => {
        intervalFired = true;
        window.clearInterval(intervalHandle);
      }, 5);

      let releaseBlock = beginTimerBlock();
      await new Promise<void>((resolve) => {
        originalSetTimeout(() => {
          releaseBlock();
          resolve();
        }, 30);
      });

      await new Promise<void>((resolve) => {
        originalSetTimeout(resolve, 10);
      });

      assert.true(intervalFired, 'interval fired even while timers blocked');
    } finally {
      restoreStub();
    }
  });

  test('timers scheduled while blocked do not run until block is released', async function (assert) {
    assert.expect(2);
    let originalSetTimeout = window.setTimeout.bind(window);
    let restoreStub = enableRenderTimerStub();
    try {
      let blockedTimerFired = false;
      let postBlockTimerFired = false;

      let releaseBlock = beginTimerBlock();
      window.setTimeout(() => {
        blockedTimerFired = true;
      }, 0);

      await new Promise<void>((resolve) => {
        originalSetTimeout(resolve, 10);
      });

      assert.false(blockedTimerFired, 'timer created during block never runs');

      releaseBlock();

      window.setTimeout(() => {
        postBlockTimerFired = true;
      }, 0);

      await new Promise<void>((resolve) => {
        originalSetTimeout(resolve, 10);
      });

      assert.true(
        postBlockTimerFired,
        'timer created after block runs normally',
      );
    } finally {
      restoreStub();
    }
  });

  test('scheduleNativeTimeout resolves a sleep promise while timers are blocked', async function (assert) {
    // The loader's transient-5xx retry uses an injected sleep that goes
    // through scheduleNativeTimeout so the retry actually fires during
    // prerender. Without this bypass, `setTimeout(resolve, ms)` would be
    // silently swallowed by the stub and the awaited promise would never
    // resolve, hanging the render until the prerender timeout.
    assert.expect(2);
    let restoreStub = enableRenderTimerStub();
    try {
      let releaseBlock = beginTimerBlock();
      try {
        let stubbedSleepFired = false;
        window.setTimeout(() => {
          stubbedSleepFired = true;
        }, 0);

        let resolved = false;
        await new Promise<void>((resolve) =>
          scheduleNativeTimeout(() => {
            resolved = true;
            resolve();
          }, 5),
        );

        assert.true(resolved, 'native-scheduled sleep promise resolved');
        assert.false(
          stubbedSleepFired,
          'a setTimeout callback scheduled while blocked still does not fire',
        );
      } finally {
        releaseBlock();
      }
    } finally {
      restoreStub();
    }
  });
});
