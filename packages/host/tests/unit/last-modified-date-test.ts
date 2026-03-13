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
});
