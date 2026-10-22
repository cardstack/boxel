// Pretui — proof for password strength estimation.
//
//
// Three things need proving and none of them is styling:
//   1. the pure layer (score→label, clamping, announcement, the debounce)
//      is correct WITHOUT a dictionary or a real clock;
//   2. `PasswordInput` renders, types and reveals with the estimator never
//      loaded — the laziness is the feature, so it gets an assertion;
//   3. once asked for, the estimate arrives, the label and zxcvbn's own
//      feedback text are in the DOM, the live region is polite — and the
//      password itself appears nowhere in the markup.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import { render, click, fillIn, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PasswordInput } from './components/password-input';
import { PasswordStrength, OneShotDebounce, SCORE_LABELS, barLevel, clampScore, loadPasswordEstimator, passwordEstimatorRequested, strengthAnnouncement, strengthLabel } from './components/password-strength';
import type { TimerHost } from './components/password-strength';

const SAMPLE_SUGGESTIONS = ['Add more words that are less common.'];
const SAMPLE_USER_INPUTS = ['Chris', 'chris@example.com'];
const SECRET = 'chris1985';

function q(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

class UserInputsState {
  @tracked userInputs: string[] = [];
}

/** A clock that never ticks unless a test tells it to, so no real timer is
 * created and nothing can outlive the test. */
class FakeTimers implements TimerHost {
  scheduled: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  scheduleCount = 0;
  schedule(fn: () => void, ms: number) {
    this.scheduleCount++;
    let entry = { fn, ms, cancelled: false };
    this.scheduled.push(entry);
    return entry;
  }
  cancel(handle: unknown) {
    (handle as { cancelled: boolean }).cancelled = true;
  }
  /** Fire everything still live, oldest first. */
  tick() {
    for (let entry of this.scheduled.slice()) {
      if (!entry.cancelled) {
        entry.cancelled = true;
        entry.fn();
      }
    }
  }
  get liveCount() {
    return this.scheduled.filter((e) => !e.cancelled).length;
  }
}

module('Pretui | password strength · pure layer', function () {
  test('clampScore keeps every score inside 0…4', function (assert) {
    assert.strictEqual(clampScore(0), 0);
    assert.strictEqual(clampScore(4), 4);
    assert.strictEqual(clampScore(-3), 0, 'negatives floor at 0');
    assert.strictEqual(clampScore(9), 4, 'overshoot caps at 4');
    assert.strictEqual(clampScore(2.6), 3, 'fractions round');
    assert.strictEqual(clampScore(undefined), 0, 'undefined is 0');
    assert.strictEqual(clampScore('nonsense'), 0, 'garbage is 0');
    assert.strictEqual(clampScore(NaN), 0, 'NaN is 0');
    assert.strictEqual(clampScore(Infinity), 0, 'Infinity is 0');
  });

  test('strengthLabel maps every score to words, never to nothing', function (assert) {
    assert.strictEqual(strengthLabel(0), 'Very weak');
    assert.strictEqual(strengthLabel(1), 'Weak');
    assert.strictEqual(strengthLabel(2), 'Fair');
    assert.strictEqual(strengthLabel(3), 'Strong');
    assert.strictEqual(strengthLabel(4), 'Very strong');
    assert.strictEqual(strengthLabel(99), 'Very strong', 'clamped first');
    assert.strictEqual(
      strengthLabel(2, ['a', 'b', 'c', 'd', 'e']),
      'c',
      'labels are replaceable',
    );
    for (let i = 0; i <= 4; i++) {
      assert.ok(strengthLabel(i).length > 0, 'score ' + i + ' has a label');
    }
    assert.strictEqual(SCORE_LABELS.length, 5, 'five bands, five labels');
  });

  test('barLevel never draws an empty track for a scored password', function (assert) {
    assert.strictEqual(barLevel(0), 1, 'score 0 still lights one segment');
    assert.strictEqual(barLevel(1), 1);
    assert.strictEqual(barLevel(3), 3);
    assert.strictEqual(barLevel(4), 4);
  });

  test('strengthAnnouncement composes one sentence and stays silent when unscored', function (assert) {
    assert.strictEqual(strengthAnnouncement(undefined), '', 'nothing to say');
    let said = strengthAnnouncement({
      score: 1,
      warning: 'This is a commonly used password.',
      suggestions: ['Add more words that are less common.'],
    });
    assert.ok(said.includes('Password strength: Weak.'), 'leads with the label');
    assert.ok(said.includes('commonly used'), 'carries the warning');
    assert.ok(said.includes('Add more words'), 'carries the suggestions');
    assert.strictEqual(
      strengthAnnouncement({ score: 4 }),
      'Password strength: Very strong.',
      'no feedback means just the label',
    );
  });
});

module('Pretui | password strength · debounce', function () {
  test('arming schedules exactly one call', function (assert) {
    let timers = new FakeTimers();
    let debounce = new OneShotDebounce(timers);
    let calls = 0;
    debounce.arm(() => calls++, 400);
    assert.strictEqual(timers.liveCount, 1, 'one pending');
    assert.true(debounce.pending, 'reports pending');
    assert.strictEqual(calls, 0, 'not called yet');
    timers.tick();
    assert.strictEqual(calls, 1, 'called once');
    assert.false(debounce.pending, 'no longer pending');
  });

  test('re-arming cancels the previous call — only the last one runs', function (assert) {
    let timers = new FakeTimers();
    let debounce = new OneShotDebounce(timers);
    let seen: string[] = [];
    debounce.arm(() => seen.push('a'), 400);
    debounce.arm(() => seen.push('b'), 400);
    debounce.arm(() => seen.push('c'), 400);
    assert.strictEqual(timers.liveCount, 1, 'only one survives');
    timers.tick();
    assert.deepEqual(seen, ['c'], 'only the last keystroke estimates');
  });

  test('the fired callback schedules nothing — it cannot re-arm itself', function (assert) {
    let timers = new FakeTimers();
    let debounce = new OneShotDebounce(timers);
    debounce.arm(() => {}, 400);
    let before = timers.scheduleCount;
    timers.tick();
    assert.strictEqual(
      timers.scheduleCount,
      before,
      'no timer was scheduled by the callback',
    );
    assert.strictEqual(timers.liveCount, 0, 'nothing left pending');
    timers.tick();
    assert.strictEqual(timers.liveCount, 0, 'still nothing — it is one-shot');
  });

  test('cancel is idempotent and stops the pending call', function (assert) {
    let timers = new FakeTimers();
    let debounce = new OneShotDebounce(timers);
    let calls = 0;
    debounce.arm(() => calls++, 400);
    debounce.cancel();
    debounce.cancel();
    debounce.cancel();
    timers.tick();
    assert.strictEqual(calls, 0, 'the cancelled call never ran');
    assert.false(debounce.pending);
  });

  test('a negative delay is floored, never passed through', function (assert) {
    let timers = new FakeTimers();
    let debounce = new OneShotDebounce(timers);
    debounce.arm(() => {}, -50);
    assert.strictEqual(timers.scheduled[0]?.ms, 0, 'clamped to 0');
  });
});

module('Pretui | password strength · indicator', function (hooks) {
  setupCardTest(hooks);

  test('renders nothing until there is something to say', async function (assert) {
    await render(<template><PasswordStrength /></template>);
    assert.strictEqual(
      q('[data-test-pretui-password-strength]'),
      null,
      'no empty accusation before anything is typed',
    );
  });

  test('a score renders a label, the feedback text, and a polite live region', async function (assert) {
    await render(
      <template>
        <PasswordStrength
          @score={{1}}
          @warning='This is a commonly used password.'
          @suggestions={{SAMPLE_SUGGESTIONS}}
          @crackTime='3 seconds'
        />
      </template>,
    );
    let root = q('[data-test-pretui-password-strength]');
    assert.ok(root, 'the indicator rendered');
    assert.strictEqual(root?.getAttribute('data-score'), '1', 'score reflected');
    assert.ok(
      root?.textContent?.includes('Weak'),
      'the score carries a TEXT label, not colour alone',
    );
    assert.ok(
      root?.textContent?.includes('commonly used password'),
      "zxcvbn's own warning is on screen",
    );
    assert.ok(
      root?.textContent?.includes('Add more words'),
      "zxcvbn's own suggestion is on screen",
    );
    assert.ok(root?.textContent?.includes('3 seconds'), 'crack time shown');

    let live = q('.pretui-pwstrength-sr');
    assert.strictEqual(live?.getAttribute('aria-live'), 'polite', 'polite');
    assert.strictEqual(live?.getAttribute('role'), 'status', 'status region');
    assert.ok(
      live?.textContent?.includes('Password strength: Weak.'),
      'one composed sentence, label first',
    );
    assert.ok(
      live?.textContent?.includes('commonly used password'),
      'the announcement carries the actionable text too',
    );
    assert.strictEqual(
      q('.pretui-pwstrength-row')?.getAttribute('aria-hidden'),
      'true',
      'the visible layer is hidden from AT so nothing double-announces',
    );
  });

  test('a score of 4 lights every segment and says so', async function (assert) {
    await render(<template><PasswordStrength @score={{4}} /></template>);
    let root = q('[data-test-pretui-password-strength]');
    assert.ok(root?.textContent?.includes('Very strong'), 'top label');
    assert.strictEqual(
      document.querySelectorAll('.pretui-meter-bar[data-on]').length,
      4,
      'four of four segments lit',
    );
  });

  test('busy keeps the live region silent — nothing is announced mid-flight', async function (assert) {
    await render(
      <template><PasswordStrength @busy={{true}} @score={{2}} /></template>,
    );
    assert.strictEqual(
      q('.pretui-pwstrength-sr')?.textContent?.trim(),
      '',
      'silent while estimating',
    );
  });
});

module('Pretui | password strength · PasswordInput', function (hooks) {
  setupCardTest(hooks);

  test('without @strength the field works and the estimator is never touched', async function (assert) {
    // Order-independent: whatever the module-level state was on entry, this
    // render must not change it.
    let requestedBefore = passwordEstimatorRequested();
    await render(<template><PasswordInput @value='hunter2' /></template>);
    let input = q('[data-test-pretui-password-input] input') as HTMLInputElement;
    assert.strictEqual(input.getAttribute('type'), 'password', 'still masked');
    assert.strictEqual(
      input.getAttribute('autocomplete'),
      'current-password',
      'autocomplete semantics intact',
    );
    assert.strictEqual(
      q('[data-test-pretui-password-strength]'),
      null,
      'no meter — strength is opt-in (Law 9)',
    );
    await click('.pretui-reveal');
    assert.strictEqual(
      (
        q('[data-test-pretui-password-input] input') as HTMLInputElement
      ).getAttribute('type'),
      'text',
      'the existing reveal toggle is untouched',
    );
    assert.strictEqual(
      passwordEstimatorRequested(),
      requestedBefore,
      'rendering, typing and revealing requested no 839 KB bundle',
    );
  });

  test('@strength estimates after typing settles, and knows the user', async function (assert) {
    await render(
      <template>
        <PasswordInput
          @strength={{true}}
          @strengthDelay={{0}}
          @userInputs={{SAMPLE_USER_INPUTS}}
          @autocomplete='new-password'
        />
      </template>,
    );
    await fillIn('[data-test-pretui-password-input] input', SECRET);
    await waitUntil(
      () =>
        q('[data-test-pretui-password-strength]')?.getAttribute(
          'data-scored',
        ) === 'true',
      { timeout: 20000 },
    );

    let root = q('[data-test-pretui-password-strength]') as HTMLElement;
    let score = Number(root.getAttribute('data-score'));
    assert.ok(score <= 1, 'a name plus a birth year is weak, score ' + score);
    assert.ok(
      root.textContent?.includes('Weak'),
      'the score reads as words: ' + root.textContent?.trim(),
    );
    assert.ok(
      (q('.pretui-pwstrength-sr')?.textContent ?? '').includes(
        'Password strength:',
      ),
      'the live region announces the settled result',
    );
    assert.true(
      passwordEstimatorRequested(),
      'the estimator loaded once it was asked for',
    );

    // The password must not be anywhere in the markup: not as text, not in a
    // title, not in an aria-* value, not in a data-* test hook.
    let markup = (q('[data-test-pretui-password-input]') as HTMLElement)
      .outerHTML;
    assert.notOk(
      markup.includes(SECRET),
      'the password appears nowhere in the DOM as text or attribute',
    );
    assert.strictEqual(
      (q('[data-test-pretui-password-input] input') as HTMLInputElement).value,
      SECRET,
      '…while the native input still holds it as a value',
    );
    assert.strictEqual(
      (
        q('[data-test-pretui-password-input] input') as HTMLInputElement
      ).getAttribute('autocomplete'),
      'new-password',
      'autocomplete passthrough intact',
    );
  });

  test('learning who the user is re-scores the password already typed', async function (assert) {
    let state = new UserInputsState();
    await render(
      <template>
        <PasswordInput
          @strength={{true}}
          @strengthDelay={{0}}
          @userInputs={{state.userInputs}}
        />
      </template>,
    );
    await fillIn('[data-test-pretui-password-input] input', 'Chrissss');
    await waitUntil(
      () =>
        q('[data-test-pretui-password-strength]')?.getAttribute(
          'data-scored',
        ) === 'true',
      { timeout: 20000 },
    );
    let announcedBlind = q('.pretui-pwstrength-sr')?.textContent ?? '';

    // The signup form learns the user's name after the password was typed.
    state.userInputs = ['Chrissss', 'chris@example.com'];
    await waitUntil(
      () => (q('.pretui-pwstrength-sr')?.textContent ?? '') !== announcedBlind,
      { timeout: 20000 },
    );
    assert.ok(
      (q('.pretui-pwstrength-sr')?.textContent ?? '').length > 0,
      're-estimated once @userInputs changed: ' +
        q('.pretui-pwstrength-sr')?.textContent?.trim(),
    );
  });

  test('a long passphrase scores high — length wins, composition rules do not apply', async function (assert) {
    let estimate = await loadPasswordEstimator();
    let phrase = estimate('correct horse battery staple', []);
    assert.strictEqual(phrase.score, 4, 'no symbols, no digits, still 4');
    let short = estimate('P@ssw0rd!', []);
    assert.ok(
      short.score < phrase.score,
      'the symbol-and-digit password scores lower than the passphrase',
    );
  });

  test('@userInputs changes the verdict — the highest-value arg actually works', async function (assert) {
    let estimate = await loadPasswordEstimator();
    let blind = estimate('Chrissss', []);
    let informed = estimate('Chrissss', ['Chrissss', 'chris@example.com']);
    assert.ok(
      (informed.guessesLog10 ?? 0) < (blind.guessesLog10 ?? 0),
      'knowing the user makes their own name a worse password',
    );
    assert.ok(
      (informed.warning ?? '').length > 0,
      'and it says why: ' + informed.warning,
    );
  });
});
