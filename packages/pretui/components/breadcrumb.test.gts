// Pretui — Breadcrumb unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Breadcrumb } from './breadcrumb';
import type { CrumbSpec } from './breadcrumb';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function texts(sel: string): (string | undefined)[] {
  return all(sel).map((e) => e.textContent?.trim());
}

module('Pretui | components/breadcrumb', function (hooks) {
  setupCardTest(hooks);

  test('Breadcrumb links every crumb but the last, which is marked as the current place', async function (assert) {
    const ITEMS: CrumbSpec[] = [
      { label: 'Realm', href: '/' },
      { label: 'Suppliers', href: '/suppliers' },
      { label: 'Wuyi Origins' },
    ];
    await render(<template><Breadcrumb @items={{ITEMS}} /></template>);
    let nav = q('[data-test-pretui-breadcrumb]');
    assert.strictEqual(nav.tagName, 'NAV');
    assert.strictEqual(nav.getAttribute('aria-label'), 'Breadcrumb');
    assert.deepEqual(
      Array.from(nav.querySelectorAll('a')).map((a) => [a.textContent?.trim(), a.getAttribute('href')]),
      [
        ['Realm', '/'],
        ['Suppliers', '/suppliers'],
      ],
    );
    assert.strictEqual(nav.querySelector('b')?.textContent?.trim(), 'Wuyi Origins', 'the leaf is not a link');
    let seps = Array.from(nav.querySelectorAll('.sep'));
    assert.strictEqual(seps.length, 2, 'separators sit between, not before the first');
    assert.deepEqual(
      seps.map((s) => s.getAttribute('aria-hidden')),
      ['true', 'true'],
      'the separators are decoration, so a screen reader does not read "slash" between crumbs',
    );
  });

  test('Breadcrumb renders an hrefless middle crumb as plain text, not a dead link', async function (assert) {
    const ITEMS: CrumbSpec[] = [{ label: 'Realm' }, { label: 'Archive' }, { label: 'Now' }];
    await render(<template><Breadcrumb @items={{ITEMS}} /></template>);
    assert.strictEqual(q('[data-test-pretui-breadcrumb]').querySelectorAll('a').length, 0);
    assert.deepEqual(texts('[data-test-pretui-breadcrumb] > *'), ['Realm', '/', 'Archive', '/', 'Now']);
  });

  test('Breadcrumb renders a single crumb with no separator', async function (assert) {
    const ONE: CrumbSpec[] = [{ label: 'Realm', href: '/' }];
    await render(<template><Breadcrumb @items={{ONE}} /></template>);
    assert.strictEqual(q('[data-test-pretui-breadcrumb] b')?.textContent?.trim(), 'Realm');
    assert.strictEqual(all('.sep').length, 0);
  });
});
