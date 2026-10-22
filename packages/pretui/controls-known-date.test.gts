// Pretui — proof for KnownDate.
//
// Two things are being proven here and both are about determinism as much as
// correctness:
//
//  1. **The permissive parse.** Upstream's wa-known-date says "no clever
//     parsing"; this component's whole claim is that it understands what a
//     reader typed. That claim is only worth anything if it is enumerated.
//  2. **The relative phrasing, against a FIXED reference instant.** A realm
//     forbids `Date.now()` because it makes a card index differently every
//     time it is indexed. The phrase functions therefore take the reference
//     as an argument and this file pins it, so the same input produces the
//     same sentence today and in ten years.
//
// The 29 February cases are the ones that catch a millisecond-division age
// calculation, which is what nearly every relative-time helper does.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DEFAULT_PIVOT_YEAR, KnownDate, daysInMonth, expandYear, fromIsoDate, knownDatePhrase, orderForLocale, parseKnownDate, parseMonth, splitWholeDate, toIsoDate, wholeYearsBetween } from './components/known-date';

/** The one instant this file measures everything against. Not the clock. */
const NOW = '2026-08-13';

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function boxes(): HTMLInputElement[] {
  return Array.from(
    root().querySelectorAll<HTMLInputElement>(
      '[data-test-pretui-known-date-part]',
    ),
  );
}
function verdict(): string {
  return (
    root().querySelector(
      '[data-test-pretui-known-date-verdict]',
    ) as HTMLElement
  ).textContent?.trim() ?? '';
}

module('Pretui | known date | month vocabulary', function () {
  test('digits', function (assert) {
    assert.strictEqual(parseMonth('3'), 3);
    assert.strictEqual(parseMonth('03'), 3);
    assert.strictEqual(parseMonth('12'), 12);
    assert.strictEqual(parseMonth('0'), undefined, 'zero is not a month');
    assert.strictEqual(parseMonth('13'), undefined, 'nor is thirteen');
  });

  test('names, long and short, in any case', function (assert) {
    assert.strictEqual(parseMonth('March'), 3);
    assert.strictEqual(parseMonth('march'), 3);
    assert.strictEqual(parseMonth('MAR'), 3);
    assert.strictEqual(parseMonth('Sep'), 9);
  });

  test('a prefix of at least three characters resolves; shorter is refused', function (assert) {
    assert.strictEqual(parseMonth('sept'), 9, 'a longer prefix still lands');
    assert.strictEqual(parseMonth('ja'), undefined, 'two characters are ambiguous, and guessing is worse than asking');
    assert.strictEqual(parseMonth('s'), undefined);
  });

  test('the rendered locale contributes its own month names', function (assert) {
    assert.strictEqual(parseMonth('März', 'de-DE'), 3, 'the locale vocabulary');
    assert.strictEqual(
      parseMonth('March', 'de-DE'),
      3,
      'and English is always included, so a reader typing Mar into a German form is still understood',
    );
  });

  test('nonsense is refused rather than guessed at', function (assert) {
    assert.strictEqual(parseMonth(''), undefined);
    assert.strictEqual(parseMonth('   '), undefined);
    assert.strictEqual(parseMonth('smarch'), undefined);
  });
});

module('Pretui | known date | year window', function () {
  test('four digits pass through', function (assert) {
    assert.strictEqual(expandYear('1990', 2026), 1990);
    assert.strictEqual(expandYear('2007', 2026), 2007);
  });

  test('two digits slide against the reference — this is why the reference matters', function (assert) {
    assert.strictEqual(expandYear('90', 2026), 1990, 'a birthday, not the year 2090');
    assert.strictEqual(expandYear('07', 2026), 2007, 'inside the window');
    assert.strictEqual(expandYear('26', 2026), 2026, 'the boundary is inclusive');
    assert.strictEqual(expandYear('27', 2026), 1927, 'one past it falls to the century before');
  });

  test('the window moves with the reference', function (assert) {
    assert.strictEqual(expandYear('50', 1980), 1950, 'inside a 1980 window');
    assert.strictEqual(expandYear('90', 1980), 1890, 'outside it');
  });

  test('with no reference, the documented constant is used rather than the clock', function (assert) {
    assert.strictEqual(DEFAULT_PIVOT_YEAR, 2000);
    assert.strictEqual(expandYear('90'), 1990);
    assert.strictEqual(expandYear('00'), 2000);
  });

  test('three digits are refused rather than guessed at', function (assert) {
    assert.strictEqual(expandYear('199', 2026), undefined);
    assert.strictEqual(expandYear('abc', 2026), undefined);
  });
});

