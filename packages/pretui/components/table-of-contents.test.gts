// Pretui — TableOfContents unit tests. Imports from ../structure-data; when
// TableOfContents moves to its own file only the import path changes. The
// scroll spy is passed `@spy={{false}}` and would be inert anyway: these
// tests render no elements carrying the item ids, so `sectionSpy` returns
// before constructing its IntersectionObserver. Asserted: the nav semantics,
// active-state routing, the controlled/uncontrolled split, and the travelling
// marker's inline geometry (offsetTop/offsetHeight are real here). A spy test
// that renders the target headings is the open follow-up.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { TableOfContents } from './table-of-contents';
import type { TocItem } from './table-of-contents';

const ITEMS: TocItem[] = [
  { id: 'intro', label: 'Introduction' },
  { id: 'cupping', label: 'Cupping notes', level: 2 },
  { id: 'storage', label: 'Storage', level: 2 },
  { id: 'price', label: 'Pricing' },
];

function nav(): HTMLElement {
  return document.querySelector('[data-test-pretui-toc]') as HTMLElement;
}
function links(): HTMLAnchorElement[] {
  return Array.from(nav().querySelectorAll('.pretui-toc-link')) as HTMLAnchorElement[];
}
function marker(): string[] {
  let s = (nav().querySelector('.pretui-toc-track') as HTMLElement).style;
  return ['--pretui-toc-marker-opacity', '--pretui-toc-marker-top', '--pretui-toc-marker-height'].map((p) => s.getPropertyValue(p));
}
function active(): string | undefined {
  return links().find((l) => l.getAttribute('aria-current') === 'location')?.dataset['tocId'];
}

module('Pretui | components/table-of-contents', function (hooks) {
  setupCardTest(hooks);

  test('is a named nav landmark listing fragment links, indented by level', async function (assert) {
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} /></template>);
    assert.strictEqual(nav().tagName, 'NAV');
    assert.strictEqual(nav().getAttribute('aria-label'), 'On this page');
    assert.strictEqual(nav().querySelector('ol')?.getAttribute('role'), 'list', 'list-style:none strips list semantics in VoiceOver; the role restores them');
    assert.deepEqual(links().map((l) => l.getAttribute('href')), ['#intro', '#cupping', '#storage', '#price'], 'real fragment links — they work with no JS at all');
    assert.deepEqual(
      Array.from(nav().querySelectorAll('.pretui-toc-row')).map((r) => r.getAttribute('style')),
      ['--_level: 1', '--_level: 2', '--_level: 2', '--_level: 1'],
    );
  });

  test('the first item is current by default, and a click moves it', async function (assert) {
    let seen: string[] = [];
    const record = (id: string) => seen.push(id);
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} @onActiveChange={{record}} /></template>);
    assert.strictEqual(active(), 'intro');
    assert.strictEqual(links()[0]?.dataset['active'], 'true', 'the CSS marker reads the same fact');
    assert.deepEqual(marker(), ['1', `${links()[0]?.offsetTop}px`, `${links()[0]?.offsetHeight}px`], 'the marker parks on the first link');

    await click(links()[2] as HTMLElement);
    assert.strictEqual(active(), 'storage', 'aria-current="location" — this is a place in the document, not a page');
    assert.deepEqual(seen, ['storage']);
    assert.deepEqual(marker(), ['1', `${links()[2]?.offsetTop}px`, `${links()[2]?.offsetHeight}px`], 'and travels to the active link');
  });

  test('seeds from @defaultActiveId and takes a caller label', async function (assert) {
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} @defaultActiveId='price' @label='Contents' /></template>);
    assert.strictEqual(active(), 'price');
    assert.strictEqual(nav().getAttribute('aria-label'), 'Contents');
  });

  test('a controlled @activeId holds still and reports the request', async function (assert) {
    let seen: string[] = [];
    const record = (id: string) => seen.push(id);
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} @activeId='cupping' @onActiveChange={{record}} /></template>);
    await click(links()[3] as HTMLElement);
    assert.strictEqual(active(), 'cupping', 'the owner decides');
    assert.deepEqual(seen, ['price']);
  });

  test('hands the item block the item and whether it is active', async function (assert) {
    await render(
      <template>
        <TableOfContents @items={{ITEMS}} @spy={{false}}>
          <:item as |item isActive|><span data-test-custom>{{item.label}}{{if isActive ' ●' ''}}</span></:item>
        </TableOfContents>
      </template>,
    );
    assert.deepEqual(
      Array.from(nav().querySelectorAll('[data-test-custom]')).slice(0, 2).map((e) => e.textContent),
      ['Introduction ●', 'Cupping notes'],
    );
  });
});
