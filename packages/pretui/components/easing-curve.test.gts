// Pretui — EasingCurve unit tests. Imports from ../design-curves; when EasingCurve moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { EasingCurve, bezierCss, presetFor, clampControl, EASING_PRESETS } from './easing-curve';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-easing-curve]') as HTMLElement;
}
function handles(): HTMLElement[] {
  return Array.from(root().querySelectorAll('[data-test-pretui-handle]')) as HTMLElement[];
}

module('Pretui | components/easing-curve', function (hooks) {
  setupCardTest(hooks);

  test('the helpers: css string, preset detection within tolerance, and clamping to the plot', function (assert) {
    assert.strictEqual(bezierCss({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }), 'cubic-bezier(0.42, 0, 0.58, 1)');
    assert.strictEqual(presetFor({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }), 'ease-in-out');
    assert.strictEqual(presetFor({ x1: 0.424, y1: 0, x2: 0.58, y2: 1 }), 'ease-in-out', 'a hair off still reads as the preset');
    assert.strictEqual(presetFor({ x1: 0.3, y1: 0, x2: 0.58, y2: 1 }), 'custom');
    assert.deepEqual(clampControl(1.7, 9), { x: 1, y: 1.5 }, 'x by spec, y to the plot so it stays draggable');
    assert.deepEqual(clampControl(-2, -9), { x: 0, y: -0.5 });
    assert.true(EASING_PRESETS.length >= 5);
  });

  test('draws the curve with two named handles and publishes the easing and preview duration for the CSS', async function (assert) {
    await render(<template><EasingCurve /></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-curve-ease: cubic-bezier(0.42, 0, 0.58, 1); --pretui-curve-dur: 1200ms', 'ease-in-out is the default curve');
    assert.strictEqual(handles().length, 2);
    assert.strictEqual(handles()[0]?.getAttribute('aria-label'), 'Control point 1, 0.42, 0');
    assert.strictEqual(handles()[1]?.getAttribute('aria-label'), 'Control point 2, 0.58, 1');
    let at = (i: number) => (handles()[i]?.getAttribute('style') ?? '').match(/^left:([-\d.]+)%;top:([-\d.]+)%/)?.slice(1, 3).map(Number) ?? [];
    assert.deepEqual(at(0), [42, 75], 'y=0 sits on the lower baseline of the ±0.5 overshoot plot');
    assert.strictEqual(at(1)[1], 25);
    assert.true(Math.abs((at(1)[0] ?? 0) - 58) < 1e-9, 'x is not rounded before it reaches the handle');
    let polyline = root().querySelector('polyline.pretui-curve-line') as SVGElement;
    assert.true((polyline.getAttribute('points') ?? '').length > 200, 'a sampled polyline, not a single bezier path — it must scale with preserveAspectRatio=none');
    assert.ok(root().querySelector('[data-test-pretui-select]'), 'preset picker');
    assert.strictEqual(root().querySelectorAll('[role="spinbutton"]').length, 4, 'x1 y1 x2 y2 fields');
    assert.ok(root().querySelector('.pretui-curve-track'), 'preview runner');
  });

  test('a controlled value drives the plot; presets, fields and preview can be hidden; the preview duration is clamped', async function (assert) {
    const LINEAR = { x1: 0, y1: 0, x2: 1, y2: 1 };
    await render(<template><EasingCurve @value={{LINEAR}} @presets={{false}} @fields={{false}} @preview={{false}} @previewDuration={{50}} /></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-curve-ease: cubic-bezier(0, 0, 1, 1); --pretui-curve-dur: 100ms');
    assert.strictEqual(root().querySelector('[data-test-pretui-select]'), null);
    assert.strictEqual(root().querySelectorAll('[role="spinbutton"]').length, 0);
    assert.strictEqual(root().querySelector('.pretui-curve-track'), null);
  });

  test('nudging a handle moves that control point by a hundredth and Home/End pin its x', async function (assert) {
    let seen: string[] = [];
    let onChange = (c: { x1: number; y1: number; x2: number; y2: number }) => seen.push(bezierCss(c));
    await render(<template><EasingCurve @onChange={{onChange}} /></template>);
    await triggerKeyEvent(handles()[0] as HTMLElement, 'keydown', 'ArrowRight');
    await triggerKeyEvent(handles()[1] as HTMLElement, 'keydown', 'ArrowUp', { shiftKey: true });
    await triggerKeyEvent(handles()[0] as HTMLElement, 'keydown', 'Home');
    await triggerKeyEvent(handles()[1] as HTMLElement, 'keydown', 'End');
    assert.deepEqual(seen, [
      'cubic-bezier(0.43, 0, 0.58, 1)',
      'cubic-bezier(0.43, 0, 0.58, 1.2)',
      'cubic-bezier(0, 0, 0.58, 1.2)',
      'cubic-bezier(0, 0, 1, 1.2)',
    ], 'Shift+Up on y is 10 × 0.02 across the 2-unit plot');
    assert.strictEqual(handles()[1]?.getAttribute('aria-label'), 'Control point 2, 1, 1.2');
    assert.true(root().getAttribute('style')?.startsWith('--pretui-curve-ease: cubic-bezier(0, 0, 1, 1.2)'), 'uncontrolled: the plot follows its own commits');
  });

  test('the committed control point is clamped to the plot, not only the rendered css', async function (assert) {
    // bezierCss clamps on its own, so the accessible name — which reads the
    // committed value — is where an unclamped commit would show.
    await render(<template><EasingCurve /></template>);
    for (let i = 0; i < 4; i++) {
      await triggerKeyEvent(handles()[1] as HTMLElement, 'keydown', 'ArrowUp', { shiftKey: true });
    }
    assert.strictEqual(handles()[1]?.getAttribute('aria-label'), 'Control point 2, 0.58, 1.5', '1 + 4 × 0.2 would be 1.8; the plot ceiling is 1.5');
  });

  test('disabled ignores the keyboard', async function (assert) {
    let changes = 0;
    let onChange = () => changes++;
    await render(<template><EasingCurve @disabled={{true}} @onChange={{onChange}} /></template>);
    assert.strictEqual(root().dataset['disabled'], 'true', 'the wrapper is dimmed; the controls inside carry the state');
    await triggerKeyEvent(handles()[0] as HTMLElement, 'keydown', 'ArrowRight');
    assert.strictEqual(changes, 0);
  });
});
