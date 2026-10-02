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
    // KNOWN GAP, pinned rather than patched: aria-valuenow is the raw @value on
    // both ProgressBar and ProgressRadial, so assistive tech hears -20 and 180
    // against aria-valuemin=0 and aria-valuemax=100 — invalid ARIA, and it
    // disagrees with the bar a sighted user sees. A fix routes aria-valuenow
    // through the same clamp; when it lands these flip to ['0', '100'].
    assert.deepEqual(
      all('[role="progressbar"]').map((b) => b.getAttribute('aria-valuenow')),
      ['-20', '180'],
      'KNOWN GAP: the announced value is not clamped',
    );
  });

  test('stays continuous for a small total when no @count is given', async function (assert) {
    await render(<template><ProgressBar @value={{3}} @max={{6}} /></template>);
    assert.ok(q('.pretui-progress'), 'the count is what opts a small total into steps');
    assert.notOk(q('.pretui-progress-steps'));
  });

  test('gives a zero-width fill no minimum, so an empty bar reads as empty', async function (assert) {
    await render(<template><ProgressBar @value={{0}} /></template>);
    assert.strictEqual(px(q('.pretui-progress-fill'), 'min-width'), '0px');
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