module('Pretui | known date | calendar', function () {
  test('daysInMonth knows the Gregorian leap rule', function (assert) {
    assert.strictEqual(daysInMonth(2023, 2), 28);
    assert.strictEqual(daysInMonth(2024, 2), 29, 'divisible by four');
    assert.strictEqual(daysInMonth(1900, 2), 28, 'but not by a non-400 century');
    assert.strictEqual(daysInMonth(2000, 2), 29, 'and 2000 is a leap year');
    assert.strictEqual(daysInMonth(2024, 4), 30);
    assert.strictEqual(daysInMonth(2024, 12), 31);
  });

  test('fromIsoDate refuses a date that does not exist — new Date() would roll it over', function (assert) {
    assert.deepEqual(fromIsoDate('2024-02-29'), { year: 2024, month: 2, day: 29 });
    assert.strictEqual(fromIsoDate('2023-02-29'), undefined, 'not a leap year');
    assert.strictEqual(fromIsoDate('2024-13-01'), undefined, 'no thirteenth month');
    assert.strictEqual(fromIsoDate('nonsense'), undefined);
    assert.strictEqual(fromIsoDate(undefined), undefined);
  });

  test('toIsoDate zero-pads', function (assert) {
    assert.strictEqual(toIsoDate(2007, 3, 5), '2007-03-05');
    assert.strictEqual(toIsoDate(875, 12, 31), '0875-12-31');
  });
});

module('Pretui | known date | whole-date recognition', function () {
  test('a whole date pasted into any box is recognised', function (assert) {
    assert.deepEqual(splitWholeDate('15/4/1990', 'dmy'), {
      day: '15',
      month: '4',
      year: '1990',
    });
    assert.deepEqual(splitWholeDate('15 April 1990', 'dmy'), {
      day: '15',
      month: 'April',
      year: '1990',
    });
    assert.deepEqual(splitWholeDate('4-15-1990', 'mdy'), {
      month: '4',
      day: '15',
      year: '1990',
    });
  });

  test('a leading four-digit group forces ISO order whatever the locale says', function (assert) {
    assert.deepEqual(splitWholeDate('1990-04-15', 'dmy'), {
      year: '1990',
      month: '04',
      day: '15',
    });
    assert.deepEqual(
      splitWholeDate('1990-04-15', 'mdy'),
      { year: '1990', month: '04', day: '15' },
      'a four-digit day does not exist, so the reader meant a year',
    );
  });

  test('a partially typed value is NOT redistributed', function (assert) {
    assert.strictEqual(splitWholeDate('1', 'dmy'), undefined, 'a single digit is just a digit');
    assert.strictEqual(splitWholeDate('15/4', 'dmy'), undefined, 'two groups is not a date');
    assert.strictEqual(splitWholeDate('15/4/1990/7', 'dmy'), undefined, 'four groups is not either');
  });
});

