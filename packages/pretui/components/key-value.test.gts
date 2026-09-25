// Pretui — KeyValue unit tests. Imports from ../reading; when KeyValue moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { KeyValue } from '../reading';
import type { KeyValueItem } from '../reading';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/key-value', function (hooks) {
  setupCardTest(hooks);

  test('KeyValue is a description list pairing each key with its value', async function (assert) {
    const ITEMS: KeyValueItem[] = [
      { key: 'Origin', value: 'Wuyi' },
      { key: 'Harvest', value: 'Spring 2026' },
    ];
    await render(<template><KeyValue @items={{ITEMS}} /></template>);
    let dl = q('[data-test-pretui-kv]');
    assert.strictEqual(dl.tagName, 'DL', 'the pairing is in the markup, not only the grid');
    assert.deepEqual(
      Array.from(dl.children).map((c) => [c.tagName, c.textContent?.trim()]),
      [
        ['DT', 'Origin'],
        ['DD', 'Wuyi'],
        ['DT', 'Harvest'],
        ['DD', 'Spring 2026'],
      ],
    );
  });

  test('KeyValue lets a value block replace the plain text, item by item', async function (assert) {
    const ITEMS: KeyValueItem[] = [{ key: 'Status', value: 'curing' }];
    await render(
      <template>
        <KeyValue @items={{ITEMS}}>
          <:value as |item|><b data-test-custom>{{item.value}}!</b></:value>
        </KeyValue>
      </template>,
    );
    assert.strictEqual(q('dd [data-test-custom]')?.textContent?.trim(), 'curing!');
  });
});
