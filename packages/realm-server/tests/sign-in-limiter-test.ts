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
          { burstCount: 3, perSecond: 0.17, inFlight: 10 },
          { now: () => clock.now },
        ),
      };
    }

    // A sign-in that runs to completion, failing or not.
    function attempt(l: SignInLimiter, account: string, failed: boolean) {
      let check = l.start(account);
      if (check.allowed) {
        l.finish(account, { failed });
      }
      return check;
    }

    function retryAfterMs(check: ReturnType<SignInLimiter['start']>) {
      return check.allowed ? undefined : check.retryAfterMs;
    }

    test('an account is refused only once its failures fill a burst', function (assert) {
      let { limiter: l } = limiter();
      for (let failure = 0; failure < 3; failure++) {
        assert.true(attempt(l, '@a:x', true).allowed, `attempt ${failure + 1}`);
      }
      let refused = attempt(l, '@a:x', false);
      assert.false(refused.allowed, 'the fourth attempt waits');
      assert.strictEqual(
        retryAfterMs(refused),
        Math.ceil(1000 / 0.17),
        'until one failure has drained',
      );
      assert.true(
        attempt(l, '@b:x', false).allowed,
        'other accounts are unaffected',
      );
    });

    test('successful sign-ins never fill the limit', function (assert) {
      let { limiter: l } = limiter();
      for (let signIn = 0; signIn < 100; signIn++) {
        assert.true(attempt(l, '@a:x', false).allowed);
      }
    });

    test('failures that land together never fill more than a burst', function (assert) {
      let { limiter: l } = limiter();
      for (let started = 0; started < 10; started++) {
        assert.true(l.start('@a:x').allowed, `start ${started + 1}`);
      }
      for (let finished = 0; finished < 10; finished++) {
        l.finish('@a:x', { failed: true });
      }
      assert.strictEqual(
        retryAfterMs(l.start('@a:x')),
        Math.ceil(1000 / 0.17),
        'the wait is what a single burst asks for',
      );
    });

    test('an account may have only so many sign-ins in flight', function (assert) {
      let { limiter: l } = limiter();
      for (let started = 0; started < 10; started++) {
        assert.true(l.start('@a:x').allowed, `start ${started + 1}`);
      }
      let refused = l.start('@a:x');
      assert.false(refused.allowed, 'one more waits');
      assert.strictEqual(retryAfterMs(refused), undefined, 'for no known time');
      assert.true(l.start('@b:x').allowed, 'other accounts are unaffected');
      l.finish('@a:x', { failed: false });
      assert.true(
        l.start('@a:x').allowed,
        'one may start once another finishes',
      );
    });

    test('failures drain at the configured rate', function (assert) {
      let { limiter: l, clock } = limiter();
      for (let failure = 0; failure < 3; failure++) {
        attempt(l, '@a:x', true);
      }
      let wait = retryAfterMs(l.start('@a:x')) ?? 0;
      clock.now += wait - 1;
      assert.false(l.start('@a:x').allowed, 'just before the retry time');
      clock.now += 1;
      assert.true(
        attempt(l, '@a:x', true).allowed,
        'at the retry time, and that attempt fails too',
      );
      assert.false(l.start('@a:x').allowed, 'one more failure fills it again');
      clock.now += Math.ceil((3 * 1000) / 0.17);
      for (let failure = 0; failure < 3; failure++) {
        assert.true(
          attempt(l, '@a:x', true).allowed,
          `a full burst once drained (${failure + 1})`,
        );
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
