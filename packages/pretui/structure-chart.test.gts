// Pretui — runtime proof for structure-chart.gts.
//
// This file exists because of one specific hole in the gate chain: a Plot
// call that throws inside an ember-modifier is INVISIBLE to `boxel parse`,
// `boxel lint` and `boxel realm indexing-errors` — indexing-errors is a
// module-evaluation gate, not a render gate. Only a browser render proves
// that a chart draws. So every one of the fourteen marks is rendered here and
// asserted to have produced a real <svg>, with no error node.
//
// Local-only test file; run with `boxel test` from this directory — do NOT
// push it to the realm (a pushed *.test.gts opts the realm into a QUnit
// gate for every agent).
import { module, test } from 'qunit';
import { render, click, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { BarList } from './components/bar-list';
import { Chart } from './components/chart';
import type { BarListItem } from './components/bar-list';

interface Point {
  month: Date;
  supplier: string;
  chests: number;
}

const SUPPLIERS = ['Ashcombe', 'Beaumont', 'Carrow'];

const POINTS: Point[] = (() => {
  let out: Point[] = [];
  for (let s = 0; s < SUPPLIERS.length; s++) {
    for (let m = 0; m < 12; m++) {
      out.push({
        month: new Date(Date.UTC(2026, m, 1)),
        supplier: SUPPLIERS[s] as string,
        chests: 90 + s * 30 + m * 6,
      });
    }
  }
  return out;
})();

interface Grade {
  grade: string;
  chests: number;
}
const GRADES: Grade[] = [
  { grade: 'Gyokuro', chests: 240 },
  { grade: 'Sencha', chests: 180 },
  { grade: 'Da Hong Pao', chests: 96 },
  { grade: 'Silver Needle', chests: 61 },
];

interface Cell {
  place: string;
  day: string;
  lots: number;
}
const CELLS: Cell[] = (() => {
  let out: Cell[] = [];
  let places = ['Bristol', 'Leith', 'Cork'];
  let days = ['Mon', 'Tue', 'Wed'];
  for (let p = 0; p < places.length; p++) {
    for (let d = 0; d < days.length; d++) {
      out.push({
        place: places[p] as string,
        day: days[d] as string,
        lots: p * 7 + d * 3,
      });
    }
  }
  return out;
})();

interface IntervalRow {
  name: string;
  start: number;
  end: number;
  low: number;
  high: number;
  series: string;
}
const INTERVALS: IntervalRow[] = [
  { name: 'Controls', start: 12, end: 38, low: 55, high: 72, series: 'A' },
  { name: 'Reading', start: 20, end: 44, low: 61, high: 81, series: 'B' },
  { name: 'Structure', start: 29, end: 57, low: 58, high: 79, series: 'A' },
  { name: 'Motion', start: 35, end: 64, low: 66, high: 88, series: 'B' },
];

function plotHost(): HTMLElement {
  return document.querySelector(
    '[data-test-pretui-chart-plot]',
  ) as HTMLElement;
}
function svgCount(): number {
  return plotHost().querySelectorAll('svg').length;
}
function errorNode(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-chart-error]');
}
function tableRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll('[data-test-pretui-chart-table] tbody tr'),
  ) as HTMLElement[];
}

