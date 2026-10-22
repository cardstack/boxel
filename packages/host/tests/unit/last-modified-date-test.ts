import { module, test } from 'qunit';

import {
  formatLastSavedText,
  LAST_SAVED_JUST_NOW_THRESHOLD_MS,
} from '@cardstack/host/resources/last-modified-date';

module('Unit | last-modified-date', function () {
  test('treats files from the last minute as just now', function (assert) {
    let now = Date.UTC(2026, 2, 13, 12, 0, 0);
    let lastModified = new Date(now - (LAST_SAVED_JUST_NOW_THRESHOLD_MS - 1));

    assert.strictEqual(
      formatLastSavedText(lastModified, now),
      'Last saved just now',
    );
  });

  test('switches to relative time after one minute', function (assert) {
    let now = Date.UTC(2026, 2, 13, 12, 0, 0);
    let lastModified = new Date(now - LAST_SAVED_JUST_NOW_THRESHOLD_MS);

    assert.strictEqual(
      formatLastSavedText(lastModified, now),
      'Last saved 1 minute ago',
    );
  });

  // The cases above pass `now`, so they hold whatever the default is. This one
  // omits it, which is the only way to observe that the default reads the
  // shared clock rather than the wall clock.
  test('measures from the shared clock when no instant is given', function (assert) {
    let pinned = Date.UTC(2026, 2, 13, 12, 0, 0);
    let prior = (globalThis as { __boxelNow?: number }).__boxelNow;
    (globalThis as { __boxelNow?: number }).__boxelNow = pinned;
    try {
      assert.strictEqual(
        formatLastSavedText(new Date(pinned - 5 * 60 * 1000)),
        'Last saved 5 minutes ago',
      );
    } finally {
      (globalThis as { __boxelNow?: number }).__boxelNow = prior;
    }
  });
});
