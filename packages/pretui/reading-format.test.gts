// Pretui — proof for the formatting territory: FormatBytes, FormatDate,
// FormatNumber, the Odometer, and the pure helpers behind them
// (formatBytes, formatClock, rollPath).
//
// Everything here is asserted against an EXPLICIT locale. The harness runs on
// whatever locale the browser was launched with, so an assertion on the
// runtime default would pass on one machine and fail on another; 'en-US' and
// 'de-DE' are named so the separators and unit placement are the component's
// choices, not the runner's.
//
// The Odometer is the interesting case: it promises a shortest-path ring walk
// with no timers, and that arithmetic is fully observable in the DOM (the
// rendered ring slice plus the start/rest custom properties), so it is
// asserted there rather than by watching an animation.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import {
  FormatBytes,
  FormatDate,
  FormatNumber,
  Odometer,
  formatBytes,
  formatClock,
  rollPath,
  toDate,
  toNumber,
} from './reading-format';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
/** The visible half of a FormattedValue, with the sr-only mirror excluded. */
function visible(): string {
  return (q('.pretui-fv-vis').textContent ?? '').replace(/\s+/g, ' ').trim();
}
function spoken(): string | undefined {
  return q('.pretui-fv-sr')?.textContent?.replace(/\s+/g, ' ').trim();
}

