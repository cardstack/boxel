// Pretui — AngleDial unit tests. Imports from ../design-spatial; when AngleDial moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AngleDial } from './angle-dial';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-angle-dial]') as HTMLElement;
}
function spin(label: string): HTMLElement {
  let lab = Array.from(root().querySelectorAll('label.pretui-sr')).find((l) => l.textContent === label);
  return document.getElementById(lab?.getAttribute('for') ?? '') as HTMLElement;
}
function plane(): HTMLElement {
  return root().querySelector('[data-test-pretui-angle-plane]') as HTMLElement;
}

module('Pretui | components/angle-dial', function (hooks) {
  setupCardTest(hooks);

  test('is a slider over one turn, with the hand angle published for the CSS and a paired field', async function (assert) {
    await render(<template><AngleDial /></template>);
    assert.strictEqual(plane().getAttribute('role'), 'slider');
    assert.strictEqual(plane().getAttribute('aria-label'), 'Angle');
    assert.deepEqual([plane().getAttribute('aria-valuemin'), plane().getAttribute('aria-valuemax'), plane().getAttribute('aria-valuenow')], ['0', '360', '0']);
    assert.strictEqual(plane().getAttribute('aria-valuetext'), '0°');
    assert.strictEqual(plane().getAttribute('style'), '--pretui-dial-angle: 0deg');
    assert.strictEqual(spin('Angle').getAttribute('role'), 'spinbutton', 'the field is labelled by a visually hidden label, not aria-label');
    assert.strictEqual(spin('Angle').getAttribute('aria-valuenow'), '0');
    assert.strictEqual(root().querySelector('[data-test-pretui-angle-turns]'), null, 'no turns badge below one rotation');
  });

  test('a multi-turn value keeps the hand inside one turn and counts the turns for the badge and the announcement', async function (assert) {
    await render(<template><AngleDial @value={{725}} @rotations={{true}} @label='Spin' /></template>);
    assert.strictEqual(plane().getAttribute('style'), '--pretui-dial-angle: 5deg', 'the hand looks identical every 360');
    assert.strictEqual(plane().getAttribute('aria-valuenow'), '725', 'but the value is the whole truth');
    assert.strictEqual(plane().getAttribute('aria-valuetext'), '725°, 2 full turns');
    assert.strictEqual(root().querySelector('[data-test-pretui-angle-turns]')?.textContent?.trim(), '×2');
    assert.strictEqual(plane().getAttribute('aria-label'), 'Spin');
  });

  test('the unit converts the display while degrees stay the model', async function (assert) {
    await render(<template><AngleDial @value={{180}} @unit='turn' @precision={{2}} /></template>);
    assert.strictEqual(plane().getAttribute('aria-valuetext'), '0.5turn');
    assert.strictEqual(plane().getAttribute('aria-valuenow'), '180');
    await render(<template><AngleDial @value={{180}} @unit='rad' @precision={{2}} /></template>);
    assert.strictEqual(plane().getAttribute('aria-valuetext'), '3.14rad');
  });

  test('arrow keys step the angle, PageUp/Down step coarsely, Home/End go to the bounds, and the value is clamped', async function (assert) {
    let seen: number[] = [];
    let onChange = (v: number) => seen.push(v);
    await render(<template><AngleDial @defaultValue={{10}} @step={{2}} @min={{0}} @max={{90}} @onChange={{onChange}} /></template>);
    await triggerKeyEvent(plane(), 'keydown', 'ArrowRight');
    await triggerKeyEvent(plane(), 'keydown', 'ArrowDown');
    await triggerKeyEvent(plane(), 'keydown', 'PageUp');
    await triggerKeyEvent(plane(), 'keydown', 'End');
    await triggerKeyEvent(plane(), 'keydown', 'ArrowUp');
    await triggerKeyEvent(plane(), 'keydown', 'Home');
    assert.deepEqual(seen, [12, 10, 30, 90, 90, 0], 'the step past max is clamped, not wrapped');
    assert.strictEqual(plane().getAttribute('aria-valuenow'), '0', 'uncontrolled: the dial follows its own commits');
  });

  test('showDial/showInput hide either half; disabled ignores the keyboard', async function (assert) {
    let changes = 0;
    let onChange = () => changes++;
    await render(<template><AngleDial @showInput={{false}} @disabled={{true}} @onChange={{onChange}} /></template>);
    assert.strictEqual(root().querySelector('[role="spinbutton"]'), null);
    assert.strictEqual(root().dataset['disabled'], 'true', 'the wrapper is dimmed; the controls inside carry the state');
    assert.strictEqual(plane().getAttribute('aria-disabled'), 'true');
    await triggerKeyEvent(plane(), 'keydown', 'ArrowRight');
    assert.strictEqual(changes, 0);

    await render(<template><AngleDial @showDial={{false}} /></template>);
    assert.strictEqual(root().querySelector('[data-test-pretui-angle-plane]'), null);
    assert.ok(root().querySelector('[role="spinbutton"]'));
  });
});
