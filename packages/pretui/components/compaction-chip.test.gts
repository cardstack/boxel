// Pretui — CompactionChip unit tests. Imports from ../agentic-chat; when CompactionChip moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CompactionChip } from './compaction-chip';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-compaction-chip]') as HTMLElement;
}
function toggle(): HTMLButtonElement | null {
  return root().querySelector('[data-test-pretui-compaction-toggle]');
}
function disclosure(): HTMLElement | null {
  return root().querySelector('[data-test-pretui-disclosure]');
}

module('Pretui | components/compaction-chip', function (hooks) {
  setupCardTest(hooks);

  test('a settled compaction is a collapsed disclosure that counts what it condensed', async function (assert) {
    await render(<template><CompactionChip @messageCount={{12}} @toolCallCount={{3}} @summary='Agreed on the Fujian lots.' /></template>);
    assert.strictEqual(root().dataset['state'], 'done');
    assert.strictEqual(toggle()?.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(toggle()?.querySelector('.pretui-compaction-label')?.textContent?.trim(), 'History compacted');
    assert.strictEqual(toggle()?.querySelector('.pretui-compaction-counts')?.textContent?.trim(), '12 messages · 3 tool calls condensed', 'assembled as text, so it reads in greyscale');
    assert.strictEqual(disclosure()?.dataset['open'], undefined);
    assert.strictEqual(document.getElementById(toggle()?.getAttribute('aria-controls') as string), disclosure());

    await click(toggle() as HTMLElement);
    assert.strictEqual(toggle()?.getAttribute('aria-expanded'), 'true', 'uncontrolled: the click opens it and the a11y attribute follows');
    assert.strictEqual(disclosure()?.dataset['open'], 'true');
  });

  test('uses the singular and omits the counts line entirely when there is nothing to count', async function (assert) {
    await render(<template><CompactionChip @messageCount={{1}} @toolCallCount={{1}} /></template>);
    assert.strictEqual(toggle()?.querySelector('.pretui-compaction-counts')?.textContent?.trim(), '1 message · 1 tool call condensed');
    await render(<template><CompactionChip /></template>);
    assert.strictEqual(toggle()?.querySelector('.pretui-compaction-counts'), null);
  });

  test('while running it is a live status with a spinner and nothing to expand', async function (assert) {
    await render(<template><CompactionChip @state='running' /></template>);
    assert.strictEqual(root().dataset['state'], 'running');
    assert.strictEqual(toggle(), null);
    let chip = root().querySelector('.pretui-compaction-chip') as HTMLElement;
    assert.strictEqual(chip.getAttribute('role'), 'status');
    assert.ok(chip.querySelector('[data-test-pretui-spinner]'));
    assert.strictEqual(chip.textContent?.trim(), 'Compacting long history');
    assert.strictEqual(disclosure(), null);
  });

  test('expands to the summary, a summary block, or an honest "none kept"', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><CompactionChip @summary='Agreed on the Fujian lots.' @onExpandedChange={{record}} /></template>);
    await click(toggle() as HTMLElement);
    assert.strictEqual(disclosure()?.dataset['open'], 'true');
    assert.strictEqual(root().querySelector('.pretui-compaction-summary p')?.textContent?.trim(), 'Agreed on the Fujian lots.');
    assert.deepEqual(seen, [true]);

    await render(<template><CompactionChip @defaultExpanded={{true}}><:summary><ul data-test-rich><li>x</li></ul></:summary></CompactionChip></template>);
    assert.ok(root().querySelector('.pretui-compaction-summary [data-test-rich]'));

    await render(<template><CompactionChip @defaultExpanded={{true}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-compaction-none')?.textContent?.replace(/\s+/g, ' ').trim(), 'No written summary was kept for this compaction.');
  });

  test('a controlled @expanded holds still and reports; labels are caller-settable', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><CompactionChip @expanded={{false}} @doneLabel='Condensed' @onExpandedChange={{record}} /></template>);
    assert.strictEqual(toggle()?.querySelector('.pretui-compaction-label')?.textContent?.trim(), 'Condensed');
    await click(toggle() as HTMLElement);
    assert.strictEqual(toggle()?.getAttribute('aria-expanded'), 'false', 'the owner decides');
    assert.deepEqual(seen, [true]);
  });
});
