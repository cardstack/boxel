// Pretui — Sparkline unit tests: an image named by its label and summary,
// shapes for each kind, and the degenerate series.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Sparkline } from './sparkline';

const WEEKS = [12, 18, 8, 22, 31, 30];
const ONE = [5];
const NONE: number[] = [];
const NOISY = [3, Number.NaN, 7];
const SIGNED = [-5, 5];
const NEG = [-10, -2];
const FLAT = [5, 5, 5];
const FLOATS = [0.1 + 0.2, 1234567.891];

function svg(sel = ''): SVGSVGElement {
  return document.querySelector(`${sel} [data-test-pretui-sparkline]`) as SVGSVGElement;
}

module('Pretui | components/sparkline', function (hooks) {
  setupCardTest(hooks);

  test('it is an image named by the label and a spoken summary', async function (assert) {
    await render(<template><Sparkline @values={{WEEKS}} @label='Orders, last 6 weeks' data-metric='orders' /></template>);
    assert.strictEqual(svg().getAttribute('role'), 'img');
    assert.strictEqual(svg().getAttribute('aria-label'), 'Orders, last 6 weeks: from 12 to 30, low 8, high 31');
    assert.strictEqual(svg().getAttribute('data-metric'), 'orders');
    assert.strictEqual(svg().getAttribute('width'), '96');
    assert.strictEqual(svg().getAttribute('height'), '24');
  });

  test('line draws one path through every point; area adds a fill', async function (assert) {
    await render(<template>
      <div class='t-a'><Sparkline @values={{WEEKS}} @label='A' /></div>
      <div class='t-b'><Sparkline @values={{WEEKS}} @label='B' @kind='area' @showLast={{true}} /></div>
    </template>);
    let line = svg('.t-a').querySelector('.pretui-sparkline-line')?.getAttribute('d') ?? '';
    assert.strictEqual((line.match(/[ML]/g) ?? []).length, WEEKS.length, 'one segment per value');
    assert.ok(svg('.t-b').querySelector('.pretui-sparkline-area'), 'area fill');
    assert.ok(svg('.t-b').querySelector('.pretui-sparkline-dot'), 'last point marked');
  });

  test('bar draws one bar per value, the tallest for the largest', async function (assert) {
    await render(<template><Sparkline @values={{WEEKS}} @label='B' @kind='bar' /></template>);
    let bars = [...svg().querySelectorAll('.pretui-sparkline-bar')] as SVGRectElement[];
    assert.strictEqual(bars.length, WEEKS.length);
    let heights = bars.map((b) => Number(b.getAttribute('height')));
    assert.strictEqual(heights.indexOf(Math.max(...heights)), WEEKS.indexOf(31));
  });

  test('one value draws a flat line; none says no data; non-numbers are dropped', async function (assert) {
    await render(<template>
      <div class='t-one'><Sparkline @values={{ONE}} @label='One' /></div>
      <div class='t-none'><Sparkline @values={{NONE}} @label='None' /></div>
      <div class='t-noisy'><Sparkline @values={{NOISY}} @label='Noisy' /></div>
    </template>);
    assert.ok(svg('.t-one').querySelector('.pretui-sparkline-line'));
    assert.strictEqual(svg('.t-none').getAttribute('aria-label'), 'None: no data');
    assert.notOk(svg('.t-none').querySelector('path'));
    assert.strictEqual(svg('.t-noisy').getAttribute('aria-label'), 'Noisy: from 3 to 7, low 3, high 7');
  });

  test('bars stand on zero: signed values go up and down by their size, and equal values draw equal bars', async function (assert) {
    await render(<template>
      <div class='t-s'><Sparkline @values={{SIGNED}} @label='S' @kind='bar' /></div>
      <div class='t-n'><Sparkline @values={{NEG}} @label='N' @kind='bar' /></div>
      <div class='t-f'><Sparkline @values={{FLAT}} @label='F' @kind='bar' /></div>
    </template>);
    let heights = (sel: string) =>
      [...svg(sel).querySelectorAll('.pretui-sparkline-bar')].map((b) => Number(b.getAttribute('height')));
    let tops = (sel: string) =>
      [...svg(sel).querySelectorAll('.pretui-sparkline-bar')].map((b) => Number(b.getAttribute('y')));
    let [neg, pos] = heights('.t-s');
    assert.ok(Math.abs((neg as number) - (pos as number)) <= 1, '-5 and 5 are the same length');
    let [negTop, posTop] = tops('.t-s');
    assert.ok((negTop as number) > (posTop as number), 'the negative bar hangs below the positive one');
    let [big, small] = heights('.t-n');
    assert.ok((big as number) > (small as number), '-10 is longer than -2');
    let flat = heights('.t-f');
    assert.ok(flat.every((h) => h === flat[0] && h > 1), 'equal values, equal full bars');
  });

  test('the summary formats its numbers', async function (assert) {
    await render(<template><Sparkline @values={{FLOATS}} @label='F' /></template>);
    let label = svg().getAttribute('aria-label') ?? '';
    assert.notOk(label.includes('0.30000000000000004'), 'no raw float noise');
    assert.ok(label.includes('0.3'), label);
  });
});
