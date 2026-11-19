import { module, test } from 'qunit';

import {
  MAX_UNAVAILABLE_READ_RETRIES,
  UNAVAILABLE_READ_RETRY_WINDOW_MS,
  unavailableReadRetryDelayMs,
} from '@cardstack/host/lib/retry-after';

module('Unit | lib | retry-after', function () {
  test('a read turned away for now is tried again after the interval the realm names', function (assert) {
    let delayMs = unavailableReadRetryDelayMs('2', 0, 0) ?? -1;
    assert.true(
      delayMs >= 2000,
      `waits the two seconds asked for (${delayMs})`,
    );
    assert.true(delayMs < 2250, `plus at most the jitter (${delayMs})`);
  });

  test('the wait between tries is capped at five seconds', function (assert) {
    let delayMs = unavailableReadRetryDelayMs('60', 0, 0) ?? -1;
    assert.true(delayMs >= 5000, `waits five seconds (${delayMs})`);
    assert.true(delayMs < 5250, `plus at most the jitter (${delayMs})`);
  });

  test('a read is tried again at most three times', function (assert) {
    assert.notStrictEqual(
      unavailableReadRetryDelayMs('0', MAX_UNAVAILABLE_READ_RETRIES - 1, 0),
      undefined,
      'the third retry is sent',
    );
    assert.strictEqual(
      unavailableReadRetryDelayMs('0', MAX_UNAVAILABLE_READ_RETRIES, 0),
      undefined,
      'a fourth is not',
    );
  });

  test('no retry starts more than thirty seconds after the first send', function (assert) {
    assert.notStrictEqual(
      unavailableReadRetryDelayMs(
        '5',
        1,
        UNAVAILABLE_READ_RETRY_WINDOW_MS - 6000,
      ),
      undefined,
      'a retry that starts inside the window is sent',
    );
    assert.strictEqual(
      unavailableReadRetryDelayMs(
        '5',
        1,
        UNAVAILABLE_READ_RETRY_WINDOW_MS - 4000,
      ),
      undefined,
      'one whose wait would end past it is not',
    );
  });

  test('a 503 that does not say when to come back is not tried again', function (assert) {
    assert.strictEqual(unavailableReadRetryDelayMs(null, 0, 0), undefined);
  });
});