module('Pretui | Chart', function (hooks) {
  setupCardTest(hooks);

  test('line: draws a real svg, no error node, and a text alternative', async function (assert) {
    await render(<template>
      <Chart
        @rows={{POINTS}}
        @mark='line'
        @x='month'
        @y='chests'
        @series='supplier'
        @xLabel='Month'
        @yLabel='Chests'
        @label='Chests landed'
      />
    </template>);
    assert.strictEqual(errorNode(), null, 'plot() did not throw');
    assert.strictEqual(svgCount(), 1, 'exactly one svg');
    let host = plotHost();
    assert.strictEqual(host.getAttribute('role'), 'img', 'role=img');
    let name = host.getAttribute('aria-label') ?? '';
    assert.ok(name.includes('Line chart'), 'summary names the mark: ' + name);
    assert.ok(name.includes('36 data points'), 'summary counts points');
    assert.ok(name.includes('Ashcombe'), 'summary names the series');
    assert.strictEqual(tableRows().length, 36, 'every row reaches the table');
  });

  test('every mark in the vocabulary renders', async function (assert) {
    // The one assertion the other gates cannot make. A mark that throws
    // shows up here and nowhere else.
    await render(<template>
      <Chart @rows={{POINTS}} @mark='area' @x='month' @y='chests' @series='supplier' />
    </template>);
    assert.strictEqual(errorNode(), null, 'area');
    assert.strictEqual(svgCount(), 1, 'area svg');

    await render(<template>
      <Chart @rows={{GRADES}} @mark='bar' @x='grade' @y='chests' />
    </template>);
    assert.strictEqual(errorNode(), null, 'bar');
    assert.strictEqual(svgCount(), 1, 'bar svg');

    await render(<template>
      <Chart @rows={{GRADES}} @mark='bar-h' @x='chests' @y='grade' />
    </template>);
    assert.strictEqual(errorNode(), null, 'bar-h');
    assert.strictEqual(svgCount(), 1, 'bar-h svg');

    await render(<template>
      <Chart @rows={{POINTS}} @mark='scatter' @x='chests' @y='chests' @series='supplier' />
    </template>);
    assert.strictEqual(errorNode(), null, 'scatter');
    assert.strictEqual(svgCount(), 1, 'scatter svg');

    await render(<template>
      <Chart @rows={{POINTS}} @mark='histogram' @x='chests' />
    </template>);
    assert.strictEqual(errorNode(), null, 'histogram');
    assert.strictEqual(svgCount(), 1, 'histogram svg');

    await render(<template>
      <Chart @rows={{CELLS}} @mark='heatmap' @x='day' @y='place' @value='lots' />
    </template>);
    assert.strictEqual(errorNode(), null, 'heatmap');
    assert.strictEqual(svgCount(), 1, 'heatmap svg');

    await render(<template>
      <Chart @rows={{GRADES}} @mark='waffle' @x='grade' @y='chests' />
    </template>);
    assert.strictEqual(errorNode(), null, 'waffle');
    assert.strictEqual(svgCount(), 1, 'waffle svg');

    await render(<template>
      <Chart @rows={{INTERVALS}} @mark='connected' @x='start' @y='end' @series='series' />
    </template>);
    assert.strictEqual(
      errorNode(),
      null,
      'connected: ' + (errorNode()?.textContent ?? 'no error text'),
    );
    assert.strictEqual(svgCount(), 1, 'connected svg');

    await render(<template>
      <Chart @rows={{INTERVALS}} @mark='bubble' @x='start' @y='end' @value='high' @series='series' />
    </template>);
    assert.strictEqual(errorNode(), null, 'bubble');
    assert.strictEqual(svgCount(), 1, 'bubble svg');

    await render(<template>
      <Chart @rows={{INTERVALS}} @mark='band' @x='start' @y='low' @value='high' />
    </template>);
    assert.strictEqual(errorNode(), null, 'band');
    assert.strictEqual(svgCount(), 1, 'band svg');

    await render(<template>
      <Chart @rows={{INTERVALS}} @mark='timeline' @x='start' @value='end' @y='name' @series='series' />
    </template>);
    assert.strictEqual(errorNode(), null, 'timeline');
    assert.strictEqual(svgCount(), 1, 'timeline svg');

    await render(<template>
      <Chart @rows={{INTERVALS}} @mark='waterfall' @x='name' @y='start' @value='end' @series='series' />
    </template>);
    assert.strictEqual(errorNode(), null, 'waterfall');
    assert.strictEqual(svgCount(), 1, 'waterfall svg');

    await render(<template>
      <Chart @rows={{INTERVALS}} @mark='dumbbell' @x='start' @value='end' @y='name' />
    </template>);
    assert.strictEqual(errorNode(), null, 'dumbbell');
    assert.strictEqual(svgCount(), 1, 'dumbbell svg');
  });

  test('no raw hex colour reaches the svg — every colour is a token', async function (assert) {
    await render(<template>
      <Chart @rows={{POINTS}} @mark='line' @x='month' @y='chests' @series='supplier' />
    </template>);
    let svg = plotHost().querySelector('svg') as SVGElement;
    let markup = svg.outerHTML;
    // The fallbacks inside var(--chart-1, #10b981) are legitimate; a bare
    // hex NOT preceded by a comma-space inside var()/color-mix() is not.
    let bare = markup.replace(/var\([^)]*\)/g, '').replace(/color-mix\([^)]*\)/g, '');
    assert.notOk(/#[0-9a-fA-F]{6}/.test(bare), 'no hex outside token fallbacks');
    assert.ok(markup.includes('var(--chart-1'), 'series colour is a token');
  });

  test('muting a series from the legend updates plot, summary and table', async function (assert) {
    await render(<template>
      <Chart
        @rows={{POINTS}}
        @mark='line'
        @x='month'
        @y='chests'
        @series='supplier'
        @label='Chests landed'
      />
    </template>);
    assert.strictEqual(tableRows().length, 36, 'all three series listed');
    let key = document.querySelector(
      '[data-test-pretui-chart-key="Ashcombe"]',
    ) as HTMLElement;
    assert.strictEqual(key.getAttribute('aria-pressed'), 'true', 'starts on');
    await click(key);
    assert.strictEqual(key.getAttribute('aria-pressed'), 'false', 'toggles off');
    assert.strictEqual(tableRows().length, 24, 'table drops the muted series');
    let name = plotHost().getAttribute('aria-label') ?? '';
    assert.notOk(name.includes('Ashcombe'), 'summary drops it too: ' + name);
    assert.strictEqual(errorNode(), null, 'redraw did not throw');
    assert.strictEqual(svgCount(), 1, 'still exactly one svg after redraw');
  });

  test('a spec Plot rejects surfaces as a visible error, not a blank box', async function (assert) {
    // An unknown CURVE is the cheapest genuine throw: Plot validates the
    // curve name and raises. (An unknown CHANNEL name does not throw —
    // Plot reads `undefined` and draws an empty frame, which is why the
    // channel types are `keyof T` at the component boundary instead.)
    await render(<template>
      <Chart
        @rows={{POINTS}}
        @mark='line'
        @x='month'
        @y='chests'
        @curve='not-a-real-curve'
      />
    </template>);
    await settled();
    let node = errorNode();
    assert.ok(node, 'an error line was rendered');
    assert.ok(
      (node?.textContent ?? '').includes('could not be drawn'),
      'and it says so in words',
    );
    assert.strictEqual(svgCount(), 0, 'and no half-drawn svg is left behind');
  });

  test('empty rows land on the shared EmptyState, not an empty svg', async function (assert) {
    const NONE: Point[] = [];
    await render(<template>
      <Chart @rows={{NONE}} @mark='line' @x='month' @y='chests' />
    </template>);
    assert.strictEqual(
      document.querySelector('[data-test-pretui-data]')?.getAttribute('data-status'),
      'empty',
      'DataComponent status is empty',
    );
    assert.strictEqual(
      document.querySelector('[data-test-pretui-chart-plot]'),
      null,
      'no plot host at all',
    );
  });
});

