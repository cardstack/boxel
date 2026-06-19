import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { decideHostShellRecycle } from '../prerender/prerender-app.ts';

// Unit tests for the host-shell recycle decision a prerender server makes on
// every heartbeat: the manager echoes the current host-shell token, and the
// server recycles its browser when that token differs from the one it warmed
// against (the host was redeployed). See PRERENDER_HOST_SHELL_HASH_HEADER.
module(basename(__filename), function () {
  module('decideHostShellRecycle', function () {
    test('no token reported yet → no recycle, baseline unchanged', function (assert) {
      assert.deepEqual(decideHostShellRecycle(null, undefined), {
        recycle: false,
        nextWarmed: undefined,
      });
      assert.deepEqual(decideHostShellRecycle(null, 'aaa'), {
        recycle: false,
        nextWarmed: 'aaa',
      });
    });

    test('first token seen → adopt as baseline, no recycle', function (assert) {
      assert.deepEqual(decideHostShellRecycle('aaa', undefined), {
        recycle: false,
        nextWarmed: 'aaa',
      });
    });

    test('token matches baseline → no-op', function (assert) {
      assert.deepEqual(decideHostShellRecycle('aaa', 'aaa'), {
        recycle: false,
        nextWarmed: 'aaa',
      });
    });

    test('token differs from baseline → recycle and advance baseline', function (assert) {
      assert.deepEqual(decideHostShellRecycle('bbb', 'aaa'), {
        recycle: true,
        nextWarmed: 'bbb',
      });
    });
  });
});
