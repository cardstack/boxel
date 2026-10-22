// Pretui — proof for PeriodInput.
//
// Three things are pinned here, and all three are things the source got wrong:
//
//  1. **A partial period without a reference is REFUSED.** The source appended
//     the current year, so `Q3` meant something different depending on when
//     the indexer ran. Every test that resolves a partial period supplies the
//     reference explicitly; the one that does not asserts the refusal.
//  2. **ISO weeks are ISO weeks.** Week 1 of 2026 begins on 29 December 2025
//     and 2026 has fifty-three of them. Both facts are asserted, because both
//     are what a hand-rolled week parser gets wrong.
//  3. **Seasons and fiscal quarters follow their knobs**, rather than a baked
//     convention. Northern and southern, calendar and fiscal, named for the
//     starting year and for the ending year.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, fillIn, blur, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PERIOD_FORMS, PeriodInput, daysBetween, isoWeekOneStart, isoWeeksInYear, makePeriod, parsePeriod, periodRangeText, shiftPeriod } from './components/period-input';
import type { Period, PeriodResult } from './components/period-input';
import { DEMOS_PERIOD_INPUT } from './components/period-input.usage';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_PERIOD_INPUT };
const DEMOS_CONTROLS_PERIOD_NAMES = ['PeriodInput'];

/** A Thursday in the third quarter. The only instant this file measures
 * anything against. */
const REFERENCE = '2026-08-13';

function got(text: string, options = {}): Period {
  let result = parsePeriod(text, options);
  if (!result.period) {
    throw new Error(
      'expected ' + text + ' to resolve, got: ' + (result.issue ?? '(nothing)'),
    );
  }
  return result.period;
}

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function box(): HTMLInputElement {
  return root().querySelector(
    '[data-test-pretui-period-input]',
  ) as HTMLInputElement;
}
function readout(): string {
  let el = root().querySelector('[data-test-pretui-period-readout]');
  return (el?.textContent ?? '').trim();
}

module('Pretui | controls-period | the shapes people type', function () {
  test('a bare year', function (assert) {
    let year = got('2026');
    assert.strictEqual(year.kind, 'year');
    assert.strictEqual(year.start, '2026-01-01');
    assert.strictEqual(year.end, '2026-12-31');
    assert.strictEqual(year.days, 365);
    assert.strictEqual(year.id, '2026');
  });

  test('a quarter, however it is written', function (assert) {
    let expected = { start: '2026-07-01', end: '2026-09-30', days: 92 };
    for (let text of ['Q3 2026', '2026 Q3', '2026-Q3', 'q3 2026', 'Q3  2026']) {
      let period = got(text);
      assert.strictEqual(period.kind, 'quarter', text);
      assert.strictEqual(period.start, expected.start, text);
      assert.strictEqual(period.end, expected.end, text);
      assert.strictEqual(period.days, expected.days, text);
      assert.strictEqual(period.id, '2026-Q3', text);
      assert.strictEqual(period.label, 'Q3 2026', text);
    }
  });

  test('a half, a month, a day', function (assert) {
    let half = got('H1 2026');
    assert.strictEqual(half.start, '2026-01-01');
    assert.strictEqual(half.end, '2026-06-30');

    let month = got('Jan 2026');
    assert.strictEqual(month.kind, 'month');
    assert.strictEqual(month.start, '2026-01-01');
    assert.strictEqual(month.end, '2026-01-31');
    assert.strictEqual(month.id, '2026-01');
    assert.strictEqual(got('January 2026').id, '2026-01');
    assert.strictEqual(got('2026-08').id, '2026-08', 'the ISO month form');
    assert.strictEqual(got('2026-02').days, 28, 'February 2026 is not a leap');
    assert.strictEqual(got('2024-02').days, 29, 'February 2024 is');

    let day = got('2026-08-13');
    assert.strictEqual(day.kind, 'day');
    assert.strictEqual(day.days, 1);
    assert.strictEqual(day.start, day.end);
  });

  test('a month name in the rendered locale is understood', function (assert) {
    assert.strictEqual(
      got('März 2026', { locale: 'de-DE' }).id,
      '2026-03',
      'the locale vocabulary',
    );
    assert.strictEqual(
      got('Mar 2026', { locale: 'de-DE' }).id,
      '2026-03',
      'and English always, so a reader is never told off for typing Mar',
    );
  });

  test('nonsense and impossible values are refused with a reason', function (assert) {
    assert.strictEqual(parsePeriod('').empty, true, 'empty is not an error');
    assert.true((parsePeriod('zzz').issue ?? '').length > 0);
    assert.true((parsePeriod('Q9 2026').issue ?? '').indexOf('quarter 9') !== -1);
    assert.true((parsePeriod('W54 2026').issue ?? '').indexOf('week 54') !== -1);
    assert.true((parsePeriod('2026-02-30').issue ?? '').indexOf('not exist') !== -1);
  });
});

