// Pretui — ColorStopEditor unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, triggerEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ColorStopEditor } from './color-stop-editor';
import type { GradientStop } from '../color-engine';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/color-stop-editor', function (hooks) {
  setupCardTest(hooks);

  const STOP: GradientStop = { id: 's1', color: '#ff0000', position: 25 };

  test('ColorStopEditor shows the stop hex and names its trigger by the colour', async function (assert) {
    const noop = () => {};
    await render(
      <template>
        <ColorStopEditor @stop={{STOP}} @onColorChange={{noop}} @onPositionChange={{noop}} />
      </template>,
    );
    let row = q('[data-test-pretui-color-stop="s1"]');
    assert.ok(row, 'the row is addressable by the stop it edits');
    assert.strictEqual(row.querySelector('.pretui-stoprow-hex')?.textContent?.trim(), '#ff0000');
    let name = row.querySelector('.pretui-stoprow-trigger')?.getAttribute('aria-label') ?? '';
    assert.true(name.startsWith('Stop colour: '), 'the trigger says what it edits');
    assert.true(
      name.includes('red'),
      'and names the hue in words, so the row is legible without seeing the chip',
    );
    assert.strictEqual(row.dataset['state'], undefined, 'not selected');
  });

  test('ColorStopEditor marks the selected row and reports a selection when its trigger is focused', async function (assert) {
    let seen: string[] = [];
    const record = (id: string) => seen.push(id);
    const noop = () => {};
    await render(
      <template>
        <ColorStopEditor @stop={{STOP}} @selected={{true}} @onSelect={{record}} @onColorChange={{noop}} @onPositionChange={{noop}} />
      </template>,
    );
    assert.strictEqual(q('[data-test-pretui-color-stop="s1"]').dataset['state'], 'selected');

    await triggerEvent('.pretui-stoprow-trigger', 'focus');
    assert.deepEqual(seen, ['s1'], 'tabbing onto a stop selects it — no extra click to edit the one you reached');
  });

  test('ColorStopEditor names the remove control by the position it would remove', async function (assert) {
    const noop = () => {};
    await render(
      <template>
        <ColorStopEditor @stop={{STOP}} @removable={{true}} @onColorChange={{noop}} @onPositionChange={{noop}} />
      </template>,
    );
    let remove = q('[aria-label="Remove stop at 25 percent"]') as HTMLButtonElement;
    assert.ok(remove, 'not a bare ✕ that reads as "close" to a screen reader');
    assert.false(remove.disabled);
  });

  test('ColorStopEditor explains why removal is unavailable rather than only greying out', async function (assert) {
    const noop = () => {};
    await render(
      <template>
        <ColorStopEditor @stop={{STOP}} @onColorChange={{noop}} @onPositionChange={{noop}} />
      </template>,
    );
    let remove = q('[aria-label="Remove stop at 25 percent"]') as HTMLButtonElement;
    assert.true(remove.disabled);
    assert.strictEqual(remove.getAttribute('title'), 'A gradient needs at least two stops');
  });

  test('ColorStopEditor reports a removal against the stop id', async function (assert) {
    let removed: string[] = [];
    const onRemove = (id: string) => removed.push(id);
    const noop = () => {};
    await render(
      <template>
        <ColorStopEditor @stop={{STOP}} @removable={{true}} @onRemove={{onRemove}} @onColorChange={{noop}} @onPositionChange={{noop}} />
      </template>,
    );
    await click('[aria-label="Remove stop at 25 percent"]');
    assert.deepEqual(removed, ['s1'], 'the id travels, not the index — stops reorder');
  });

  test('ColorStopEditor renders an unparseable stop colour as an empty chip with no hex', async function (assert) {
    const BROKEN: GradientStop = { id: 's2', color: 'not a colour', position: 50 };
    const noop = () => {};
    await render(
      <template>
        <ColorStopEditor @stop={{BROKEN}} @onColorChange={{noop}} @onPositionChange={{noop}} />
      </template>,
    );
    assert.strictEqual(q('.pretui-stoprow-hex').textContent?.trim(), '');
    assert.strictEqual(q('.pretui-swatch-chip').dataset['empty'], 'true');
    assert.strictEqual(q('.pretui-stoprow-trigger').getAttribute('aria-label'), 'Stop colour: none');
  });

  test('ColorStopEditor disables the whole row', async function (assert) {
    const noop = () => {};
    await render(
      <template>
        <ColorStopEditor @stop={{STOP}} @removable={{true}} @disabled={{true}} @onColorChange={{noop}} @onPositionChange={{noop}} />
      </template>,
    );
    assert.true((q('.pretui-stoprow-trigger') as HTMLButtonElement).disabled);
    assert.true((q('[aria-label="Remove stop at 25 percent"]') as HTMLButtonElement).disabled);
  });
});
