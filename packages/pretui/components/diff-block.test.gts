// Pretui — DiffBlock unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DiffBlock } from './diff-block';
import type { DiffLine } from './diff-block';

const SMALL: DiffLine[] = [
  { text: 'name: Wuyi' },
  { op: 'del', text: 'lots: 11' },
  { op: 'add', text: 'lots: 12' },
];
const LONG: DiffLine[] = Array.from({ length: 12 }, (_u, i) => ({ text: 'line ' + (i + 1) }));

function block(): HTMLElement {
  return document.querySelector('[data-test-pretui-diff-block]') as HTMLElement;
}
function lines(): HTMLElement[] {
  return Array.from(block().querySelectorAll('.pretui-diff-line:not(.pretui-diff-toggle)')) as HTMLElement[];
}
function toggle(): HTMLButtonElement | null {
  return block().querySelector('.pretui-diff-toggle');
}

module('Pretui | components/diff-block', function (hooks) {
  setupCardTest(hooks);

  test('prefixes each line by its op and reflects the op for the CSS', async function (assert) {
    await render(<template><DiffBlock @lines={{SMALL}} @receipt='applied 2026-09-04 · r-8812' /></template>);
    assert.deepEqual(lines().map((l) => l.textContent), ['  name: Wuyi', '- lots: 11', '+ lots: 12'], 'the sign is text, so it survives greyscale');
    assert.deepEqual(lines().map((l) => l.dataset['op']), [undefined, 'del', 'add']);
    assert.strictEqual(block().querySelector('.pretui-diff-receipt')?.textContent?.trim(), 'applied 2026-09-04 · r-8812');
    assert.strictEqual(toggle(), null, 'a short diff has nothing to collapse');
  });

  test('a long diff collapses to eight lines with a toggle that says how many are hidden', async function (assert) {
    await render(<template><DiffBlock @lines={{LONG}} /></template>);
    assert.strictEqual(lines().length, 8);
    assert.strictEqual(toggle()?.textContent?.trim(), '… 4 more lines');
    await click(toggle() as HTMLElement);
    assert.strictEqual(lines().length, 12);
    assert.strictEqual(toggle()?.textContent?.trim(), 'collapse');
  });

  test('takes a different fold point', async function (assert) {
    await render(<template><DiffBlock @lines={{LONG}} @maxLines={{3}} /></template>);
    assert.strictEqual(lines().length, 3);
    assert.strictEqual(toggle()?.textContent?.trim(), '… 9 more lines');
  });
});
