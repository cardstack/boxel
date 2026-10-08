// ProgressBar unit tests. No assertion reads a computed style: the host test
// harness stamps the scoped-css attribute and delivers no stylesheet. What is
// promised is the `progressbar` element's name and value attributes, and the
// inline width and custom property the stylesheet then paints from, so those
// are read off the attributes directly.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ProgressBar } from './progress-bar';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function px(el: HTMLElement, prop: string): string | undefined {
  return (el.getAttribute('style') ?? '')
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${prop}:`))
    ?.slice(prop.length + 1)
    .trim();
}
function bar(sel = '[role="progressbar"]'): HTMLElement {
  return q(sel);
}
// The accessible name by the accname precedence that applies to these bars:
// `aria-labelledby` first (the referenced elements' text), then `aria-label`.
function accessibleName(el: HTMLElement): string | undefined {
  let ids = el.getAttribute('aria-labelledby')?.trim();
  if (ids) {
    return ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
  }
  return el.getAttribute('aria-label') ?? undefined;
}

module('Pretui | components/progress-bar', function (hooks) {
  setupCardTest(hooks);

  test('defaults to a percentage of 100 and reports the full range to assistive tech', async function (assert) {
    await render(<template><ProgressBar @value={{40}} /></template>);
    let el = bar();
    assert.strictEqual(
      el,
      q('[data-test-pretui-progress]'),
      'the root is the progressbar, so attributes passed to it land on the widget',
    );
    assert.strictEqual(el.getAttribute('aria-valuemin'), '0');
    assert.strictEqual(el.getAttribute('aria-valuenow'), '40');
    assert.strictEqual(el.getAttribute('aria-valuemax'), '100');
    assert.false(el.hasAttribute('aria-valuetext'), 'with no words for the value, assistive tech derives a percentage');
    assert.strictEqual(px(q('.pretui-progress-fill'), 'width'), '40%');
    assert.notOk(q('.pretui-progress-head'), 'no header without a label or count');
  });

  test('an unnamed bar is named "Progress", and every caller-supplied name wins over it', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{40}} data-test-bare />
        <ProgressBar @value={{40}} @label='Upload' data-test-label />
        <ProgressBar @value={{40}} aria-label='Time left before the SLA breaches' data-test-aria-label />
        <span id='quota-heading'>Storage quota</span>
        <ProgressBar @value={{40}} aria-labelledby='quota-heading' data-test-aria-labelledby />
      </template>,
    );
    assert.strictEqual(
      accessibleName(bar('[data-test-bare]')),
      'Progress',
      'a progressbar must have a name, so a bare bar gets the generic one boxel-ui gives it',
    );
    assert.notOk(q('[data-test-bare] .pretui-progress-head'), 'the fallback name adds no visible header');
    assert.strictEqual(accessibleName(bar('[data-test-label]')), 'Upload', '@label replaces the fallback');
    assert.strictEqual(
      bar('[data-test-aria-label]').getAttribute('aria-label'),
      'Time left before the SLA breaches',
      "a caller's aria-label replaces the fallback",
    );
    assert.strictEqual(
      accessibleName(bar('[data-test-aria-labelledby]')),
      'Storage quota',
      "a caller's aria-labelledby names the bar, ahead of the fallback aria-label",
    );
  });

  test('@label names the progressbar and the visible header is not announced twice', async function (assert) {
    await render(<template><ProgressBar @value={{60}} @label='Upload' /></template>);
    let el = bar();
    assert.strictEqual(el.getAttribute('aria-label'), 'Upload');
    let head = q('.pretui-progress-head');
    assert.strictEqual(head.textContent?.replace(/\s+/g, ' ').trim(), 'Upload 60%', 'the header still shows');
    assert.strictEqual(
      head.getAttribute('aria-hidden'),
      'true',
      'the name and value already carry what the header says',
    );
  });

  test('aria-label and aria-labelledby passed as attributes name the progressbar itself', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{3}} aria-label='Time left before the SLA breaches' data-test-hidden-name />
        <ProgressBar @value={{3}} @label='Gates' aria-label='Approval gates passed' data-test-override />
        <span id='quota-heading'>Storage quota</span>
        <ProgressBar @value={{3}} aria-labelledby='quota-heading' data-test-labelledby />
      </template>,
    );
    let hidden = bar('[data-test-hidden-name]');
    assert.strictEqual(hidden.getAttribute('role'), 'progressbar');
    assert.strictEqual(
      hidden.getAttribute('aria-label'),
      'Time left before the SLA breaches',
      'a name with no visible header',
    );
    assert.notOk(hidden.querySelector('.pretui-progress-head'), 'naming it does not add the header');
    assert.strictEqual(
      bar('[data-test-override]').getAttribute('aria-label'),
      'Approval gates passed',
      "the caller's aria-label wins over @label",
    );
    let labelled = bar('[data-test-labelledby]');
    assert.strictEqual(labelled.getAttribute('role'), 'progressbar');
    assert.strictEqual(labelled.getAttribute('aria-labelledby'), 'quota-heading');
  });

  test('aria-valuetext takes @valueText, then the visible @count in stepped mode only', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{3}} @max={{6}} @count='3 / 6' data-test-count />
        <ProgressBar @value={{300}} @max={{1200}} @count='300 files' data-test-continuous-count />
        <ProgressBar
          @value={{300}}
          @max={{1200}}
          @count='300 files'
          @valueText='300 of 1,200 files'
          data-test-continuous-value-text
        />
        <ProgressBar
          @value={{6}}
          @max={{6}}
          @count='6 / 6'
          @valueText='Run ended early after 6 of 6 retries'
          data-test-value-text
        />
      </template>,
    );
    assert.strictEqual(
      bar('[data-test-count]').getAttribute('aria-valuetext'),
      '3 / 6',
      'a stepped count is already the human reading of the value, total included',
    );
    assert.false(
      bar('[data-test-continuous-count]').hasAttribute('aria-valuetext'),
      'a continuous count can omit the total, so assistive tech keeps deriving a percentage',
    );
    assert.strictEqual(
      bar('[data-test-continuous-value-text]').getAttribute('aria-valuetext'),
      '300 of 1,200 files',
      'a continuous bar announces @valueText when one is given',
    );
    assert.strictEqual(
      bar('[data-test-value-text]').getAttribute('aria-valuetext'),
      'Run ended early after 6 of 6 retries',
      '@valueText replaces it when the count alone would mislead',
    );
    assert.strictEqual(
      q('[data-test-value-text] .pretui-progress-count').textContent?.trim(),
      '6 / 6',
      '@valueText changes what is announced, not what is shown',
    );
  });

  test('@hue sets the fill knob on the root, and an unsafe value is dropped', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{80}} @hue='var(--warning)' data-test-warning />
        <ProgressBar @value={{2}} @max={{4}} @steps={{true}} @hue='var(--destructive)' data-test-stepped />
        <ProgressBar @value={{80}} @hue='red; width: 0' data-test-unsafe />
        <ProgressBar @value={{80}} data-test-default />
      </template>,
    );
    assert.strictEqual(px(bar('[data-test-warning]'), '--pretui-progress-hue'), 'var(--warning)');
    assert.strictEqual(
      px(bar('[data-test-stepped]'), '--pretui-progress-hue'),
      'var(--destructive)',
      'the knob is written on the root in stepped mode too',
    );
    assert.false(
      bar('[data-test-unsafe]').hasAttribute('style'),
      'a value carrying its own declarations never reaches the style attribute',
    );
    assert.false(
      bar('[data-test-default]').hasAttribute('style'),
      'without @hue nothing is written, so a --pretui-progress-hue set on an ancestor still reaches the fill',
    );
  });

  test('clamps out-of-range values instead of overflowing its track', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{-20}} @label='Under' />
        <ProgressBar @value={{180}} @label='Over' />
      </template>,
    );
    assert.deepEqual(
      all('.pretui-progress-fill').map((f) => px(f, 'width')),
      ['0%', '100%'],
      'the fill never leaves 0–100',
    );
    assert.deepEqual(
      all('.pretui-progress-count').map((c) => c.textContent?.trim()),
      ['0%', '100%'],
      'the visible readout is clamped with the fill',
    );
    assert.deepEqual(
      all('[role="progressbar"]').map((b) => b.getAttribute('aria-valuenow')),
      ['0', '100'],
      'the announced value is clamped with the fill, so it stays inside aria-valuemin..aria-valuemax',
    );
  });

  test('clamps the announced value and the lit steps to @max in stepped mode', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{9}} @max={{4}} @steps={{true}} data-test-over />
        <ProgressBar @value={{-1}} @max={{4}} @steps={{true}} data-test-under />
      </template>,
    );
    assert.strictEqual(bar('[data-test-over]').getAttribute('aria-valuenow'), '4');
    assert.deepEqual(
      all('[data-test-over] .pretui-progress-step').map((s) => s.dataset['on']),
      ['true', 'true', 'true', 'true'],
    );
    assert.strictEqual(bar('[data-test-under]').getAttribute('aria-valuenow'), '0');
    assert.deepEqual(
      all('[data-test-under] .pretui-progress-step').map((s) => s.dataset['on']),
      [undefined, undefined, undefined, undefined],
    );
  });

  test('rounds a fractional value up to the lit steps in stepped mode, and keeps it exact on a continuous bar', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{2.5}} @max={{6}} @steps={{true}} @label='Gates' data-test-stepped />
        <ProgressBar @value={{2.5}} @max={{6}} @count='2.5 / 6' data-test-counted />
        <ProgressBar @value={{2.5}} @max={{6}} @label='Gates' data-test-continuous />
      </template>,
    );
    let stepped = bar('[data-test-stepped]');
    assert.strictEqual(stepped.getAttribute('aria-valuenow'), '3', 'announced as the number of lit steps');
    assert.deepEqual(
      all('[data-test-stepped] .pretui-progress-step').map((s) => s.dataset['on']),
      ['true', 'true', 'true', undefined, undefined, undefined],
      'the partly reached third step is lit',
    );
    assert.strictEqual(
      stepped.querySelector('.pretui-progress-count')?.textContent?.trim(),
      '50%',
      'the visible percentage reads the lit steps too',
    );
    assert.notOk(stepped.hasAttribute('aria-valuetext'), 'with no @count or @valueText there is no valuetext');

    let counted = bar('[data-test-counted]');
    assert.strictEqual(counted.getAttribute('aria-valuenow'), '3', 'a count does not change the announced number');
    assert.strictEqual(counted.getAttribute('aria-valuetext'), '2.5 / 6', 'the caller\'s count is still the valuetext');
    assert.strictEqual(counted.querySelector('.pretui-progress-count')?.textContent?.trim(), '2.5 / 6');

    let continuous = bar('[data-test-continuous]');
    assert.strictEqual(continuous.getAttribute('aria-valuenow'), '2.5', 'a continuous bar announces the exact value');
    let fill = continuous.querySelector('.pretui-progress-fill') as HTMLElement;
    assert.ok(px(fill, 'width')?.startsWith('41.66'), 'and its fill paints that value, unrounded');
  });

  test('a zero @max is an empty range: a positive value does not fill the bar, and 0 / 0 is 0%, not NaN%', async function (assert) {
    await render(
      <template>
        <ProgressBar @value={{5}} @max={{0}} @label='Nothing to do' data-test-positive />
        <ProgressBar @value={{0}} @max={{0}} @label='Nothing to do' data-test-zero />
      </template>,
    );
    for (let sel of ['[data-test-positive]', '[data-test-zero]']) {
      let el = bar(sel);
      assert.strictEqual(el.getAttribute('aria-valuenow'), '0', `${sel}: the value is clamped into the empty range`);
      assert.strictEqual(el.getAttribute('aria-valuemax'), '0', `${sel}: the range is empty`);
      let fill = el.querySelector('.pretui-progress-fill') as HTMLElement;
      assert.strictEqual(px(fill, 'width'), '0%', `${sel}: the fill is empty, neither full nor NaN%`);
      assert.strictEqual(px(fill, 'min-width'), '0', `${sel}: an empty fill has no minimum`);
      assert.strictEqual(
        el.querySelector('.pretui-progress-count')?.textContent?.trim(),
        '0%',
        `${sel}: the visible readout is 0%`,
      );
    }
  });

  test('reads an unset or non-finite @value as 0, so nothing announces or paints NaN', async function (assert) {
    // The signature requires a number, but an unset model property or a failed
    // computation still reaches the component at runtime.
    const UNSET = undefined as unknown as number;
    const NOT_A_NUMBER = Number.NaN;
    await render(
      <template>
        <ProgressBar @value={{UNSET}} @label='Unset' data-test-unset />
        <ProgressBar @value={{NOT_A_NUMBER}} @label='NaN' data-test-nan />
      </template>,
    );
    for (let sel of ['[data-test-unset]', '[data-test-nan]']) {
      let el = bar(sel);
      assert.strictEqual(el.getAttribute('aria-valuenow'), '0', `${sel}: announced as the min`);
      let fill = el.querySelector('.pretui-progress-fill') as HTMLElement;
      assert.strictEqual(px(fill, 'width'), '0%', `${sel}: the fill is empty, not a dropped NaN% width that paints full`);
      assert.strictEqual(
        el.querySelector('.pretui-progress-count')?.textContent?.trim(),
        '0%',
        `${sel}: the visible readout is 0%`,
      );
    }
  });

  test('reads a negative or non-finite @max as an empty range, so aria-valuemax never drops below aria-valuemin', async function (assert) {
    const NOT_A_NUMBER = Number.NaN;
    await render(
      <template>
        <ProgressBar @value={{3}} @max={{-5}} @label='Negative' data-test-negative />
        <ProgressBar @value={{3}} @max={{NOT_A_NUMBER}} @label='NaN' data-test-nan />
      </template>,
    );
    for (let sel of ['[data-test-negative]', '[data-test-nan]']) {
      let el = bar(sel);
      assert.strictEqual(el.getAttribute('aria-valuemax'), '0', `${sel}: the range is empty`);
      assert.strictEqual(el.getAttribute('aria-valuenow'), '0', `${sel}: the value is clamped into it`);
      let fill = el.querySelector('.pretui-progress-fill') as HTMLElement;
      assert.strictEqual(px(fill, 'width'), '0%', `${sel}: the fill is empty`);
    }
  });

  test('stays continuous for a small total when no @count is given', async function (assert) {
    await render(<template><ProgressBar @value={{3}} @max={{6}} /></template>);
    assert.ok(q('.pretui-progress'), 'the count is what opts a small total into steps');
    assert.notOk(q('.pretui-progress-steps'));
  });

  test('gives a zero-width fill no minimum, so an empty bar reads as empty', async function (assert) {
    await render(<template><ProgressBar @value={{0}} /></template>);
    assert.strictEqual(px(q('.pretui-progress-fill'), 'min-width'), '0');
  });

  test('switches to steps for a small discrete total with a count', async function (assert) {
    await render(<template><ProgressBar @value={{3}} @max={{6}} @count='3 / 6' @label='Gates' /></template>);
    let steps = all('.pretui-progress-step');
    assert.strictEqual(steps.length, 6, 'one step per unit of @max');
    assert.deepEqual(
      steps.map((s) => s.dataset['on']),
      ['true', 'true', 'true', undefined, undefined, undefined],
    );
    let el = bar();
    assert.strictEqual(el.getAttribute('aria-valuemin'), '0');
    assert.strictEqual(el.getAttribute('aria-valuemax'), '6');
    assert.strictEqual(el.getAttribute('aria-label'), 'Gates');
    assert.strictEqual(q('.pretui-progress-count').textContent?.trim(), '3 / 6', '@count replaces the percentage');
    assert.notOk(q('.pretui-progress'), 'the continuous track is not also rendered');
  });

  test('stays continuous for a large total even with a count', async function (assert) {
    await render(<template><ProgressBar @value={{300}} @max={{1200}} @count='300 files' /></template>);
    assert.notOk(q('.pretui-progress-steps'), '1,200 steps would be nonsense');
    assert.ok(q('.pretui-progress'));
  });

  test('honours an explicit @steps against the count heuristic', async function (assert) {
    await render(<template><ProgressBar @value={{1}} @max={{4}} @steps={{true}} /></template>);
    assert.strictEqual(all('.pretui-progress-step').length, 4, 'stepped without a count');
  });
});
