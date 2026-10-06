// Pretui — Joystick unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Joystick } from './joystick';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-joystick]') as HTMLElement;
}
function handle(): HTMLElement {
  return root().querySelector('[data-test-pretui-handle]') as HTMLElement;
}
function field(label: string): HTMLElement {
  let lab = Array.from(root().querySelectorAll('label.pretui-sr')).find((l) => l.textContent === label);
  return document.getElementById(lab?.getAttribute('for') ?? '') as HTMLElement;
}

module('Pretui | components/joystick', function (hooks) {
  setupCardTest(hooks);

  test('rests at the centre with crosshair guides, a named handle and X/Y fields', async function (assert) {
    await render(<template><Joystick /></template>);
    let pad = root().querySelector('[data-test-pretui-joystick-pad]') as HTMLElement;
    assert.strictEqual(pad.getAttribute('style'), '--pretui-joy-x: 50%; --pretui-joy-y: 50%');
    assert.strictEqual(pad.querySelectorAll('.pretui-joystick-guide').length, 2);
    assert.strictEqual(handle().getAttribute('aria-label'), 'Position, 50%, 50%');
    assert.true(handle().getAttribute('style')?.startsWith('left:50%;top:50%'));
    assert.strictEqual(field('X').getAttribute('aria-valuenow'), '50');
    assert.strictEqual(field('Y').getAttribute('aria-valuenow'), '50');
    assert.strictEqual(root().querySelector('[data-test-pretui-joystick-reset]')?.getAttribute('aria-disabled'), 'true', 'nothing to reset at the origin');
    assert.strictEqual(root().querySelectorAll('.pretui-joystick-axis').length, 0);
  });

  test('math coordinates flip Y for the reported value and the field but not for the drawn position', async function (assert) {
    const P = { x: 20, y: 80 };
    const AXES: [string, string, string, string] = ['L', 'R', 'T', 'B'];
    await render(<template><Joystick @value={{P}} @coordinates='math' @label='Anchor' @axisLabels={{AXES}} /></template>);
    assert.strictEqual(handle().getAttribute('aria-label'), 'Anchor, 20%, 20%', 'y is reported bottom-up');
    assert.true(handle().getAttribute('style')?.startsWith('left:20%;top:80%'), 'but drawn top-down');
    assert.strictEqual(field('Y').getAttribute('aria-valuenow'), '20');
    assert.deepEqual(Array.from(root().querySelectorAll('.pretui-joystick-axis')).map((a) => a.textContent), ['L', 'R', 'T', 'B']);
    assert.strictEqual(root().querySelector('[data-test-pretui-joystick-reset]')?.getAttribute('aria-disabled'), null);
  });

  test('the handle nudges by the step, Home/End pin x to the edges, and Reset returns to the origin', async function (assert) {
    let seen: { x: number; y: number }[] = [];
    let onChange = (p: { x: number; y: number }) => seen.push(p);
    const ORIGIN = { x: 40, y: 60 };
    await render(<template><Joystick @defaultValue={{ORIGIN}} @origin={{ORIGIN}} @step={{5}} @onChange={{onChange}} /></template>);
    await triggerKeyEvent(handle(), 'keydown', 'ArrowRight');
    await triggerKeyEvent(handle(), 'keydown', 'ArrowUp');
    await triggerKeyEvent(handle(), 'keydown', 'Home');
    await triggerKeyEvent(handle(), 'keydown', 'End');
    await click(root().querySelector('[data-test-pretui-joystick-reset]') as HTMLElement);
    assert.deepEqual(seen, [{ x: 45, y: 60 }, { x: 45, y: 55 }, { x: 0, y: 55 }, { x: 100, y: 55 }, { x: 40, y: 60 }]);
    assert.strictEqual(handle().getAttribute('aria-label'), 'Position, 40%, 60%');
  });

  test('a modifier scales the step once: Shift moves ten steps, Alt a tenth', async function (assert) {
    let seen: { x: number; y: number }[] = [];
    let onChange = (p: { x: number; y: number }) => seen.push(p);
    const ORIGIN = { x: 40, y: 60 };
    await render(<template><Joystick @defaultValue={{ORIGIN}} @step={{5}} @onChange={{onChange}} /></template>);
    await triggerKeyEvent(handle(), 'keydown', 'ArrowRight', { shiftKey: true });
    await triggerKeyEvent(handle(), 'keydown', 'ArrowUp', { altKey: true });
    assert.deepEqual(seen, [{ x: 90, y: 60 }, { x: 90, y: 59.5 }]);
  });

  test('fields can be hidden and disabled ignores the keyboard', async function (assert) {
    let changes = 0;
    let onChange = () => changes++;
    await render(<template><Joystick @fields={{false}} @disabled={{true}} @onChange={{onChange}} /></template>);
    assert.strictEqual(root().querySelector('[role="spinbutton"]'), null);
    assert.strictEqual(root().dataset['disabled'], 'true', 'the wrapper is dimmed');
    await triggerKeyEvent(handle(), 'keydown', 'ArrowRight');
    assert.strictEqual(changes, 0);
  });

  test('Reset is announced as disabled and does nothing on a disabled Joystick', async function (assert) {
    let changes = 0;
    let onChange = () => changes++;
    const AT = { x: 10, y: 10 };
    await render(<template><Joystick @defaultValue={{AT}} @disabled={{true}} @onChange={{onChange}} /></template>);
    let reset = root().querySelector('[data-test-pretui-joystick-reset]') as HTMLElement;
    assert.strictEqual(reset.getAttribute('aria-disabled'), 'true');
    await click(reset);
    assert.strictEqual(changes, 0);
  });
});