module('Pretui | controls-period | the determinism fix', function () {
  test('a partial period resolves against the reference', function (assert) {
    assert.strictEqual(
      got('Q3', { reference: REFERENCE }).id,
      '2026-Q3',
      'the year comes from the argument',
    );
    assert.strictEqual(got('Jan', { reference: REFERENCE }).id, '2026-01');
    assert.strictEqual(got('Summer', { reference: REFERENCE }).id, '2026-S2');
  });

  test('a partial period with NO reference is refused, not guessed', function (assert) {
    for (let text of ['Q3', 'Jan', 'W12', 'Summer']) {
      let result = parsePeriod(text);
      assert.strictEqual(result.period, undefined, text + ' does not resolve');
      assert.true(
        (result.issue ?? '').indexOf('year') !== -1,
        text + ' says what is missing: ' + result.issue,
      );
    }
  });
});

module('Pretui | controls-period | ISO weeks', function () {
  test('week 1 of 2026 begins in December 2025', function (assert) {
    assert.strictEqual(
      new Date(isoWeekOneStart(2026)).toISOString().slice(0, 10),
      '2025-12-29',
    );
    assert.strictEqual(
      isoWeeksInYear(2026),
      53,
      '2026 is a fifty-three week year',
    );
    assert.strictEqual(isoWeeksInYear(2025), 52);
  });

  test('a numbered week resolves to a Monday-to-Sunday span', function (assert) {
    let week = got('W12 2026');
    assert.strictEqual(week.start, '2026-03-16');
    assert.strictEqual(week.end, '2026-03-22');
    assert.strictEqual(week.days, 7);
    assert.strictEqual(week.id, '2026-W12');
    assert.strictEqual(got('week 12 2026').id, '2026-W12');
    assert.strictEqual(got('2026-W12').id, '2026-W12');
  });
});

module('Pretui | controls-period | the conventions are knobs', function () {
  test('a fiscal year starting in July, named for the year it starts in', function (assert) {
    let q1 = got('Q1 2026', { fiscalYearStart: 7 });
    assert.strictEqual(q1.start, '2026-07-01');
    assert.strictEqual(q1.end, '2026-09-30');
    let q3 = got('Q3 2026', { fiscalYearStart: 7 });
    assert.strictEqual(q3.start, '2027-01-01', 'and it crosses the boundary');
    assert.strictEqual(q3.end, '2027-03-31');
  });

  test('the same fiscal year named for the year it ENDS in', function (assert) {
    let q1 = got('Q1 2026', { fiscalYearStart: 7, fiscalYearLabel: 'end' });
    assert.strictEqual(q1.start, '2025-07-01');
    assert.strictEqual(q1.end, '2025-09-30');
  });

  test('seasons are three whole months, and they do not overlap', function (assert) {
    let spring = got('Spring 2026');
    let summer = got('Summer 2026');
    let autumn = got('Fall 2026');
    let winter = got('Winter 2026');
    assert.strictEqual(spring.start, '2026-03-01');
    assert.strictEqual(spring.end, '2026-05-31');
    assert.strictEqual(summer.start, '2026-06-01');
    assert.strictEqual(autumn.start, '2026-09-01');
    assert.strictEqual(
      winter.start,
      '2026-12-01',
      'winter starts in December and runs into the next year',
    );
    assert.strictEqual(winter.end, '2027-02-28');
    assert.strictEqual(
      summer.start > spring.end,
      true,
      'no overlap, which the source had',
    );
    assert.strictEqual(got('autumn 2026').id, got('fall 2026').id);
  });

  test('the southern hemisphere is six months round', function (assert) {
    let summer = got('Summer 2026', { hemisphere: 'south' });
    assert.strictEqual(summer.start, '2026-12-01');
    assert.strictEqual(summer.end, '2027-02-28');
  });
});