module('Pretui | BarList', function (hooks) {
  setupCardTest(hooks);

  const ROWS: BarListItem[] = [
    { name: 'Direct', value: 940 },
    { name: 'Catalog search', value: 612 },
    { name: 'Shared link', value: 208 },
    { name: 'Realm index', value: 77 },
  ];

  test('ranks descending, prints the value as text, caps at @limit', async function (assert) {
    await render(<template>
      <BarList @rows={{ROWS}} @limit={{3}} @label='Traffic by source' />
    </template>);
    let items = Array.from(
      document.querySelectorAll('.pretui-barlist-row'),
    ) as HTMLElement[];
    assert.strictEqual(items.length, 3, 'limit honoured');
    assert.ok(
      (items[0]?.textContent ?? '').includes('Direct'),
      'largest first',
    );
    assert.ok((items[0]?.textContent ?? '').includes('940'), 'value as text');
    let bar = items[1]?.querySelector('.pretui-barlist-bar') as HTMLElement;
    assert.strictEqual(
      bar.getAttribute('aria-hidden'),
      'true',
      'the bar is decoration; the number already said it',
    );
    let list = document.querySelector('.pretui-barlist-rows') as HTMLElement;
    assert.strictEqual(list.tagName, 'OL', 'the ranking is in the markup');
  });

  test('a hostile hue never reaches the style attribute', async function (assert) {
    const NASTY: BarListItem[] = [
      { name: 'Direct', value: 10, hue: 'red; background: url(https://evil/x)' },
    ];
    await render(<template><BarList @rows={{NASTY}} /></template>);
    let row = document.querySelector('.pretui-barlist-row') as HTMLElement;
    let style = row.getAttribute('style') ?? '';
    assert.notOk(style.includes('url('), 'the injection was dropped whole');
    assert.ok(style.includes('--pretui-barlist-fill'), 'the safe part survives');
  });
});
