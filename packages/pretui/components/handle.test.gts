// Pretui — Handle unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Handle } from './handle';

function handle(): HTMLElement {
  return document.querySelector('[data-test-pretui-handle]') as HTMLElement;
}

module('Pretui | components/handle', function (hooks) {
  setupCardTest(hooks);

  test('is a positioned button whose accessible name carries the value ARIA has no slot for', async function (assert) {
    await render(<template><Handle /></template>);
    assert.strictEqual(handle().tagName, 'BUTTON');
    assert.strictEqual(handle().getAttribute('style'), 'left:50%;top:50%;--pretui-handle-hit:6px', 'centred with the default hit area');
    assert.strictEqual(handle().getAttribute('aria-label'), 'Handle');
    assert.strictEqual(handle().dataset['handle'], '0');
    assert.strictEqual(handle().dataset['shape'], 'point');
    assert.strictEqual(handle().getAttribute('aria-pressed'), null);

    await render(<template><Handle @index={{2}} @x={{25}} @y={{80}} @label='Control point 2' @valueText='0.58, 1' @shape='square' @selected={{true}} @hitArea={{12}} /></template>);
    assert.strictEqual(handle().getAttribute('aria-label'), 'Control point 2, 0.58, 1');
    assert.strictEqual(handle().getAttribute('style'), 'left:25%;top:80%;--pretui-handle-hit:12px');
    assert.strictEqual(handle().dataset['handle'], '2');
    assert.strictEqual(handle().dataset['shape'], 'square');
    assert.strictEqual(handle().getAttribute('aria-pressed'), 'true');
    assert.strictEqual(handle().dataset['selected'], 'true');
  });

  test('bounds the position to ±1000% and the hit area to 64px, so a bad arg stays finite', async function (assert) {
    await render(<template><Handle @x={{5000}} @y={{-5000}} @hitArea={{999}} /></template>);
    assert.strictEqual(handle().getAttribute('style'), 'left:1000%;top:-1000%;--pretui-handle-hit:64px');
  });

  test('arrow keys nudge by the step, Shift coarsens tenfold, Alt refines, Home/End jump to the edges', async function (assert) {
    let calls: [number, number][] = [];
    let onNudge = (dx: number, dy: number) => calls.push([dx, dy]);
    await render(<template><Handle @step={{2}} @onNudge={{onNudge}} /></template>);
    await triggerKeyEvent(handle(), 'keydown', 'ArrowRight');
    await triggerKeyEvent(handle(), 'keydown', 'ArrowUp');
    await triggerKeyEvent(handle(), 'keydown', 'ArrowLeft', { shiftKey: true });
    await triggerKeyEvent(handle(), 'keydown', 'ArrowDown', { altKey: true });
    await triggerKeyEvent(handle(), 'keydown', 'Home');
    await triggerKeyEvent(handle(), 'keydown', 'End');
    await triggerKeyEvent(handle(), 'keydown', 'Tab');
    assert.deepEqual(calls, [[2, 0], [0, -2], [-20, 0], [0, 0.2], [-Infinity, 0], [Infinity, 0]], 'Tab passes through untouched');
  });

  test('click activates, and disabled swallows both keyboard and click', async function (assert) {
    let activated = 0;
    let nudged = 0;
    let onActivate = () => activated++;
    let onNudge = () => nudged++;
    await render(<template><Handle @onActivate={{onActivate}} @onNudge={{onNudge}} /></template>);
    await click(handle());
    assert.strictEqual(activated, 1);

    await render(<template><Handle @disabled={{true}} @onActivate={{onActivate}} @onNudge={{onNudge}} /></template>);
    assert.strictEqual(handle().getAttribute('aria-disabled'), 'true', 'aria-disabled, not disabled — it stays focusable so its name can be read');
    await click(handle());
    await triggerKeyEvent(handle(), 'keydown', 'ArrowRight');
    assert.strictEqual(activated, 1);
    assert.strictEqual(nudged, 0);
  });
});
