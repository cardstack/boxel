// Pretui — PropertySheet unit tests. Imports from ../design-value; when PropertySheet moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PropertySheet } from './property-sheet';
import type { ValueSpec, ValueOf } from './value-input';

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-test-pretui-property-sheet] [data-test-pretui-property-row]')) as HTMLElement[];
}

function str(v: unknown): string {
  return String(v);
}

const SPECS: ValueSpec[] = [
  { key: 'width', kind: 'number', label: 'Width', unit: 'px', hint: 'Content box', modified: true },
  { key: 'visible', kind: 'toggle', label: 'Visible' },
  { key: 'align', kind: 'select', label: 'Align', options: [{ value: 'l', label: 'Left' }, { value: 'r', label: 'Right' }], layout: 'stack' },
  { key: 'tint', kind: 'custom', label: 'Tint', disabled: true },
];
const VALUES: Record<string, ValueOf> = { width: 320, visible: false, align: 'r', tint: '#c00' };

module('Pretui | components/property-sheet', function (hooks) {
  setupCardTest(hooks);

  test('one PropertyRow per spec, each with its label, editor and value', async function (assert) {
    await render(
      <template>
        <PropertySheet @specs={{SPECS}} @values={{VALUES}}>
          <:custom as |kind value spec|><i data-test-custom>{{kind}}:{{str value}}:{{spec.key}}</i></:custom>
        </PropertySheet>
      </template>,
    );
    assert.strictEqual(rows().length, 4);
    assert.deepEqual(rows().map((r) => r.querySelector('label')?.textContent), ['Width', 'Visible', 'Align', 'Tint']);
    assert.deepEqual(rows().map((r) => r.querySelector('[data-test-pretui-value-input]')?.getAttribute('data-kind')), ['number', 'toggle', 'select', 'custom']);
    assert.strictEqual(rows()[0]?.querySelector('[role="spinbutton"]')?.getAttribute('aria-valuenow'), '320');
    assert.strictEqual(rows()[0]?.querySelector('.pretui-property-hint')?.textContent, 'Content box');
    assert.strictEqual(rows()[0]?.dataset['modified'], 'true');
    assert.ok(rows()[0]?.querySelector('[data-test-pretui-property-dot]'), 'modified but no onReset on the sheet: a dot, not a button');
    assert.strictEqual(rows()[3]?.querySelector('[data-test-custom]')?.textContent, 'custom:#c00:tint', 'the custom block also gets the spec');
    assert.strictEqual(rows()[3]?.dataset['disabled'], 'true', 'a spec can disable its own row');
    assert.strictEqual(rows()[1]?.dataset['disabled'], undefined);
  });

  test('a spec-level layout beats the sheet layout', async function (assert) {
    await render(<template><PropertySheet @specs={{SPECS}} @values={{VALUES}} @layout='row' /></template>);
    assert.deepEqual(rows().map((r) => r.dataset['layout']), ['row', 'row', 'stack', 'row']);
  });

  test('changes and resets report the spec key', async function (assert) {
    let changes: [string, ValueOf][] = [];
    let resets: string[] = [];
    let onChange = (k: string, v: ValueOf) => changes.push([k, v]);
    let onReset = (k: string) => resets.push(k);
    await render(<template><PropertySheet @specs={{SPECS}} @values={{VALUES}} @onChange={{onChange}} @onReset={{onReset}} /></template>);
    await click(rows()[1]?.querySelector('[data-test-pretui-checkbox] input') as HTMLElement);
    assert.deepEqual(changes, [['visible', true]]);
    let reset = rows()[0]?.querySelector('[data-test-pretui-property-reset]') as HTMLElement;
    assert.strictEqual(reset.getAttribute('aria-label'), 'Reset Width');
    await click(reset);
    assert.deepEqual(resets, ['width']);
    assert.strictEqual(rows()[1]?.querySelector('[data-test-pretui-property-reset]'), null, 'unmodified rows get no reset');
  });

  test('sheet-level disabled reaches every editor', async function (assert) {
    await render(<template><PropertySheet @specs={{SPECS}} @values={{VALUES}} @disabled={{true}} /></template>);
    assert.deepEqual([...new Set(rows().map((r) => r.dataset['disabled']))], ['true']);
    assert.true((rows()[1]?.querySelector('[data-test-pretui-checkbox] input') as HTMLInputElement).disabled);
  });
});
