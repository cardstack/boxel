// Pretui — semantics proof for the feedback territory's status and progress
// components (Toast, ProgressBar, ProgressRadial, Spinner, BrokenLink,
// LoadingState) and the shared `resolvePixelSize` helper. Alert's own
// contract is asserted in controls.test.gts.
//
// No assertion reads a computed style: the components' own `<style scoped>` is
// inert in this harness (the scoped-css attribute is stamped, the rules are not
// applied). Progress components are the case where that matters most — what is
// actually promised is the ARIA value pair (aria-valuenow / aria-valuemax;
// neither component emits aria-valuemin) and the inline width/percentage the
// CSS then paints, so those are read off the attributes directly.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import { BrokenLink } from './components/broken-link';
import { LoadingState } from './components/loading-state';
import { ProgressBar } from './components/progress-bar';
import { ProgressRadial } from './components/progress-radial';
import { Spinner } from './components/spinner';
import { Toast } from './components/toast';
import { resolvePixelSize } from './internal/feedback';

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

module('Pretui | feedback', function (hooks) {
  setupCardTest(hooks);

  // ── resolvePixelSize ────────────────────────────────────────────────────
  test('resolvePixelSize takes a raw number, a scale name, or any alias of one', function (assert) {
    const SCALE = { xs: 1, s: 2, m: 3, l: 4, xl: 5 };
    assert.strictEqual(resolvePixelSize(17, SCALE), 17, 'a number is pixels, not a scale key');
    assert.strictEqual(resolvePixelSize('l', SCALE), 4);
    assert.strictEqual(resolvePixelSize('lg', SCALE), 4, 'the React spelling lands on the same rung');
    assert.strictEqual(resolvePixelSize('large', SCALE), 4);
    assert.strictEqual(resolvePixelSize(undefined, SCALE), 3, 'the default rung is m');
    assert.strictEqual(resolvePixelSize('nonsense', SCALE), 3, 'an unknown size falls back, never undefined');
    assert.strictEqual(resolvePixelSize(undefined, SCALE, 'xs'), 1, 'the caller can move the fallback');
  });

  // ── Toast ───────────────────────────────────────────────────────────────
  test('Toast renders a live-region title and omits the body line when there is none', async function (assert) {
    await render(<template><Toast @title='Batch published' /></template>);
    let el = q('[data-test-pretui-toast]');
    assert.strictEqual(el.getAttribute('role'), 'status', 'announced, but not as an alert');
    assert.strictEqual(el.querySelector('.pretui-toast-title')?.textContent?.trim(), 'Batch published');
    assert.notOk(el.querySelector('.pretui-toast-msg'), 'no empty second line');
    assert.notOk(el.querySelector('.pretui-toast-action'), 'no action slot when none is passed');
  });

  test('Toast accepts @description as an alias for @message', async function (assert) {
    await render(<template><Toast @title='Saved' @description='Sonner spells it this way' /></template>);
    assert.strictEqual(
      q('.pretui-toast-msg')?.textContent?.trim(),
      'Sonner spells it this way',
      'the alias reaches the same slot',
    );
  });

  test('Toast prefers @message when both spellings arrive', async function (assert) {
    await render(
      <template><Toast @title='Saved' @message='house spelling' @description='alias' /></template>,
    );
    assert.deepEqual(
      all('.pretui-toast-msg').map((e) => e.textContent?.trim()),
      ['house spelling'],
      'one line, and it is the house arg',
    );
  });

  test('Toast yields the icon block and wraps a supplied action in its own slot', async function (assert) {
    await render(
      <template>
        <Toast @title='Reverted'>
          <:icon><span data-test-icon>!</span></:icon>
          <:action><button type='button' data-test-undo>Undo</button></:action>
        </Toast>
      </template>,
    );
    assert.ok(q('[data-test-icon]'), 'the icon slot is filled');
    assert.ok(
      q('.pretui-toast-action [data-test-undo]'),
      'the action is wrapped in its own slot rather than dropped into the body',
    );
  });

  // ── ProgressBar ─────────────────────────────────────────────────────────
  test('ProgressBar defaults to a percentage of 100 and reports it to assistive tech', async function (assert) {
    await render(<template><ProgressBar @value={{40}} /></template>);
    let bar = q('.pretui-progress');
    assert.strictEqual(bar.getAttribute('role'), 'progressbar');
    assert.strictEqual(bar.getAttribute('aria-valuenow'), '40');
    assert.strictEqual(bar.getAttribute('aria-valuemax'), '100');
    assert.strictEqual(px(q('.pretui-progress-fill'), 'width'), '40%');
    assert.notOk(q('.pretui-progress-head'), 'no header without a label or count');
  });

  test('ProgressBar clamps out-of-range values instead of overflowing its track', async function (assert) {
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
    // against aria-valuemax=100 — invalid ARIA, and it disagrees with the bar
    // a sighted user sees. A fix routes aria-valuenow through the same clamp;
    // when it lands these flip to ['0', '100'].
    assert.deepEqual(
      all('[role="progressbar"]').map((b) => b.getAttribute('aria-valuenow')),
      ['-20', '180'],
      'KNOWN GAP: the announced value is not clamped',
    );
  });

  test('ProgressBar stays continuous for a small total when no @count is given', async function (assert) {
    await render(<template><ProgressBar @value={{3}} @max={{6}} /></template>);
    assert.ok(q('.pretui-progress'), 'the count is what opts a small total into steps');
    assert.notOk(q('.pretui-progress-steps'));
  });

  test('ProgressBar gives a zero-width fill no minimum, so an empty bar reads as empty', async function (assert) {
    await render(<template><ProgressBar @value={{0}} /></template>);
    assert.strictEqual(px(q('.pretui-progress-fill'), 'min-width'), '0px');
  });

  test('ProgressBar switches to steps for a small discrete total with a count', async function (assert) {
    await render(<template><ProgressBar @value={{3}} @max={{6}} @count='3 / 6' @label='Gates' /></template>);
    let steps = all('.pretui-progress-step');
    assert.strictEqual(steps.length, 6, 'one step per unit of @max');
    assert.deepEqual(
      steps.map((s) => s.dataset['on']),
      ['true', 'true', 'true', undefined, undefined, undefined],
    );
    assert.strictEqual(q('.pretui-progress-steps').getAttribute('aria-valuemax'), '6');
    assert.strictEqual(q('.pretui-progress-count').textContent?.trim(), '3 / 6', '@count replaces the percentage');
    assert.notOk(q('.pretui-progress'), 'the continuous track is not also rendered');
  });

  test('ProgressBar stays continuous for a large total even with a count', async function (assert) {
    await render(<template><ProgressBar @value={{300}} @max={{1200}} @count='300 files' /></template>);
    assert.notOk(q('.pretui-progress-steps'), '1,200 steps would be nonsense');
    assert.ok(q('.pretui-progress'));
  });

  test('ProgressBar honours an explicit @steps against the count heuristic', async function (assert) {
    await render(<template><ProgressBar @value={{1}} @max={{4}} @steps={{true}} /></template>);
    assert.strictEqual(all('.pretui-progress-step').length, 4, 'stepped without a count');
  });

  // ── ProgressRadial ──────────────────────────────────────────────────────
  test('ProgressRadial publishes its percentage as a custom property and sizes by the scale', async function (assert) {
    await render(<template><ProgressRadial @value={{25}} /></template>);
    let el = q('[data-test-pretui-radial]');
    assert.strictEqual(el.getAttribute('role'), 'progressbar');
    assert.strictEqual(el.getAttribute('aria-valuenow'), '25');
    assert.strictEqual(el.getAttribute('aria-valuemax'), '100');
    assert.strictEqual(px(el, '--pretui-radial-pct'), '25', 'the conic-gradient stop is driven from the DOM');
    assert.strictEqual(px(el, 'width'), '28px', 'the m rung');
  });

  test('ProgressRadial rescales the value against @max and clamps it', async function (assert) {
    await render(
      <template>
        <ProgressRadial @value={{3}} @max={{4}} />
        <ProgressRadial @value={{9}} @max={{4}} />
      </template>,
    );
    assert.deepEqual(
      all('[data-test-pretui-radial]').map((e) => px(e, '--pretui-radial-pct')),
      ['75', '100'],
    );
    // KNOWN GAP (same defect as ProgressBar): the announced value is raw.
    assert.deepEqual(
      all('[data-test-pretui-radial]').map((e) => e.getAttribute('aria-valuenow')),
      ['3', '9'],
      'KNOWN GAP: 9 is announced against aria-valuemax=4',
    );
  });

  test('ProgressRadial takes a pixel size as readily as a scale name', async function (assert) {
    await render(
      <template>
        <ProgressRadial @value={{50}} @size={{64}} />
        <ProgressRadial @value={{50}} @size='sm' />
      </template>,
    );
    assert.deepEqual(
      all('[data-test-pretui-radial]').map((e) => px(e, 'height')),
      ['64px', '22px'],
    );
  });

  // ── Spinner ─────────────────────────────────────────────────────────────
  test('Spinner is a labelled live region sized from the scale', async function (assert) {
    await render(<template><Spinner /></template>);
    let el = q('[data-test-pretui-spinner]');
    assert.strictEqual(el.getAttribute('role'), 'status');
    assert.strictEqual(el.getAttribute('aria-label'), 'Loading');
    assert.strictEqual(px(el, 'width'), '13px', 'the m rung');
  });

  test('Spinner lets a caller rename it through splattributes', async function (assert) {
    await render(<template><Spinner @size='xl' aria-label='Reindexing the realm' /></template>);
    let el = q('[data-test-pretui-spinner]');
    assert.strictEqual(
      el.getAttribute('aria-label'),
      'Reindexing the realm',
      'the plain attribute is overridable — it was never promoted to an arg',
    );
    assert.strictEqual(px(el, 'width'), '22px');
  });

  // ── BrokenLink ──────────────────────────────────────────────────────────
  test('BrokenLink names itself even with no arguments', async function (assert) {
    await render(<template><BrokenLink /></template>);
    let el = q('[data-test-pretui-broken-link]');
    assert.strictEqual(el.getAttribute('title'), 'This reference is gone');
    assert.true(el.textContent?.includes('missing card'), 'a default label, never an empty pill');
    assert.strictEqual(
      el.querySelector('svg')?.getAttribute('aria-hidden'),
      'true',
      'the glyph is decorative — the text carries the meaning',
    );
    assert.notOk(el.querySelector('.pretui-broken-id'), 'no empty id slot');
  });

  test('BrokenLink shows the dangling reference when one is known', async function (assert) {
    await render(<template><BrokenLink @label='Supplier' @refId='./suppliers/wuyi-origins' /></template>);
    let el = q('[data-test-pretui-broken-link]');
    assert.true(el.textContent?.includes('Supplier'));
    assert.strictEqual(
      el.querySelector('.pretui-broken-id')?.textContent?.trim(),
      './suppliers/wuyi-origins',
    );
  });

  // ── LoadingState ────────────────────────────────────────────────────────
  test('LoadingState is a live region with a default label and a decorative grid', async function (assert) {
    await render(<template><LoadingState /></template>);
    let el = q('[data-test-pretui-loading-state]');
    assert.strictEqual(el.getAttribute('role'), 'status');
    assert.strictEqual(el.querySelector('.pretui-shimmer-label')?.textContent?.trim(), 'Working');
    assert.strictEqual(
      el.querySelector('.pretui-pixelgrid')?.getAttribute('aria-hidden'),
      'true',
      'nine animated squares are not read out',
    );
    assert.strictEqual(all('.pretui-pixel').length, 9);
    assert.notOk(q('.pretui-elapsed'), 'no elapsed slot until the caller supplies the text');
  });

  test('LoadingState drives the drive variant off a chevron delay ramp', async function (assert) {
    await render(<template><LoadingState @label='Indexing' @elapsed='4.2s' /></template>);
    assert.strictEqual(q('.pretui-shimmer-label').textContent?.trim(), 'Indexing');
    assert.strictEqual(q('.pretui-elapsed').textContent?.trim(), '4.2s');
    let delays = all('.pretui-pixel').map((p) =>
      /(\d+)ms infinite/.exec(p.getAttribute('style') ?? '')?.[1],
    );
    assert.deepEqual(
      delays,
      ['90', '180', '270', '0', '90', '180', '90', '180', '270'],
      'the ramp is symmetric about the middle row, so the sweep reads as a chevron',
    );
    assert.deepEqual(
      all('.pretui-pixel').map((p) => p.dataset['round']),
      Array(9).fill(undefined),
      'only the dots variant rounds the pixels',
    );
  });

  test('LoadingState orbit leaves the centre pixel dark rather than animating it', async function (assert) {
    await render(<template><LoadingState @variant='orbit' /></template>);
    let styles = all('.pretui-pixel').map((p) => p.getAttribute('style') ?? '');
    assert.strictEqual(styles.filter((s) => s.includes('animation: none')).length, 1, 'exactly one still pixel');
    assert.true(styles[4]?.includes('animation: none'), 'and it is the centre of the 3×3');
    assert.true(styles[0]?.includes('950ms'), 'the orbit runs on its own, slower period');
  });

  test('LoadingState dots rounds every pixel', async function (assert) {
    await render(<template><LoadingState @variant='dots' /></template>);
    assert.deepEqual(
      all('.pretui-pixel').map((p) => p.dataset['round']),
      Array(9).fill('true'),
    );
  });
});
