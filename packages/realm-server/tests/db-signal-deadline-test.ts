import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  setSignalDeadline,
  signalDeadline,
} from '@cardstack/runtime-common/db';

module(basename(import.meta.filename), function () {
  test('a signal no budget armed has no deadline', function (assert) {
    assert.strictEqual(signalDeadline(new AbortController().signal), undefined);
    assert.strictEqual(signalDeadline(undefined), undefined);
    assert.strictEqual(signalDeadline(null), undefined);
  });

  test('a signal keeps the earliest deadline it is armed with', function (assert) {
    let { signal } = new AbortController();
    setSignalDeadline(signal, 2_000);
    assert.strictEqual(signalDeadline(signal), 2_000);
    setSignalDeadline(signal, 5_000);
    assert.strictEqual(signalDeadline(signal), 2_000, 'a later one is ignored');
    setSignalDeadline(signal, 1_000);
    assert.strictEqual(signalDeadline(signal), 1_000, 'an earlier one wins');
  });
});