module('Pretui | controls-period | stepping', function () {
  test('a period steps in its own units', function (assert) {
    assert.strictEqual(shiftPeriod(got('Q4 2026'), 1)?.id, '2027-Q1');
    assert.strictEqual(shiftPeriod(got('Q1 2026'), -1)?.id, '2025-Q4');
    assert.strictEqual(shiftPeriod(got('Dec 2026'), 1)?.id, '2027-01');
    assert.strictEqual(shiftPeriod(got('Jan 2026'), -1)?.id, '2025-12');
    assert.strictEqual(shiftPeriod(got('2026'), 3)?.id, '2029');
    assert.strictEqual(shiftPeriod(got('2026-08-31'), 1)?.id, '2026-09-01');
    assert.strictEqual(shiftPeriod(got('H2 2026'), 1)?.id, '2027-H1');
    assert.strictEqual(shiftPeriod(got('Winter 2026'), 1)?.id, '2027-S1');
  });

  test('weeks step across a fifty-three week year correctly', function (assert) {
    assert.strictEqual(
      shiftPeriod(got('W53 2026'), 1)?.id,
      '2027-W01',
      '2026 has a week 53, so the next week is week 1 of 2027',
    );
    assert.strictEqual(
      shiftPeriod(got('W01 2026'), -1)?.id,
      '2025-W52',
      'and 2025 has only fifty-two',
    );
  });

  test('stepping is reversible', function (assert) {
    for (let text of ['Q2 2026', 'Mar 2026', 'W07 2026', '2026', 'Summer 2026']) {
      let period = got(text);
      let back = shiftPeriod(shiftPeriod(period, 5) as Period, -5);
      assert.strictEqual(back?.id, period.id, text + ' survives a round trip');
    }
  });
});

module('Pretui | controls-period | the resolved shape', function () {
  test('sortKey orders across kinds where id cannot', function (assert) {
    let periods = [got('2026'), got('Q3 2026'), got('Jan 2026'), got('W12 2026')];
    let sorted = periods
      .slice()
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
      .map((p) => p.id);
    assert.deepEqual(sorted, ['2026', '2026-01', '2026-W12', '2026-Q3']);
  });

  test('makePeriod refuses an index its kind does not have', function (assert) {
    assert.strictEqual(makePeriod('quarter', 2026, 5), undefined);
    assert.strictEqual(makePeriod('month', 2026, 0), undefined);
    assert.strictEqual(makePeriod('week', 2025, 53), undefined, '2025 has 52');
    assert.ok(makePeriod('week', 2026, 53), 'but 2026 has 53');
  });

  test('the range reads the way the locale writes dates', function (assert) {
    let text = periodRangeText(got('Q3 2026'), 'en-US');
    assert.true(text.indexOf('Jul') !== -1, text);
    assert.true(text.indexOf('Sep') !== -1, text);
    assert.strictEqual(
      periodRangeText(got('2026-08-13')).indexOf('–'),
      -1,
      'a single day is written once, not as a range from itself',
    );
  });

  test('daysBetween is inclusive of both ends', function (assert) {
    assert.strictEqual(daysBetween('2026-01-01', '2026-01-01'), 1);
    assert.strictEqual(daysBetween('2026-01-01', '2026-12-31'), 365);
    assert.strictEqual(daysBetween('2024-01-01', '2024-12-31'), 366);
  });

  test('the documented forms all parse', function (assert) {
    for (let form of PERIOD_FORMS) {
      assert.ok(
        parsePeriod(form).period,
        form + ' is documented, so it must work',
      );
    }
  });
});