module('Pretui | known date | parse', function () {
  test('an untouched control is empty, not wrong', function (assert) {
    let out = parseKnownDate({ day: '', month: '', year: '' });
    assert.true(out.empty, 'empty');
    assert.strictEqual(out.issue, undefined, 'and NOT an error — telling a reader off before they have started is the classic date-input failure');
  });

  test('a half-filled control names the boxes still to fill', function (assert) {
    let one = parseKnownDate({ day: '15', month: '', year: '1990' });
    assert.strictEqual(one.issue, 'Add the month.');
    let two = parseKnownDate({ day: '', month: '', year: '1990' });
    assert.strictEqual(two.issue, 'Add the day and month.');
  });

  test('a complete permissive date resolves', function (assert) {
    assert.strictEqual(
      parseKnownDate({ day: '15', month: 'apr', year: '90' }, { pivotYear: 2026 }).iso,
      '1990-04-15',
      'a name in the month box and two digits in the year box',
    );
  });

  test('a day that does not exist is refused with a reason that names the problem', function (assert) {
    let out = parseKnownDate({ day: '31', month: '2', year: '2024' });
    assert.strictEqual(out.iso, undefined, 'no date is produced');
    assert.true(
      (out.issue ?? '').indexOf('29 days') !== -1,
      'and the reason states the actual ceiling: ' + out.issue,
    );
  });

  test('29 February is accepted in a leap year and refused otherwise', function (assert) {
    assert.strictEqual(parseKnownDate({ day: '29', month: '2', year: '2024' }).iso, '2024-02-29');
    assert.strictEqual(parseKnownDate({ day: '29', month: '2', year: '2023' }).iso, undefined);
  });

  test('min and max are compared as ISO STRINGS, so no time zone can shift them', function (assert) {
    let low = parseKnownDate({ day: '1', month: '1', year: '1800' }, { min: '1900-01-01' });
    assert.true((low.issue ?? '').indexOf('before the earliest') !== -1);
    let high = parseKnownDate({ day: '1', month: '1', year: '2200' }, { max: '2099-12-31' });
    assert.true((high.issue ?? '').indexOf('after the latest') !== -1);
    assert.strictEqual(
      parseKnownDate({ day: '1', month: '1', year: '1900' }, { min: '1900-01-01' }).iso,
      '1900-01-01',
      'the bounds are inclusive',
    );
  });
});

module('Pretui | known date | relative phrasing', function () {
  test('the near cases are named rather than counted', function (assert) {
    assert.strictEqual(knownDatePhrase(NOW, NOW), 'today');
    assert.strictEqual(knownDatePhrase('2026-08-14', NOW), 'tomorrow');
    assert.strictEqual(knownDatePhrase('2026-08-12', NOW), 'yesterday');
  });

  test('days below a fortnight, months below two years, years above', function (assert) {
    assert.strictEqual(knownDatePhrase('2026-08-08', NOW), '5 days ago');
    assert.strictEqual(knownDatePhrase('2026-08-20', NOW), 'in 7 days');
    assert.strictEqual(knownDatePhrase('2026-05-13', NOW), '3 months ago');
    assert.strictEqual(knownDatePhrase('2027-08-13', NOW), 'in 12 months');
    assert.strictEqual(knownDatePhrase('1990-04-15', NOW), '36 years ago');
  });

  test('a bad input produces no phrase rather than a wrong one', function (assert) {
    assert.strictEqual(knownDatePhrase('2023-02-29', NOW), '', 'a date that never existed');
    assert.strictEqual(knownDatePhrase('', NOW), '');
  });

  test('an age is calendar arithmetic, not milliseconds divided by 365.25', function (assert) {
    assert.strictEqual(
      wholeYearsBetween('1990-04-15', '2026-04-14'),
      35,
      'the day BEFORE the anniversary is still the lower age',
    );
    assert.strictEqual(
      wholeYearsBetween('1990-04-15', '2026-04-15'),
      36,
      'and the anniversary itself flips it',
    );
  });

  test('a 29 February birthday — the case millisecond division gets wrong', function (assert) {
    assert.strictEqual(
      wholeYearsBetween('2000-02-29', '2024-02-28'),
      23,
      'not yet, on a non-leap-adjacent reading',
    );
    assert.strictEqual(wholeYearsBetween('2000-02-29', '2024-02-29'), 24);
    assert.strictEqual(
      wholeYearsBetween('2000-02-29', '2023-03-01'),
      23,
      'and the year after a non-leap 28 February still counts',
    );
  });

  test('future dates are negative', function (assert) {
    assert.strictEqual(wholeYearsBetween('2030-01-01', '2026-01-01'), -4);
  });
});

module('Pretui | known date | locale order', function () {
  test('the order is asked of Intl, not kept as a table', function (assert) {
    assert.strictEqual(orderForLocale('en-GB'), 'dmy');
    assert.strictEqual(orderForLocale('en-US'), 'mdy');
    assert.strictEqual(orderForLocale('ja-JP'), 'ymd');
  });

  test('a malformed tag renders something rather than nothing', function (assert) {
    assert.strictEqual(orderForLocale('not a tag'), 'dmy', 'the majority order worldwide');
  });
});

