// Pretui — BottomNav unit tests: a named nav of links or buttons, one current,
// labels always present.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { click, render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { BottomNav } from './bottom-nav';
import type { BottomNavItem } from './bottom-nav';

const TABS: BottomNavItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'lots', label: 'Lots', badge: '3', badgeLabel: 'new' },
  { id: 'orders', label: 'Orders' },
  { id: 'off', label: 'Reports', disabled: true },
];
const LINKS: BottomNavItem[] = [
  { id: 'home', label: 'Home', href: '#home' },
  { id: 'lots', label: 'Lots', href: '#lots' },
  { id: 'off', label: 'Reports', href: '#reports', disabled: true },
];

function item(id: string): HTMLElement {
  return document.querySelector(`[data-test-pretui-bottom-nav-item="${id}"]`) as HTMLElement;
}

module('Pretui | components/bottom-nav', function (hooks) {
  setupCardTest(hooks);

  test('it is a named navigation landmark with the first item current by default', async function (assert) {
    await render(<template><BottomNav @items={{TABS}} @label='Roastery' /></template>);
    let nav = document.querySelector('[data-test-pretui-bottom-nav]') as HTMLElement;
    assert.strictEqual(nav.tagName, 'NAV');
    assert.strictEqual(nav.getAttribute('aria-label'), 'Roastery');
    assert.strictEqual(item('home').getAttribute('aria-current'), 'page');
    assert.notOk(item('lots').hasAttribute('aria-current'));
    assert.ok(item('lots').textContent?.includes('Lots'), 'labels are always there');
    assert.strictEqual(item('lots').querySelector('.pretui-bottomnav-badge')?.getAttribute('aria-hidden'), 'true', 'the bare badge is not read');
    assert.ok(item('lots').textContent?.includes('3 new'), 'its meaning is: "3 new"');
  });

  test('choosing an item moves current and reports it', async function (assert) {
    let seen: string[] = [];
    let change = (id: string) => seen.push(id);
    await render(<template><BottomNav @items={{TABS}} @onChange={{change}} /></template>);
    await click(item('orders'));
    assert.deepEqual(seen, ['orders']);
    assert.strictEqual(item('orders').getAttribute('aria-current'), 'page');
    assert.strictEqual(item('orders').tagName, 'BUTTON');
  });

  test('a disabled item is marked and refuses', async function (assert) {
    let seen: string[] = [];
    let change = (id: string) => seen.push(id);
    await render(<template><BottomNav @items={{TABS}} @onChange={{change}} /></template>);
    assert.strictEqual(item('off').getAttribute('aria-disabled'), 'true');
    await click(item('off'));
    assert.deepEqual(seen, []);
  });

  test('items with an href are links; controlled @value marks the current one', async function (assert) {
    await render(<template><BottomNav @items={{LINKS}} @value='lots' /></template>);
    assert.strictEqual(item('lots').tagName, 'A');
    assert.strictEqual(item('lots').getAttribute('href'), '#lots');
    assert.strictEqual(item('lots').getAttribute('aria-current'), 'page');
  });

  test('link items are not marked current until @value says so', async function (assert) {
    await render(<template><BottomNav @items={{LINKS}} /></template>);
    assert.notOk(document.querySelector('[aria-current]'));
  });

  test('a disabled link stays a named, focusable link marked disabled', async function (assert) {
    let seen: string[] = [];
    let change = (id: string) => seen.push(id);
    await render(<template><BottomNav @items={{LINKS}} @onChange={{change}} /></template>);
    let off = item('off');
    assert.strictEqual(off.getAttribute('role'), 'link');
    assert.strictEqual(off.getAttribute('tabindex'), '0');
    assert.strictEqual(off.getAttribute('aria-disabled'), 'true');
    assert.notOk(off.hasAttribute('href'));
    await click(off);
    assert.deepEqual(seen, []);
  });
});
