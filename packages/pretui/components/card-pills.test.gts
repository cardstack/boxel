// Pretui — CardPills unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CardPills, type CardPillItem } from './card-pills';

const CARDS: CardPillItem[] = [
  { id: 'a', title: 'Alder' },
  { id: 'b', title: 'Birch' },
  { id: 'c', title: 'Cedar' },
];

module('Pretui | components/card-pills', function (hooks) {
  setupCardTest(hooks);

  test('Show all and Show fewer are one button, so focus stays on it', async function (assert) {
    await render(<template><CardPills @cards={{CARDS}} @limit={{1}} /></template>);
    let toggle = document.querySelector('[data-test-pretui-card-pills-all]') as HTMLElement;
    assert.dom(toggle).hasText('Show all 3');
    assert.dom(toggle).hasAttribute('aria-expanded', 'false');
    await click(toggle);
    assert.dom('[data-test-pretui-card-pill]').exists({ count: 3 });
    assert.strictEqual(document.activeElement, toggle, 'focus stays on the pressed button');
    assert.dom(toggle).hasText('Show fewer');
    assert.dom(toggle).hasAttribute('aria-expanded', 'true');
    await click(toggle);
    assert.dom('[data-test-pretui-card-pill]').exists({ count: 1 });
    assert.strictEqual(document.activeElement, toggle, 'and again on Show fewer');
    assert.dom(toggle).hasText('Show all 3');
  });

  test('the picked count is announced from its own status region, not from the bar with its buttons', async function (assert) {
    const PICKED = ['a', 'b'];
    const noop = () => {};
    await render(<template>
      <CardPills @cards={{CARDS}} @selectable={{true}} @selected={{PICKED}} @onUseSelection={{noop}} />
    </template>);
    assert.dom('[data-test-pretui-card-pills-bar]').doesNotHaveAttribute('role');
    assert.dom('[data-test-pretui-card-pills-status]').hasAttribute('role', 'status');
    assert.dom('[data-test-pretui-card-pills-status]').hasAttribute('aria-atomic', 'true');
    assert.dom('[data-test-pretui-card-pills-status]').hasText('2 picked');
    assert.dom('[data-test-pretui-card-pills-status] button').doesNotExist();
  });

  test('a card image is a decorative img, never a style url', async function (assert) {
    const WITH_IMAGE: CardPillItem[] = [{ id: 'x', title: 'Xylem', image: 'https://example.test/x.png"); color: red; x: url("' }];
    await render(<template><CardPills @cards={{WITH_IMAGE}} /></template>);
    assert.dom('[data-test-pretui-card-pill] [style]').doesNotExist('nothing card-supplied reaches a style attribute');
    assert.dom('[data-test-pretui-card-pill-image]').hasAttribute('alt', '');
    assert.dom('[data-test-pretui-card-pill-image]').hasAttribute('src', 'https://example.test/x.png"); color: red; x: url("');
  });

  test('Escape that clears the picks does not reach the document', async function (assert) {
    let reached = 0;
    let onDoc = (e: KeyboardEvent) => e.key === 'Escape' && reached++;
    document.addEventListener('keydown', onDoc);
    try {
      let picked: string[][] = [];
      const record = (ids: string[]) => picked.push(ids);
      const PICKED = ['a'];
      await render(<template>
        <CardPills @cards={{CARDS}} @selectable={{true}} @selected={{PICKED}} @onSelectionChange={{record}} />
      </template>);
      let pill = document.querySelector('[data-test-pretui-card-pill]') as HTMLElement;
      pill.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert.deepEqual(picked, [[]], 'the picks clear');
      assert.strictEqual(reached, 0, 'the host does not also see the Escape');
    } finally {
      document.removeEventListener('keydown', onDoc);
    }
  });
});
