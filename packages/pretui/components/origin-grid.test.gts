// Pretui — OriginGrid unit tests. Imports from ../design-spatial; when OriginGrid moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { OriginGrid, ORIGIN_ANCHOR_NAMES } from './origin-grid';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-origin-grid]') as HTMLElement;
}
function spin(label: string): HTMLElement {
  let lab = Array.from(root().querySelectorAll('label.pretui-sr')).find((l) => l.textContent === label);
  return document.getElementById(lab?.getAttribute('for') ?? '') as HTMLElement;
}
function cells(): HTMLElement[] {
  return Array.from(root().querySelectorAll('[data-test-pretui-origin-cell]')) as HTMLElement[];
}
function status(): string {
  return (root().querySelector('[data-test-pretui-origin-status]') as HTMLElement).textContent?.trim() ?? '';
}

module('Pretui | components/origin-grid', function (hooks) {
  setupCardTest(hooks);

  test('is a nine-cell radiogroup with the centre checked, described by a live status line', async function (assert) {
    await render(<template><OriginGrid /></template>);
    let group = root().querySelector('[role="radiogroup"]') as HTMLElement;
    assert.strictEqual(group.getAttribute('aria-label'), 'Origin');
    assert.deepEqual(cells().map((c) => c.getAttribute('aria-label')), [...ORIGIN_ANCHOR_NAMES]);
    assert.deepEqual(cells().map((c) => c.getAttribute('aria-checked')), ['false', 'false', 'false', 'false', 'true', 'false', 'false', 'false', 'false']);
    assert.strictEqual(group.getAttribute('aria-describedby'), root().querySelector('[data-test-pretui-origin-status]')?.id);
    assert.strictEqual(status(), 'Centre');
    assert.strictEqual(root().querySelector('[data-test-pretui-handle]'), null, 'on an anchor there is no free handle');
    assert.deepEqual(cells().map((c) => c.tabIndex), [-1, -1, -1, -1, 0, -1, -1, -1, -1], 'one roving tab stop');
  });

  test('an off-anchor value clears every radio, reads as Custom and grows a free handle riding the dot centres', async function (assert) {
    const P = { x: 30, y: 70 };
    await render(<template><OriginGrid @value={{P}} @label='Transform origin' /></template>);
    assert.deepEqual([...new Set(cells().map((c) => c.getAttribute('aria-checked')))], ['false']);
    assert.strictEqual(status(), 'Custom · 30%, 70%');
    assert.strictEqual(root().querySelector('[data-test-pretui-handle]')?.getAttribute('aria-label'), 'Transform origin, Custom · 30%, 70%');
    assert.strictEqual(root().querySelector('[data-test-pretui-origin-pad]')?.getAttribute('style'), '--pretui-origin-x: 36.667%; --pretui-origin-y: 63.333%', '0% sits on the first dot, not the container edge');
  });

  test('nudging the free handle commits one percent per arrow and rewrites the status line', async function (assert) {
    // This is the `handleNudge` path (the Handle's onNudge), distinct from the
    // radiogroup's own arrow handling asserted below.
    const P = { x: 30, y: 70 };
    await render(<template><OriginGrid @defaultValue={{P}} /></template>);
    let handle = root().querySelector('[data-test-pretui-handle]') as HTMLElement;
    await triggerKeyEvent(handle, 'keydown', 'ArrowRight');
    assert.strictEqual(status(), 'Custom · 31%, 70%');
    await triggerKeyEvent(root().querySelector('[data-test-pretui-handle]') as HTMLElement, 'keydown', 'ArrowRight', { shiftKey: true });
    assert.strictEqual(status(), 'Custom · 41%, 70%', 'Shift is ×10, and OriginGrid does not multiply again');
  });

  test('clicking a cell commits its anchor; arrows move through the grid and Home/End jump to the corners', async function (assert) {
    let seen: { x: number; y: number }[] = [];
    let onChange = (p: { x: number; y: number }) => seen.push(p);
    await render(<template><OriginGrid @onChange={{onChange}} /></template>);
    await click(cells()[2] as HTMLElement);
    assert.deepEqual(seen, [{ x: 100, y: 0 }]);
    assert.strictEqual(status(), 'Top right');
    await triggerKeyEvent(cells()[2] as HTMLElement, 'keydown', 'ArrowDown');
    assert.strictEqual(status(), 'Centre right');
    await triggerKeyEvent(cells()[5] as HTMLElement, 'keydown', 'ArrowLeft');
    assert.strictEqual(status(), 'Centre');
    await triggerKeyEvent(cells()[4] as HTMLElement, 'keydown', 'ArrowUp');
    await triggerKeyEvent(cells()[1] as HTMLElement, 'keydown', 'ArrowUp');
    assert.strictEqual(status(), 'Top centre', 'the top edge holds');
    await triggerKeyEvent(cells()[1] as HTMLElement, 'keydown', 'End');
    assert.strictEqual(status(), 'Bottom right');
    await triggerKeyEvent(cells()[8] as HTMLElement, 'keydown', 'Home');
    assert.strictEqual(status(), 'Top left');
    assert.strictEqual(seen.length, 7);
  });

  test('fields add X/Y spinbuttons; disabled ignores clicks', async function (assert) {
    let changes = 0;
    let onChange = () => changes++;
    await render(<template><OriginGrid @fields={{true}} @disabled={{true}} @onChange={{onChange}} /></template>);
    assert.strictEqual(spin('Origin X').getAttribute('aria-valuenow'), '50');
    assert.strictEqual(spin('Origin Y').getAttribute('role'), 'spinbutton');
    assert.strictEqual(root().dataset['disabled'], 'true', 'the wrapper is dimmed; the controls inside carry the state');
    await click(cells()[0] as HTMLElement);
    assert.strictEqual(changes, 0);
    assert.strictEqual(status(), 'Centre');
  });
});
