import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { SignInLimiter } from '../lib/sign-in-limiter.ts';
import {
  relativeTime,
  tooManyFailedAttempts,
} from '../secure-origin/sign-in-copy.js';

module(basename(import.meta.filename), function () {
  module('sign-in limiter', function () {
    function limiter() {
      let clock = { now: 1_000_000 };
      return {
        clock,
        limiter: new SignInLimiter(
          { burstCount: 3, perSecond: 0.17 },
          { now: () => clock.now },
        ),
      };
    }

    test('an account is refused only once its failures fill a burst', function (assert) {
      let { limiter: l } = limiter();
      for (let failure = 0; failure < 3; failure++) {
        assert.true(l.check('user:@a:x').allowed, `attempt ${failure + 1}`);
        l.recordFailure('user:@a:x');
      }
      let refused = l.check('user:@a:x');
      assert.false(refused.allowed, 'the fourth attempt waits');
      assert.strictEqual(
        refused.allowed ? undefined : refused.retryAfterMs,
        Math.ceil(1000 / 0.17),
        'until one failure has drained',
      );
      assert.true(
        l.check('user:@b:x').allowed,
        'other accounts are unaffected',
      );
    });

    test('checking counts nothing, so successful sign-ins never fill the limit', function (assert) {
      let { limiter: l } = limiter();
      for (let attempt = 0; attempt < 100; attempt++) {
        assert.true(l.check('user:@a:x').allowed);
      }
    });

    test('failures drain at the configured rate', function (assert) {
      let { limiter: l, clock } = limiter();
      for (let failure = 0; failure < 3; failure++) {
        l.recordFailure('user:@a:x');
      }
      let refused = l.check('user:@a:x');
      let retryAfterMs = refused.allowed ? 0 : refused.retryAfterMs;
      clock.now += retryAfterMs - 1;
      assert.false(l.check('user:@a:x').allowed, 'just before the retry time');
      clock.now += 1;
      assert.true(l.check('user:@a:x').allowed, 'at the retry time');
      l.recordFailure('user:@a:x');
      assert.false(
        l.check('user:@a:x').allowed,
        'one more failure fills it again',
      );
      clock.now += Math.ceil((3 * 1000) / 0.17);
      for (let failure = 0; failure < 3; failure++) {
        assert.true(
          l.check('user:@a:x').allowed,
          `a full burst once drained (${failure + 1})`,
        );
        l.recordFailure('user:@a:x');
      }
    });
  });

  module('sign-in copy', function () {
    test('a retry time reads as the app reads it', function (assert) {
      // What moment's `humanize(true)` says for each duration, with its
      // rounding set to round up, as the app's sign-in page sets it.
      let expected: [number, string][] = [
        [1, 'in a few seconds'],
        [5_883, 'in a few seconds'],
        [44_000, 'in a few seconds'],
        [44_001, 'in a minute'],
        [60_000, 'in a minute'],
        [60_001, 'in 2 minutes'],
        [150_000, 'in 3 minutes'],
        [2_640_000, 'in 44 minutes'],
        [2_640_001, 'in an hour'],
        [3_600_000, 'in an hour'],
        [3_600_001, 'in 2 hours'],
        [75_600_000, 'in 21 hours'],
        [75_600_001, 'in a day'],
        [129_600_000, 'in 2 days'],
        [2_160_000_000, 'in 25 days'],
        [2_160_000_001, 'in a month'],
        [3_456_000_000, 'in 2 months'],
        [27_648_000_000, 'in a year'],
        [34_560_000_000, 'in 2 years'],
      ];
      assert.deepEqual(
        expected.map(([ms]) => [ms, relativeTime(ms)]),
        expected,
      );
    });

    test('a refusal for too many failed attempts reads as the app reads it', function (assert) {
      assert.strictEqual(
        tooManyFailedAttempts(150_000),
        'Sign-in failed. Too many failed attempts, try again in 3 minutes.',
      );
      for (let unknown of [undefined, 0]) {
        assert.strictEqual(
          tooManyFailedAttempts(unknown),
          'Sign-in failed. Too many failed attempts, try again later.',
          `without a retry time (${unknown})`,
        );
      }
    });
  });
});