module('Pretui | reading-format', function (hooks) {
  setupCardTest(hooks);

  // ── coercion helpers ────────────────────────────────────────────────────
  test('toNumber accepts numbers and numeric strings and rejects everything else', function (assert) {
    assert.strictEqual(toNumber(42), 42);
    assert.strictEqual(toNumber('42.5'), 42.5);
    assert.strictEqual(toNumber(undefined), undefined);
    assert.strictEqual(toNumber('not a number'), undefined, 'never NaN — the caller gets a placeholder');
    assert.strictEqual(toNumber(Number.POSITIVE_INFINITY), undefined, 'non-finite is not a value to print');
  });

  test('toDate reads a bare YYYY-MM-DD as a local calendar date, not UTC midnight', function (assert) {
    let d = toDate('2026-03-14') as Date;
    assert.strictEqual(d.getFullYear(), 2026);
    assert.strictEqual(d.getMonth(), 2, 'March');
    assert.strictEqual(
      d.getDate(),
      14,
      'read as UTC this would land on the 13th anywhere west of Greenwich',
    );
    assert.strictEqual(toDate('nonsense'), undefined);
    assert.strictEqual(toDate(undefined), undefined);
  });

  // ── formatClock ─────────────────────────────────────────────────────────
  test('formatClock renders a timer and refuses to print a negative or unknown one', function (assert) {
    assert.strictEqual(formatClock(0), '0:00');
    assert.strictEqual(formatClock(65), '1:05');
    assert.strictEqual(formatClock(-4), '0:00', 'a negative elapsed time is a bug upstream, not a display');
    assert.strictEqual(formatClock(Number.NaN), '0:00');
  });

  // ── formatBytes ─────────────────────────────────────────────────────────
  test('formatBytes defaults to IEC binary and never conflates it with SI', function (assert) {
    assert.strictEqual(
      formatBytes(1_000_000, { locale: 'en-US' }).text,
      '976.6\u00a0KiB',
      'binary divides by 1024 and labels it KiB',
    );
    assert.strictEqual(
      formatBytes(1_000_000, { locale: 'en-US', base: 'decimal' }).text,
      '1 MB',
      'decimal divides by 1000 and labels it MB — the same byte count, a different rung',
    );
  });

  test('formatBytes keeps the number and its unit on one line', function (assert) {
    assert.true(
      formatBytes(2_500_000, { locale: 'en-US' }).text.includes('\u00a0'),
      'a non-breaking space, so 2.4 MiB never wraps in half',
    );
  });

  test('formatBytes mirrors IEC symbols as spelled-out words for screen readers', function (assert) {
    let r = formatBytes(2_500_000, { locale: 'en-US' });
    assert.strictEqual(r.text, '2.4\u00a0MiB');
    assert.strictEqual(r.spoken, '2.4 mebibytes', '"MiB" read aloud is noise');
    assert.strictEqual(r.step, 2);
  });

  test('formatBytes uses the singular word for exactly one unit', function (assert) {
    assert.strictEqual(formatBytes(1024 * 1024, { locale: 'en-US' }).spoken, '1 mebibyte');
  });

  test('formatBytes leaves raw bytes unscaled and unrounded, and clamps at the top rung', function (assert) {
    assert.true(/^0 (byte|bytes|B)$/.test(formatBytes(0, { locale: 'en-US' }).text), `zero goes through Intl's unit formatter, whose short byte label varies by ICU version ("${formatBytes(0, { locale: 'en-US' }).text}")`);
    assert.strictEqual(formatBytes(512, { locale: 'en-US' }).step, 0, 'below one KiB stays in bytes');
    let huge = formatBytes(1024 ** 9, { locale: 'en-US' });
    assert.strictEqual(huge.step, 5, 'the last rung it has a name for, not an undefined one');
    assert.true(huge.text.includes('PiB'));
  });

  test('formatBytes handles bits and negative values', function (assert) {
    assert.strictEqual(formatBytes(1024, { locale: 'en-US', unit: 'bit' }).text, '1\u00a0Kibit');
    assert.strictEqual(
      formatBytes(-2048, { locale: 'en-US' }).text,
      '-2\u00a0KiB',
      'the magnitude picks the rung; the sign survives',
    );
  });

  test('formatBytes localises the number and the SI unit together', function (assert) {
    assert.strictEqual(
      formatBytes(1024, { locale: 'de-DE' }).text,
      '1\u00a0KiB',
      'the IEC symbol is not translated, only the number',
    );
    assert.true(
      formatBytes(2500, { locale: 'de-DE', base: 'decimal' }).text.startsWith('2,5'),
      'the German decimal comma reaches the output',
    );
  });

  // ── FormatBytes component ───────────────────────────────────────────────
  test('FormatBytes renders the size and hides the visible text behind its spoken mirror', async function (assert) {
    await render(<template><FormatBytes @value={{2500000}} @locale='en-US' /></template>);
    assert.strictEqual(visible(), '2.4 MiB');
    assert.strictEqual(spoken(), '2.4 mebibytes');
    assert.strictEqual(
      q('.pretui-fv-vis').getAttribute('aria-hidden'),
      'true',
      'the mirror replaces the visible text rather than doubling it',
    );
  });

  test('FormatBytes shows a muted placeholder for a missing or unparseable value', async function (assert) {
    await render(<template><FormatBytes @value='nope' /></template>);
    assert.strictEqual(visible(), '—');
    assert.strictEqual(q('[data-test-pretui-formatted-value]').dataset['empty'], 'true');
    assert.strictEqual(spoken(), undefined, 'nothing to say about a value that is not there');
  });

  test('FormatBytes suppresses and forces the spoken mirror on request', async function (assert) {
    await render(<template><FormatBytes @value={{2500000}} @locale='en-US' @spoken='off' /></template>);
    assert.strictEqual(spoken(), undefined);
    assert.strictEqual(q('.pretui-fv-vis').getAttribute('aria-hidden'), null, 'so the visible text is read');
  });

  test('FormatBytes in decimal short form needs no mirror', async function (assert) {
    await render(<template><FormatBytes @value={{2500000}} @base='decimal' @locale='en-US' /></template>);
    assert.strictEqual(visible(), '2.5 MB');
    assert.strictEqual(spoken(), undefined, 'CLDR already placed a readable unit');
  });

  test('FormatBytes can wear the Token dress', async function (assert) {
    await render(<template><FormatBytes @value={{1024}} @locale='en-US' @token={{true}} /></template>);
    assert.strictEqual(q('[data-test-pretui-token]').tagName, 'CODE');
  });

  // ── FormatNumber ────────────────────────────────────────────────────────
  test('FormatNumber groups by locale and formats currency', async function (assert) {
    await render(
      <template>
        <FormatNumber @value={{1234567.891}} @locale='en-US' @maximumFractionDigits={{2}} />
      </template>,
    );
    assert.strictEqual(visible(), '1,234,567.89');
  });

  test('FormatNumber renders a percent from a fraction', async function (assert) {
    await render(<template><FormatNumber @value={{0.42}} @style='percent' @locale='en-US' /></template>);
    assert.strictEqual(visible(), '42%');
  });

  test('FormatNumber degrades a currency with no code to a decimal instead of throwing', async function (assert) {
    await render(<template><FormatNumber @value={{12480}} @style='currency' @locale='en-US' /></template>);
    assert.strictEqual(visible(), '12,480', 'a missing @currency is a caller slip, not a crash');
  });

  test('FormatNumber speaks the full value behind a compact one', async function (assert) {
    await render(<template><FormatNumber @value={{1234567}} @notation='compact' @locale='en-US' /></template>);
    assert.strictEqual(visible(), '1.2M');
    assert.strictEqual(spoken(), '1,234,567', 'the abbreviation is visual only');
  });

  test('FormatNumber leaves a plain number unmirrored', async function (assert) {
    await render(<template><FormatNumber @value={{1234}} @locale='en-US' /></template>);
    assert.strictEqual(spoken(), undefined, 'nothing about "1,234" reads badly aloud');
  });

  test('FormatNumber formats normally under an unrecognised locale tag — Intl accepts it', async function (assert) {
    await render(<template><FormatNumber @value={{1234}} @locale='not-a-locale' /></template>);
    assert.true(/^1\D234$/.test(visible()), `grouped by Intl under the runtime default ("${visible()}"), not String(value)`);
  });

  test('FormatNumber shows the placeholder for a non-finite value', async function (assert) {
    await render(<template><FormatNumber @value='n/a' @placeholder='unknown' /></template>);
    assert.strictEqual(visible(), 'unknown');
    assert.strictEqual(q('[data-test-pretui-formatted-value]').dataset['empty'], 'true');
  });

  // ── FormatDate ──────────────────────────────────────────────────────────
  test('FormatDate is a <time> carrying a calendar-correct machine value', async function (assert) {
    await render(<template><FormatDate @date='2026-03-14' @locale='en-US' /></template>);
    let el = q('[data-test-pretui-format-date]');
    assert.strictEqual(el.tagName, 'TIME');
    assert.strictEqual(
      el.getAttribute('datetime'),
      '2026-03-14',
      'a date-only rendering stamps the calendar date, not an instant that could slip a day',
    );
    assert.strictEqual(visible(), 'Mar 14, 2026', 'medium is the default preset');
  });

  test('FormatDate emits an instant once a time component is asked for', async function (assert) {
    const AT = new Date(Date.UTC(2026, 2, 14, 9, 30));
    await render(
      <template><FormatDate @date={{AT}} @locale='en-US' @timeStyle='short' @dateStyle='medium' @timeZone='UTC' /></template>,
    );
    assert.strictEqual(q('[data-test-pretui-format-date]').getAttribute('datetime'), AT.toISOString());
    assert.true(visible().includes('9:30'), 'the time is rendered in the requested zone');
  });

  test('FormatDate drops the presets when a component knob arrives (Intl would throw)', async function (assert) {
    await render(
      <template><FormatDate @date='2026-03-14' @locale='en-US' @dateStyle='full' @month='short' @day='numeric' /></template>,
    );
    assert.strictEqual(visible(), 'Mar 14', 'the parts win — and nothing threw');
  });

  test('FormatDate omits the year only for a date in the same year as @now', async function (assert) {
    await render(
      <template>
        <FormatDate @date='2026-03-14' @now='2026-09-04' @omitCurrentYear={{true}} @dateStyle='medium' @locale='en-US' />
        <FormatDate @date='2025-03-14' @now='2026-09-04' @omitCurrentYear={{true}} @dateStyle='medium' @locale='en-US' />
      </template>,
    );
    assert.deepEqual(
      all('.pretui-fv-vis').map((e) => e.textContent?.trim()),
      ['Mar 14', 'Mar 14, 2025'],
      'this year loses the year; an older one keeps it',
    );
  });

  test('KNOWN GAP: @omitCurrentYear is inert when dropping the year leaves no rendering knob behind', async function (assert) {
    // With neither a preset nor a component knob, `requested` is `{}`, so
    // deleting `year` is a no-op and the empty bag falls through to
    // `{ dateStyle: 'medium' }`, which puts the year back. The arg IS live with
    // a preset or with `@year @month @day` (see the test above). Pinned so the
    // day this is fixed, this expectation fails and gets flipped.
    await render(
      <template><FormatDate @date='2026-03-14' @now='2026-09-04' @omitCurrentYear={{true}} @locale='en-US' /></template>,
    );
    assert.strictEqual(visible(), 'Mar 14, 2026', 'the default preset reinstates the year');
  });

  test('FormatDate is inert about the year without @now — it never reads the clock', async function (assert) {
    await render(<template><FormatDate @date='2026-03-14' @omitCurrentYear={{true}} @locale='en-US' /></template>);
    assert.strictEqual(visible(), 'Mar 14, 2026');
  });

  test('FormatDate mirrors a numeric-looking date and titles the long form', async function (assert) {
    await render(<template><FormatDate @date='2026-03-14' @dateStyle='short' @locale='en-US' /></template>);
    assert.strictEqual(visible(), '3/14/26');
    assert.strictEqual(spoken(), 'Saturday, March 14, 2026', '"3/14/26" read aloud is digits');
    assert.strictEqual(
      q('[data-test-pretui-format-date]').getAttribute('title'),
      'Saturday, March 14, 2026',
    );
  });

  test('FormatDate drops the title on request', async function (assert) {
    await render(<template><FormatDate @date='2026-03-14' @locale='en-US' @hint={{false}} /></template>);
    assert.strictEqual(q('[data-test-pretui-format-date]').getAttribute('title'), null);
  });

  test('FormatDate renders a placeholder with no datetime for an unparseable date', async function (assert) {
    await render(<template><FormatDate @date='not a date' /></template>);
    assert.strictEqual(visible(), '—');
    assert.strictEqual(
      q('[data-test-pretui-format-date]').getAttribute('datetime'),
      null,
      'no machine value invented for a value that does not exist',
    );
  });

  test('FormatDate survives an unknown time zone by retrying without options — the dateStyle is dropped with the zone', async function (assert) {
    await render(<template><FormatDate @date='2026-03-14' @locale='en-US' @timeZone='Mars/Olympus' /></template>);
    assert.strictEqual(visible(), '3/14/2026', 'the locale default, not the medium preset');
  });

  // ── rollPath ────────────────────────────────────────────────────────────
  test('rollPath walks the shorter way around the ring', function (assert) {
    assert.deepEqual(rollPath(9, 0), { cells: ['9', '0'], start: 0, rest: 1 }, '9→0 rolls forward one, not back nine');
    assert.deepEqual(rollPath(0, 9), { cells: ['9', '0'], start: 1, rest: 0 }, 'and 0→9 rolls back one');
    assert.deepEqual(
      rollPath(8, 3),
      { cells: ['8', '9', '0', '1', '2', '3'], start: 0, rest: 5 },
      'a tie of five goes forward',
    );
    assert.deepEqual(
      rollPath(7, 3),
      { cells: ['3', '4', '5', '6', '7'], start: 4, rest: 0 },
      'four back beats six forward',
    );
  });

  test('rollPath renders at most six cells, never the whole ring', function (assert) {
    for (let from = 0; from < 10; from++) {
      for (let to = 0; to < 10; to++) {
        let { cells, start, rest } = rollPath(from, to);
        assert.true(cells.length <= 6, `${from}→${to} stays a slice`);
        assert.strictEqual(cells[start], String(from), `${from}→${to} enters on the old digit`);
        assert.strictEqual(cells[rest], String(to), `${from}→${to} rests on the new one`);
      }
    }
  });

  test('rollPath is a no-op for an unchanged digit', function (assert) {
    assert.deepEqual(rollPath(4, 4), { cells: ['4'], start: 0, rest: 0 });
  });

  // ── Odometer ────────────────────────────────────────────────────────────
  test('Odometer splits its value into digit columns and static characters', async function (assert) {
    await render(<template><Odometer @value={{1204}} @locale='en-US' /></template>);
    assert.strictEqual(
      all('.pretui-odo-digit .pretui-odo-strut').map((s) => s.textContent).join(''),
      '1204',
      'four rolling digits',
    );
    assert.deepEqual(
      all('.pretui-odo-char').map((c) => c.textContent),
      [','],
      'the grouping separator is static — only digits roll',
    );
  });

  test('Odometer hides the digit track and mirrors the value for screen readers, silently by default', async function (assert) {
    await render(<template><Odometer @value={{1204}} @locale='en-US' /></template>);
    assert.strictEqual(q('.pretui-odo-track').getAttribute('aria-hidden'), 'true');
    let sr = q('.pretui-odo-sr');
    assert.strictEqual(sr.textContent?.trim(), '1,204');
    assert.strictEqual(
      sr.getAttribute('aria-live'),
      null,
      'a value that rolls on every tick would otherwise spam a screen reader',
    );
  });

  test('Odometer announces only when asked to', async function (assert) {
    await render(<template><Odometer @value={{7}} @announce='polite' /></template>);
    assert.strictEqual(q('.pretui-odo-sr').getAttribute('aria-live'), 'polite');
  });

  test('Odometer rests every digit in place on first render — nothing rolls on arrival', async function (assert) {
    await render(<template><Odometer @value={{482}} @locale='en-US' /></template>);
    assert.deepEqual(
      all('.pretui-odo-ring').map((r) =>
        (r.getAttribute('style') ?? '').replace(/; --pretui-odo-i: \d+/, ''),
      ),
      Array(3).fill('--pretui-odo-start: 0; --pretui-odo-rest: 0'),
      'every ring starts where it rests — no digit travels on arrival',
    );
    assert.deepEqual(
      all('.pretui-odo-ring').map((r) => r.children.length),
      [1, 1, 1],
    );
  });

  test('Odometer rolls only the digits that changed, each by the shortest path', async function (assert) {
    class State {
      @tracked value = 482;
    }
    let state = new State();
    await render(<template><Odometer @value={{state.value}} @locale='en-US' /></template>);

    state.value = 489;
    await settled();

    let rings = all('.pretui-odo-ring');
    assert.deepEqual(
      rings.map((r) => Array.from(r.children).map((c) => c.textContent).join('')),
      ['4', '8', '9012'],
      'the unchanged 4 and 8 stay single cells; 2→9 is three back, not seven forward',
    );
    assert.true(
      rings[2]?.getAttribute('style')?.startsWith('--pretui-odo-start: 3; --pretui-odo-rest: 0'),
      'entering at the bottom of the slice and riding down is the backward roll',
    );
  });

  test('Odometer staggers from the units digit so a carry cascades', async function (assert) {
    await render(<template><Odometer @value={{482}} @locale='en-US' /></template>);
    assert.deepEqual(
      all('.pretui-odo-ring').map((r) => /--pretui-odo-i: (\d+)/.exec(r.getAttribute('style') ?? '')?.[1]),
      ['2', '1', '0'],
      'the rightmost digit leads',
    );
  });

  test('Odometer can stagger from the left instead', async function (assert) {
    await render(<template><Odometer @value={{482}} @staggerFrom='left' @locale='en-US' /></template>);
    assert.deepEqual(
      all('.pretui-odo-ring').map((r) => /--pretui-odo-i: (\d+)/.exec(r.getAttribute('style') ?? '')?.[1]),
      ['0', '1', '2'],
    );
  });

  test('Odometer publishes its timing as custom properties, with no timer of its own', async function (assert) {
    await render(<template><Odometer @value={{5}} @duration={{1.25}} @stagger={{0}} @cellHeight='2em' /></template>);
    let style = q('[data-test-pretui-odometer]').getAttribute('style') ?? '';
    assert.true(style.includes('--pretui-odo-duration: 1.250s'));
    assert.true(style.includes('--pretui-odo-stagger: 0.000s'));
    assert.true(style.includes('--pretui-odo-cell: 2em'));
  });

  test('Odometer refuses an @ease that carries its own declaration', async function (assert) {
    const EVIL = 'ease; background: url(javascript:0)';
    await render(<template><Odometer @value={{5}} @ease={{EVIL}} /></template>);
    let style = q('[data-test-pretui-odometer]').getAttribute('style') ?? '';
    assert.notOk(style.includes('javascript'), 'the injected declaration never reaches the DOM');
    assert.notOk(style.includes('--pretui-odo-ease'), 'and the rejected value falls back to the stylesheet');
  });

  test('Odometer takes a pre-formatted string verbatim and still rolls it', async function (assert) {
    await render(<template><Odometer @value='$12,480' /></template>);
    assert.strictEqual(q('.pretui-odo-sr').textContent?.trim(), '$12,480');
    assert.deepEqual(
      all('.pretui-odo-char').map((c) => c.textContent),
      ['$', ','],
      'the currency mark and separator are static; the digits roll',
    );
  });

  test('Odometer marks a missing value empty and prints the placeholder', async function (assert) {
    await render(<template><Odometer @placeholder='no data' /></template>);
    assert.strictEqual(q('[data-test-pretui-odometer]').dataset['empty'], 'true');
    assert.strictEqual(q('.pretui-odo-sr').textContent?.trim(), 'no data');
    assert.strictEqual(all('.pretui-odo-digit').length, 0, 'a placeholder has no digits to roll');
  });

  test('Odometer reads the before and after blocks around the value', async function (assert) {
    await render(
      <template>
        <Odometer @value={{9}}>
          <:before><span data-test-before>≈</span></:before>
          <:after><span data-test-after>kg</span></:after>
        </Odometer>
      </template>,
    );
    let root = q('[data-test-pretui-odometer]');
    assert.strictEqual(root.firstElementChild?.getAttribute('data-test-before'), '');
    assert.strictEqual(root.lastElementChild?.getAttribute('data-test-after'), '');
  });
});
