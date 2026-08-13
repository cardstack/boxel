import { module, test } from 'qunit';

import {
  formatRelativeTime,
  formatUpdatedTime,
} from '@cardstack/host/components/operator-mode/workspace-chooser/workspace';

// Both formatters are relative to "now", so every case is expressed as an
// offset from a fixed instant that stands in for the current time.
const NOW = new Date('2026-08-03T12:00:00.000Z');

function ago(amount: number, unit: 'sec' | 'min' | 'hr' | 'day'): Date {
  const perUnit = { sec: 1e3, min: 60e3, hr: 3600e3, day: 86400e3 };
  return new Date(NOW.getTime() - amount * perUnit[unit]);
}

module('Unit | workspace timestamp labels', function () {
  module('formatRelativeTime', function () {
    test('renders a clock time under a minute old', function (assert) {
      // Local-time formatting, so assert the shape rather than a fixed hour.
      assert.ok(
        /^\d{1,2}:\d{2} (AM|PM)$/.test(
          formatRelativeTime(ago(30, 'sec'), NOW.getTime()),
        ),
        `expected a "h:mm AM/PM" clock time, got ${formatRelativeTime(ago(30, 'sec'), NOW.getTime())}`,
      );
    });

    test('counts minutes, then hours', function (assert) {
      assert.strictEqual(
        formatRelativeTime(ago(1, 'min'), NOW.getTime()),
        '1 min ago',
      );
      assert.strictEqual(
        formatRelativeTime(ago(59, 'min'), NOW.getTime()),
        '59 min ago',
      );
      assert.strictEqual(
        formatRelativeTime(ago(60, 'min'), NOW.getTime()),
        '1 hr ago',
      );
      assert.strictEqual(
        formatRelativeTime(ago(2, 'hr'), NOW.getTime()),
        '2 hrs ago',
      );
      assert.strictEqual(
        formatRelativeTime(ago(23, 'hr'), NOW.getTime()),
        '23 hrs ago',
      );
    });

    test('falls back to an absolute date at a day and older', function (assert) {
      assert.strictEqual(
        formatRelativeTime(new Date('2026-08-02T12:00:00.000Z'), NOW.getTime()),
        'Sun, Aug 2, 2026',
      );
      assert.strictEqual(
        formatRelativeTime(new Date('2024-01-15T12:00:00.000Z'), NOW.getTime()),
        'Mon, Jan 15, 2024',
      );
    });
  });

  module('formatUpdatedTime', function () {
    test('counts up through every unit', function (assert) {
      assert.strictEqual(
        formatUpdatedTime(NOW, NOW.getTime()),
        'Updated just now',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(1, 'sec'), NOW.getTime()),
        'Updated 1 sec ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(59, 'sec'), NOW.getTime()),
        'Updated 59 sec ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(1, 'min'), NOW.getTime()),
        'Updated 1 min ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(1, 'hr'), NOW.getTime()),
        'Updated 1 hr ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(5, 'hr'), NOW.getTime()),
        'Updated 5 hrs ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(1, 'day'), NOW.getTime()),
        'Updated 1 day ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(29, 'day'), NOW.getTime()),
        'Updated 29 days ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(30, 'day'), NOW.getTime()),
        'Updated 1 month ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(90, 'day'), NOW.getTime()),
        'Updated 3 months ago',
      );
    });

    test('clamps a future timestamp to "just now"', function (assert) {
      // A client clock slightly ahead of the server, or a write racing this
      // render, would otherwise produce a negative age.
      assert.strictEqual(
        formatUpdatedTime(new Date(NOW.getTime() + 5000), NOW.getTime()),
        'Updated just now',
      );
    });
  });
});
