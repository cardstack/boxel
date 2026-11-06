// Pretui — KeyValue unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { KeyValue } from './key-value';
import type { KeyValueItem } from './key-value';

// Every `style` attribute written while `work` runs. Glimmer binds `style`
// with `setAttribute`, which a strict Content Security Policy (the secure
// origin's) refuses; a CSSOM write (`element.style.setProperty`) doesn't go
// through it and is allowed.
async function styleAttributeWrites(work: () => Promise<void>): Promise<string[]> {
  let writes: string[] = [];
  let setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    if (name.toLowerCase() === 'style') {
      writes.push(value);
    }
    return setAttribute.call(this, name, value);
  };
  try {
    await work();
  } finally {
    Element.prototype.setAttribute = setAttribute;
  }
  return writes;
}

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

  test('KeyValue lays out horizontally by default and takes stacked and inline layouts', async function (assert) {
    const ITEMS: KeyValueItem[] = [{ key: 'Origin', value: 'Wuyi' }];
    await render(
      <template>
        <KeyValue @items={{ITEMS}} data-test-kv='none' />
        <KeyValue @items={{ITEMS}} @layout='horizontal' data-test-kv='horizontal' />
        <KeyValue @items={{ITEMS}} @layout='stacked' data-test-kv='stacked' />
        <KeyValue @items={{ITEMS}} @layout='inline' data-test-kv='inline' />
      </template>,
    );
    assert.dom('[data-test-kv="none"]').hasAttribute('data-layout', 'horizontal');
    assert.dom('[data-test-kv="horizontal"]').hasAttribute('data-layout', 'horizontal');
    assert.dom('[data-test-kv="stacked"]').hasAttribute('data-layout', 'stacked');
    assert.dom('[data-test-kv="inline"]').hasAttribute('data-layout', 'inline');
  });

  test("KeyValue takes 'vertical' as an alias of 'stacked'", async function (assert) {
    const ITEMS: KeyValueItem[] = [{ key: 'Origin', value: 'Wuyi' }];
    await render(<template><KeyValue @items={{ITEMS}} @layout='vertical' /></template>);
    assert.dom('[data-test-pretui-kv]').hasAttribute('data-layout', 'stacked');
  });

  test('KeyValue keeps a stacked list a flat run of dt/dd pairs', async function (assert) {
    const ITEMS: KeyValueItem[] = [
      { key: 'Origin', value: 'Wuyi' },
      { key: 'Harvest', value: 'Spring 2026' },
    ];
    await render(<template><KeyValue @items={{ITEMS}} @layout='stacked' /></template>);
    assert.deepEqual(
      Array.from(q('[data-test-pretui-kv]').children).map((c) => c.tagName),
      ['DT', 'DD', 'DT', 'DD'],
    );
  });

  test('KeyValue groups each pair of an inline list, so a key wraps with its value', async function (assert) {
    const ITEMS: KeyValueItem[] = [
      { key: 'Starts', value: '1 Mar 2026' },
      { key: 'Ends', value: '28 Feb 2027' },
    ];
    await render(
      <template>
        <KeyValue @items={{ITEMS}} @layout='inline'>
          <:value as |item|><b data-test-custom>{{item.value}}</b></:value>
        </KeyValue>
      </template>,
    );
    let dl = q('[data-test-pretui-kv]');
    assert.strictEqual(dl.tagName, 'DL');
    assert.deepEqual(
      Array.from(dl.children).map((pair) => [
        pair.tagName,
        Array.from(pair.children).map((c) => [c.tagName, c.textContent?.trim()]),
      ]),
      [
        [
          'DIV',
          [
            ['DT', 'Starts'],
            ['DD', '1 Mar 2026'],
          ],
        ],
        [
          'DIV',
          [
            ['DT', 'Ends'],
            ['DD', '28 Feb 2027'],
          ],
        ],
      ],
    );
    assert.dom('dd [data-test-custom]').exists({ count: 2 }, 'the value block still fills each dd');
  });

  test('KeyValue sets its keys in the eyebrow role only when asked', async function (assert) {
    const ITEMS: KeyValueItem[] = [{ key: 'Origin', value: 'Wuyi' }];
    await render(
      <template>
        <KeyValue @items={{ITEMS}} data-test-kv='none' />
        <KeyValue @items={{ITEMS}} @labelStyle='default' data-test-kv='default' />
        <KeyValue @items={{ITEMS}} @labelStyle='eyebrow' data-test-kv='eyebrow' />
      </template>,
    );
    assert.dom('[data-test-kv="none"]').doesNotHaveAttribute('data-label-style');
    assert.dom('[data-test-kv="default"]').doesNotHaveAttribute('data-label-style');
    assert.dom('[data-test-kv="eyebrow"]').hasAttribute('data-label-style', 'eyebrow');
  });

  test('KeyValue divides and end-aligns only on the horizontal layout', async function (assert) {
    const ITEMS: KeyValueItem[] = [{ key: 'Origin', value: 'Wuyi' }];
    await render(
      <template>
        <KeyValue @items={{ITEMS}} data-test-kv='none' />
        <KeyValue @items={{ITEMS}} @divided={{true}} @valueAlign='end' data-test-kv='horizontal' />
        <KeyValue @items={{ITEMS}} @divided={{true}} @valueAlign='end' @layout='stacked' data-test-kv='stacked' />
        <KeyValue @items={{ITEMS}} @divided={{true}} @valueAlign='end' @layout='inline' data-test-kv='inline' />
      </template>,
    );
    assert.dom('[data-test-kv="none"]').doesNotHaveAttribute('data-divided');
    assert.dom('[data-test-kv="none"]').doesNotHaveAttribute('data-value-align');
    assert.dom('[data-test-kv="horizontal"]').hasAttribute('data-divided', 'true');
    assert.dom('[data-test-kv="horizontal"]').hasAttribute('data-value-align', 'end');
    for (let layout of ['stacked', 'inline']) {
      assert.dom(`[data-test-kv="${layout}"]`).doesNotHaveAttribute('data-divided');
      assert.dom(`[data-test-kv="${layout}"]`).doesNotHaveAttribute('data-value-align');
    }
  });

  // The row selectors key off the list's children being only dt/dd, in
  // alternating order with a dt first.
  test('KeyValue horizontal renders alternating dt/dd children', async function (assert) {
    const ITEMS: KeyValueItem[] = [
      { key: 'Origin', value: 'Wuyi' },
      { key: 'Harvest', value: 'Spring 2026' },
    ];
    await render(<template><KeyValue @items={{ITEMS}} @divided={{true}} /></template>);
    assert.deepEqual(
      Array.from(q('[data-test-pretui-kv]').children).map((c) => c.tagName),
      ['DT', 'DD', 'DT', 'DD'],
    );
  });

  test('renders no style attribute', async function (assert) {
    let items: KeyValueItem[] = [
      { key: 'Kind', value: 'API key' },
      { key: 'Used with', value: 'github.com' },
    ];
    let writes = await styleAttributeWrites(() =>
      render(<template><KeyValue @items={{items}} @labelStyle='eyebrow' /></template>),
    );
    assert.deepEqual(writes, [], 'no style attribute is written');
    assert.dom('[data-test-pretui-kv] dt').exists({ count: 2 });
  });
});
