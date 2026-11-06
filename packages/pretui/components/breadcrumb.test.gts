// Pretui — Breadcrumb unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { on } from '@ember/modifier';
import { click, render } from '@ember/test-helpers';
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
      Array.from(nav.querySelectorAll(':scope > ol > li')).map((li) => li.getAttribute('data-test-pretui-breadcrumb-item')),
      ['0', '1', '2'],
      'the crumbs are a list, one item each, so a screen reader announces how many there are',
    );
    assert.deepEqual(
      Array.from(nav.querySelectorAll('a')).map((a) => [a.textContent?.trim(), a.getAttribute('href')]),
      [
        ['Realm', '/'],
        ['Suppliers', '/suppliers'],
      ],
    );
    assert.strictEqual(nav.querySelector('b')?.textContent?.trim(), 'Wuyi Origins', 'the leaf is not a link');
    assert.dom('[data-test-pretui-breadcrumb-current]').hasText('Wuyi Origins');
    assert.deepEqual(texts('[data-test-pretui-breadcrumb-label]'), ['Realm', 'Suppliers', 'Wuyi Origins'], 'each crumb names its label element');
    assert.deepEqual(
      Array.from(nav.querySelectorAll('[aria-current]')).map((e) => [e.textContent?.trim(), e.getAttribute('aria-current')]),
      [['Wuyi Origins', 'page']],
      'only the leaf is announced as the current page',
    );
    let seps = Array.from(nav.querySelectorAll('[data-test-pretui-breadcrumb-sep]'));
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
    assert.deepEqual(texts('[data-test-pretui-breadcrumb-item] > *'), ['Realm', '/', 'Archive', '/', 'Now']);
  });

  test('Breadcrumb renders a single crumb with no separator', async function (assert) {
    const ONE: CrumbSpec[] = [{ label: 'Realm', href: '/' }];
    await render(<template><Breadcrumb @items={{ONE}} /></template>);
    assert.strictEqual(q('[data-test-pretui-breadcrumb] b')?.textContent?.trim(), 'Realm');
    assert.strictEqual(
      q('[data-test-pretui-breadcrumb] b')?.getAttribute('aria-current'),
      'page',
      'a lone crumb with an href is still the current page, not a link',
    );
    assert.strictEqual(all('[data-test-pretui-breadcrumb-sep]').length, 0);
  });

  test('Breadcrumb hands a clicked crumb, as given, to @onSelect, which can take the navigation over', async function (assert) {
    interface Place extends CrumbSpec {
      id: string;
    }
    const ITEMS: Place[] = [
      { label: 'Realm', href: '#realm', id: 'realm' },
      { label: 'Suppliers', href: '#suppliers', id: 'suppliers' },
      { label: 'Wuyi Origins', href: '#wuyi', id: 'wuyi' },
    ];
    let selected: string[] = [];
    const onSelect = (item: Place, event: MouseEvent) => {
      selected.push(item.id);
      event.preventDefault();
    };
    let before = window.location.hash;
    await render(<template><Breadcrumb @items={{ITEMS}} @onSelect={{onSelect}} /></template>);
    let links = all('[data-test-pretui-breadcrumb] a');
    await click(links[1]!);
    await click(links[0]!);
    assert.deepEqual(selected, ['suppliers', 'realm'], 'each click names its own crumb, with the fields the caller gave it');
    assert.strictEqual(window.location.hash, before, 'a handler that prevents the click keeps the link from being followed');
    assert.dom('[data-test-pretui-breadcrumb] b').hasText('Wuyi Origins', 'the current place is still not a link, so it never selects');
  });

  test('Breadcrumb leaves a modified click to the browser, so a crumb still opens in a new tab', async function (assert) {
    const ITEMS: CrumbSpec[] = [
      { label: 'Realm', href: '#realm' },
      { label: 'Now' },
    ];
    let selected = 0;
    const onSelect = (_item: CrumbSpec, event: MouseEvent) => {
      selected++;
      event.preventDefault();
    };
    // Stands in for the browser's new tab: nothing in the test follows the link.
    const stay = (event: Event) => event.preventDefault();
    await render(<template><Breadcrumb @items={{ITEMS}} @onSelect={{onSelect}} {{on 'click' stay}} /></template>);
    let link = q('[data-test-pretui-breadcrumb-item="0"] a');
    for (let modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      await click(link, { [modifier]: true });
    }
    assert.strictEqual(selected, 0, 'no modified click reaches @onSelect');
    await click(link);
    assert.strictEqual(selected, 1, 'a plain click does');
  });
});
