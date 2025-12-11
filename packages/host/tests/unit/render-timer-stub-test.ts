import { module, test } from 'qunit';

import {
  enableRenderTimerStub,
  beginTimerBlock,
} from '@cardstack/host/utils/render-timer-stub';

module('Unit | Utils | render timer stub', function () {
  test('pre-existing animation frames still fire while timers are blocked', async function (assert) {
    assert.expect(1);
    let originalSetTimeout = window.setTimeout.bind(window);
    let originalRequestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    let restoreStub = enableRenderTimerStub();
    try {
      let frameFired = false;
      originalRequestAnimationFrame(() => {
        frameFired = true;
      });

      let releaseBlock = beginTimerBlock();

      await new Promise<void>((resolve) => {
        originalSetTimeout(resolve, 30);
      });

      releaseBlock();

      await new Promise<void>((resolve) => {
        originalSetTimeout(resolve, 10);
      });

      assert.true(
        frameFired,
        'requestAnimationFrame scheduled before block still runs',
      );
    } finally {
      restoreStub();
    }
  });

  test('animation frames scheduled while blocked do not run until block is released', async function (assert) {
    assert.expect(2);
    let originalSetTimeout = window.setTimeout.bind(window);
    let originalRequestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    let restoreStub = enableRenderTimerStub();
    try {
      let blockedFrameFired = false;
      let postBlockFrameFired = false;

      let releaseBlock = beginTimerBlock();
      window.requestAnimationFrame(() => {
        blockedFrameFired = true;
      });

      await new Promise<void>((resolve) => {
        originalSetTimeout(resolve, 10);
      });

      assert.false(
        blockedFrameFired,
        'requestAnimationFrame scheduled during block never runs',
      );

      releaseBlock();

      await new Promise<void>((resolve) => {
        originalRequestAnimationFrame(() => {
          postBlockFrameFired = true;
          resolve();
        });
      });

      assert.true(
        postBlockFrameFired,
        'requestAnimationFrame scheduled after block runs normally',
      );
    } finally {
      restoreStub();
    }
  });

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
});
