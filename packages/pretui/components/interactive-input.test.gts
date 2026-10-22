// Pretui — InteractiveInput unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { on } from '@ember/modifier';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { InteractiveInput } from './interactive-input';
import type { InteractiveInputOption } from './interactive-input';

const OPTIONS: InteractiveInputOption[] = [
  { value: 'sage', label: 'Sage', swatch: 'var(--chart-2)' },
  { value: 'rust', swatch: 'red; background: url(javascript:0)' },
  { value: 'ink' },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-interactive-input]') as HTMLElement;
}
function radios(): HTMLInputElement[] {
  return Array.from(root().querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
}
function rerun(): HTMLButtonElement | null {
  return root().querySelector('[data-test-pretui-interactive-input-rerun]');
}

module('Pretui | components/interactive-input', function (hooks) {
  setupCardTest(hooks);

  test('asks in the INPUT tier with a radio picker defaulting to the first option', async function (assert) {
    await render(<template><InteractiveInput @prompt='Pick the accent' @detail='Used on the callout.' @options={{OPTIONS}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-iinput-verb')?.textContent?.trim(), 'INPUT');
    assert.strictEqual(root().querySelector('.pretui-iinput-prompt')?.textContent?.trim(), 'Pick the accent');
    assert.strictEqual(root().querySelector('.pretui-iinput-detail')?.textContent?.trim(), 'Used on the callout.');
    assert.strictEqual(root().querySelector('legend')?.textContent?.trim(), 'Pick the accent', 'the group is named by the prompt');
    assert.strictEqual(new Set(radios().map((r) => r.name)).size, 1);
    assert.deepEqual(radios().map((r) => r.checked), [true, false, false]);
    assert.deepEqual(Array.from(root().querySelectorAll('.pretui-iinput-face')).map((f) => f.textContent?.trim()), ['Sage', 'rust', 'ink'], 'the label falls back to the value');
    assert.strictEqual(rerun()?.textContent?.trim(), 'Re-run with sage');
  });

  test('paints a valid swatch and drops an unsafe one whole', async function (assert) {
    await render(<template><InteractiveInput @prompt='p' @options={{OPTIONS}} /></template>);
    let swatches = Array.from(root().querySelectorAll('.pretui-iinput-swatch')) as HTMLElement[];
    assert.strictEqual(swatches[0]?.getAttribute('style'), '--pretui-swatch: var(--chart-2)');
    assert.notOk((swatches[1]?.getAttribute('style') ?? '').includes('javascript'));
    assert.notOk((swatches[1]?.getAttribute('style') ?? '').includes('--pretui-swatch'), 'it loses its swatch, it never becomes a declaration');
  });

  test('picking reports the value and rewrites the CTA; re-run commits it', async function (assert) {
    let picked: string[] = [];
    let reran: string[] = [];
    const onValueChange = (v: string) => picked.push(v);
    const onRerun = (v: string) => reran.push(v);
    await render(<template><InteractiveInput @prompt='p' @options={{OPTIONS}} @onValueChange={{onValueChange}} @onRerun={{onRerun}} /></template>);
    await click(radios()[2] as HTMLElement);
    assert.deepEqual(picked, ['ink']);
    assert.strictEqual(rerun()?.textContent?.trim(), 'Re-run with ink');
    await click(rerun() as HTMLElement);
    assert.deepEqual(reran, ['ink']);
  });

  test('answered settles into a receipt: picker disabled, CTA gone, settled word shown', async function (assert) {
    await render(<template><InteractiveInput @prompt='p' @options={{OPTIONS}} @answered={{true}} @answeredLabel='re-run' /></template>);
    assert.strictEqual(root().dataset['answered'], 'true');
    assert.true((root().querySelector('fieldset') as HTMLFieldSetElement).disabled);
    assert.strictEqual(rerun(), null);
    assert.strictEqual(root().querySelector('.pretui-iinput-settled')?.textContent?.trim(), 're-run');
  });

  test('a custom CTA wording, a controlled value, and a verb override', async function (assert) {
    const wording = (v: string) => 'Redo in ' + v;
    let picked: string[] = [];
    const onValueChange = (v: string) => picked.push(v);
    await render(<template><InteractiveInput @prompt='p' @verb='CHOOSE' @options={{OPTIONS}} @value='rust' @rerunLabel={{wording}} @onValueChange={{onValueChange}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-iinput-verb')?.textContent?.trim(), 'CHOOSE');
    assert.strictEqual(rerun()?.textContent?.trim(), 'Redo in rust');
    await click(radios()[0] as HTMLElement);
    assert.deepEqual(picked, ['sage']);
    assert.strictEqual(rerun()?.textContent?.trim(), 'Redo in rust', 'the owner decides');
  });

  test('a picker block replaces the radios and reports through the same setter', async function (assert) {
    let picked: string[] = [];
    const onValueChange = (v: string) => picked.push(v);
    const choose = (set: (v: string) => void) => () => set('custom');
    await render(
      <template>
        <InteractiveInput @prompt='p' @onValueChange={{onValueChange}}>
          <:picker as |value setValue|>
            <button type='button' data-test-custom {{on 'click' (choose setValue)}}>{{value}}</button>
          </:picker>
        </InteractiveInput>
      </template>,
    );
    assert.strictEqual(root().querySelector('fieldset'), null);
    await click('[data-test-custom]');
    assert.deepEqual(picked, ['custom']);
    assert.strictEqual(document.querySelector('[data-test-custom]')?.textContent, 'custom');
    assert.strictEqual(rerun()?.textContent?.trim(), 'Re-run with custom');
  });
});