module('Pretui | controls-period | PeriodInput', function (hooks) {
  setupCardTest(hooks);

  test('typing a period resolves it and shows the range', async function (assert) {
    let seen: Array<Period | undefined> = [];
    const capture = (period: Period | undefined) => seen.push(period);
    await render(
      <template>
        <PeriodInput @locale='en-US' @onChange={{capture}} />
      </template>,
    );
    assert.strictEqual(readout(), '', 'nothing claimed before anything is typed');
    await fillIn(box(), 'q3 2026');
    assert.strictEqual(seen[seen.length - 1]?.id, '2026-Q3');
    assert.true(readout().indexOf('Q3 2026') !== -1, readout());
    assert.true(readout().indexOf('92 days') !== -1, readout());
  });

  test('a resolved period is normalised on commit, so the reader sees it landed', async function (assert) {
    await render(<template><PeriodInput @locale='en-US' /></template>);
    await fillIn(box(), 'q3 2026');
    await blur(box());
    assert.strictEqual(box().value, 'Q3 2026');
  });

  test('the reason is withheld until a commit', async function (assert) {
    await render(<template><PeriodInput @locale='en-US' /></template>);
    await fillIn(box(), 'Ja');
    assert.strictEqual(
      readout(),
      '',
      'a reader halfway through January is not told off',
    );
    await blur(box());
    assert.true(readout().length > 0, 'and then it is: ' + readout());
  });

  test('a partial period says the year is missing rather than inventing one', async function (assert) {
    let issues: Array<string | undefined> = [];
    const capture = (_p: Period | undefined, result: PeriodResult) =>
      issues.push(result.issue);
    await render(<template><PeriodInput @onChange={{capture}} /></template>);
    await fillIn(box(), 'Q3');
    await blur(box());
    assert.true(
      (issues[issues.length - 1] ?? '').indexOf('year') !== -1,
      issues[issues.length - 1],
    );
    assert.true(readout().indexOf('clock') !== -1, readout());
  });

  test('with a reference, the same partial period resolves', async function (assert) {
    let seen: Array<Period | undefined> = [];
    const capture = (period: Period | undefined) => seen.push(period);
    await render(
      <template>
        <PeriodInput @reference={{REFERENCE}} @onChange={{capture}} />
      </template>,
    );
    await fillIn(box(), 'Q3');
    assert.strictEqual(seen[seen.length - 1]?.id, '2026-Q3');
  });

  test('the stepper moves the period by one of its own kind', async function (assert) {
    let seen: Array<Period | undefined> = [];
    const capture = (period: Period | undefined) => seen.push(period);
    await render(
      <template>
        <PeriodInput @defaultValue='Q4 2026' @onChange={{capture}} />
      </template>,
    );
    await click(
      root().querySelector('[data-test-pretui-period-next]') as HTMLElement,
    );
    assert.strictEqual(seen[seen.length - 1]?.id, '2027-Q1');
    assert.strictEqual(box().value, 'Q1 2027');
    await click(
      root().querySelector('[data-test-pretui-period-previous]') as HTMLElement,
    );
    assert.strictEqual(seen[seen.length - 1]?.id, '2026-Q4');
  });

  test('the stepper stays reachable when it cannot act', async function (assert) {
    await render(<template><PeriodInput /></template>);
    let next = root().querySelector(
      '[data-test-pretui-period-next]',
    ) as HTMLElement;
    assert.strictEqual(next.getAttribute('aria-disabled'), 'true');
    assert.strictEqual(
      next.hasAttribute('disabled'),
      false,
      'aria-disabled, never the attribute — it must stay focusable',
    );
  });

  test('the control owns a real label and never a placeholder', async function (assert) {
    await render(
      <template><PeriodInput @label='Reporting period' @hint='Q3 2026' /></template>,
    );
    let id = box().id;
    assert.ok(root().querySelector('label[for="' + id + '"]'));
    assert.strictEqual(box().getAttribute('aria-label'), null);
    assert.strictEqual(box().getAttribute('placeholder'), null);
    assert.true(
      (root().textContent ?? '').indexOf('Q3 2026') !== -1,
      'the hint is a ghost span instead',
    );
  });
});

module('Pretui | controls-period | usage page', function (hooks) {
  setupCardTest(hooks);

  test('the demo renders', async function (assert) {
    for (let name of DEMOS_CONTROLS_PERIOD_NAMES) {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
         DEMOS registries are Record<string, unknown> by contract. */
      let Page = PAGES[name] as any;
      await render(<template><Page /></template>);
      assert.true(
        (root().textContent ?? '').indexOf(name) !== -1,
        name + ' renders and names itself',
      );
    }
  });
});
