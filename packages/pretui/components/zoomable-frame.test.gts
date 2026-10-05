// Pretui — ZoomableFrame unit tests.
import { module, test } from 'qunit';
import { click, render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { on } from '@ember/modifier';
import { ZoomableFrame } from './zoomable-frame';

function control(name: 'in' | 'out' | 'reset'): HTMLButtonElement {
  return document.querySelector(`[data-test-pretui-frame-${name}]`) as HTMLButtonElement;
}

module('Pretui | components/zoomable-frame', function (hooks) {
  setupCardTest(hooks);

  test('the button that reaches a limit keeps focus and is announced as disabled', async function (assert) {
    let seen: number[] = [];
    let onScaleChange = (s: number) => seen.push(s);
    await render(
      <template>
        <ZoomableFrame @label='Floor plan' @min={{0.5}} @max={{2}} @step={{2}} @onScaleChange={{onScaleChange}}>plan</ZoomableFrame>
      </template>,
    );
    assert.strictEqual(control('reset').getAttribute('aria-disabled'), 'true', 'nothing to reset at rest');
    let zoomIn = control('in');
    zoomIn.focus();
    await click(zoomIn);
    assert.strictEqual(zoomIn.getAttribute('aria-disabled'), 'true', 'at the maximum');
    assert.false(zoomIn.disabled, 'but not natively disabled');
    assert.strictEqual(document.activeElement, zoomIn, 'so focus stayed on it');
    let count = seen.length;
    await click(zoomIn);
    assert.strictEqual(seen.length, count, 'and a press past the limit does nothing');
    await click(control('reset'));
    assert.strictEqual(control('reset').getAttribute('aria-disabled'), 'true', 'reset returns to rest');
  });

  test('controls inside the frame keep their presses and keys', async function (assert) {
    let clicks = 0;
    let scales: number[] = [];
    let press = () => clicks++;
    let onScaleChange = (n: number) => scales.push(n);
    await render(
      <template>
        <ZoomableFrame @label='Plan' @onScaleChange={{onScaleChange}}>
          <button type='button' class='t-inner' {{on 'click' press}}>Inner</button>
          <input aria-label='Note' class='t-note' />
        </ZoomableFrame>
      </template>,
    );
    await click('.t-inner');
    assert.strictEqual(clicks, 1, 'the inner button still clicks');
    await triggerKeyEvent('.t-note', 'keydown', '-');
    await triggerKeyEvent('.t-note', 'keydown', '=');
    assert.deepEqual(scales, [], 'typing in an inner input does not zoom');
  });
});