module('Pretui | known date | render', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('three labelled boxes inside a fieldset, in the locale order', async function (assert) {
    await render(
      <template><KnownDate @label='Harvested' @locale='en-GB' @reference='2026-08-13' /></template>,
    );
    let parts = boxes().map((el) =>
      el.getAttribute('data-test-pretui-known-date-part'),
    );
    assert.deepEqual(parts, ['day', 'month', 'year'], 'en-GB order');
    assert.ok(root().querySelector('fieldset'), 'a group is a fieldset');
    assert.strictEqual(
      root().querySelector('legend')?.textContent?.trim(),
      'Harvested',
      'with a legend, not a floating label',
    );
    assert.strictEqual(
      root().querySelectorAll('label').length,
      3,
      'and a real label per box',
    );
  });

  test('the field order follows the locale, and only the order', async function (assert) {
    await render(<template><KnownDate @locale='ja-JP' /></template>);
    assert.deepEqual(
      boxes().map((el) => el.getAttribute('data-test-pretui-known-date-part')),
      ['year', 'month', 'day'],
      'ja-JP is ymd',
    );
    assert.strictEqual(
      root().querySelector('label')?.textContent?.trim(),
      'Year',
      'the labels stay in the interface language',
    );
  });

  test('a permissive month and a two-digit year resolve, and the echo confirms it', async function (assert) {
    await render(
      <template><KnownDate @locale='en-GB' @reference='2026-08-13' /></template>,
    );
    let [day, month, year] = boxes() as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
    ];
    await fillIn(day, '15');
    await fillIn(month, 'apr');
    await fillIn(year, '90');
    let said = verdict();
    assert.true(said.indexOf('1990') !== -1, 'the year expanded through the window: ' + said);
    assert.true(said.indexOf('April') !== -1, 'and the month name resolved');
    assert.true(
      said.indexOf('years ago') !== -1,
      'with a relative phrase derived from @reference, never the clock',
    );
    assert.strictEqual(
      root().querySelector('time')?.getAttribute('datetime'),
      '1990-04-15',
      'and the machine form rides along in a <time datetime>',
    );
  });

  test('a whole date typed into ONE box fills all three', async function (assert) {
    await render(
      <template><KnownDate @locale='en-GB' @reference='2026-08-13' /></template>,
    );
    let [day, month, year] = boxes() as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
    ];
    await fillIn(day, '2007-03-27');
    assert.strictEqual(day.value, '27', 'day');
    assert.strictEqual(month.value, '03', 'month');
    assert.strictEqual(year.value, '2007', 'year — handled on value, so typing, pasting, autofill and dictation all work');
  });

  test('an impossible date is refused with a reason, and reports undefined', async function (assert) {
    let captured: (string | undefined)[] = [];
    let take = (iso: string | undefined) => captured.push(iso);
    await render(
      <template><KnownDate @locale='en-GB' @onChange={{take}} /></template>,
    );
    let [day, month, year] = boxes() as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
    ];
    await fillIn(day, '31');
    await fillIn(month, '2');
    await fillIn(year, '2024');
    assert.true(verdict().indexOf('29 days') !== -1, 'the reason names the ceiling: ' + verdict());
    assert.strictEqual(
      captured[captured.length - 1],
      undefined,
      'and nothing is reported as a date',
    );
  });

  test('with no reference the component still works, it just claims nothing about elapsed time', async function (assert) {
    await render(<template><KnownDate @locale='en-GB' @value='1990-04-15' /></template>);
    let said = verdict();
    assert.true(said.indexOf('1990') !== -1, 'the date is echoed: ' + said);
    assert.strictEqual(
      said.indexOf('ago'),
      -1,
      'but no relative phrase is invented from the wall clock',
    );
  });

  test('the initial value seeds the three boxes', async function (assert) {
    await render(<template><KnownDate @locale='en-GB' @value='2007-03-27' /></template>);
    assert.deepEqual(
      boxes().map((el) => el.value),
      ['27', '03', '2007'],
    );
  });
});
