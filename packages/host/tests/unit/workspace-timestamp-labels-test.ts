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

module('Unit | workspace timestamp labels', function (hooks) {
  let realNow: () => number;

  hooks.beforeEach(function () {
    realNow = Date.now;
    Date.now = () => NOW.getTime();
  });

  hooks.afterEach(function () {
    Date.now = realNow;
  });

  module('formatRelativeTime', function () {
    test('renders a clock time under a minute old', function (assert) {
      // Local-time formatting, so assert the shape rather than a fixed hour.
      assert.ok(
        /^\d{1,2}:\d{2} (AM|PM)$/.test(formatRelativeTime(ago(30, 'sec'))),
        `expected a "h:mm AM/PM" clock time, got ${formatRelativeTime(ago(30, 'sec'))}`,
      );
    });

    test('counts minutes, then hours', function (assert) {
      assert.strictEqual(formatRelativeTime(ago(1, 'min')), '1 min ago');
      assert.strictEqual(formatRelativeTime(ago(59, 'min')), '59 min ago');
      assert.strictEqual(formatRelativeTime(ago(60, 'min')), '1 hr ago');
      assert.strictEqual(formatRelativeTime(ago(2, 'hr')), '2 hrs ago');
      assert.strictEqual(formatRelativeTime(ago(23, 'hr')), '23 hrs ago');
    });

    test('falls back to an absolute date at a day and older', function (assert) {
      assert.strictEqual(
        formatRelativeTime(new Date('2026-08-02T12:00:00.000Z')),
        'Sun, Aug 2, 2026',
      );
      assert.strictEqual(
        formatRelativeTime(new Date('2024-01-15T12:00:00.000Z')),
        'Mon, Jan 15, 2024',
      );
    });
  });

  module('formatUpdatedTime', function () {
    test('counts up through every unit', function (assert) {
      assert.strictEqual(formatUpdatedTime(NOW), 'Updated just now');
      assert.strictEqual(formatUpdatedTime(ago(1, 'sec')), 'Updated 1 sec ago');
      assert.strictEqual(
        formatUpdatedTime(ago(59, 'sec')),
        'Updated 59 sec ago',
      );
      assert.strictEqual(formatUpdatedTime(ago(1, 'min')), 'Updated 1 min ago');
      assert.strictEqual(formatUpdatedTime(ago(1, 'hr')), 'Updated 1 hr ago');
      assert.strictEqual(formatUpdatedTime(ago(5, 'hr')), 'Updated 5 hrs ago');
      assert.strictEqual(formatUpdatedTime(ago(1, 'day')), 'Updated 1 day ago');
      assert.strictEqual(
        formatUpdatedTime(ago(29, 'day')),
        'Updated 29 days ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(30, 'day')),
        'Updated 1 month ago',
      );
      assert.strictEqual(
        formatUpdatedTime(ago(90, 'day')),
        'Updated 3 months ago',
      );
    });

    test('clamps a future timestamp to "just now"', function (assert) {
      // A client clock slightly ahead of the server, or a write racing this
      // render, would otherwise produce a negative age.
      assert.strictEqual(
        formatUpdatedTime(new Date(NOW.getTime() + 5000)),
        'Updated just now',
      );
    });
  });
});
