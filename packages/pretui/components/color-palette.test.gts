// Pretui — ColorPalette unit tests.
import { module, test } from 'qunit';
import { click, render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ColorPalette } from './color-palette';

const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'];

function swatches(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.pretui-palette .pretui-swatch')) as HTMLElement[];
}
function press(key: string) {
  return triggerKeyEvent(document.activeElement as HTMLElement, 'keydown', key);
}

module('Pretui | components/color-palette', function (hooks) {
  setupCardTest(hooks);

  test('the selected swatch is the tab stop, and arrows walk away from it', async function (assert) {
    let picked: string[] = [];
    let onValueChange = (c: string) => picked.push(c);
    await render(<template><ColorPalette @colors={{COLORS}} @value='#00ff00' @onValueChange={{onValueChange}} /></template>);
    assert.deepEqual(swatches().map((s) => s.tabIndex), [-1, 0, -1, -1, -1], 'tabbing in lands on the current colour');
    swatches()[1]!.focus();
    await press('ArrowRight');
    await press('ArrowRight');
    assert.strictEqual(document.activeElement, swatches()[3], 'two presses, two steps');
    assert.strictEqual(swatches()[3]!.tabIndex, 0, 'the tab stop follows focus');
    await press('Home');
    assert.strictEqual(document.activeElement, swatches()[0]);
    await click(swatches()[2]!);
    assert.deepEqual(picked, ['#0000ff']);
  });
});
