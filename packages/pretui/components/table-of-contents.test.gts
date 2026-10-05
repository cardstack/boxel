// Pretui — TableOfContents unit tests. Most tests pass `@spy={{false}}` and
// render no elements carrying the item ids, so `sectionSpy` returns before
// constructing its IntersectionObserver. Asserted: the nav semantics,
// active-state routing, the controlled/uncontrolled split, @onSelect as a
// pure report (link mode keeps its hrefs), button mode (`@links={{false}}`:
// real buttons, the id and the click event handed back), the spy's default
// in each mode (the one test that renders the target headings), and the
// travelling marker's inline geometry (offsetTop/offsetHeight are real here).
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
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
function buttons(): HTMLButtonElement[] {
  return Array.from(nav().querySelectorAll('button.pretui-toc-link')) as HTMLButtonElement[];
}
function marker(): string[] {
  let s = (nav().querySelector('.pretui-toc-track') as HTMLElement).style;
  return ['--pretui-toc-marker-opacity', '--pretui-toc-marker-top', '--pretui-toc-marker-height'].map((p) => s.getPropertyValue(p));
}
function active(): string | undefined {
  return links().find((l) => l.getAttribute('aria-current') === 'location')?.dataset['tocId'];
}
// IntersectionObserver delivers its first notification during a rendering
// update, so a few frames are enough for an observing spy to have reported.
async function frames(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

module('Pretui | components/table-of-contents', function (hooks) {
  setupCardTest(hooks);

  test('is a named nav landmark listing fragment links, indented by level', async function (assert) {
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} /></template>);
    assert.strictEqual(nav().tagName, 'NAV');
    assert.strictEqual(nav().getAttribute('aria-label'), 'On this page');
    assert.strictEqual(nav().querySelector('ol')?.getAttribute('role'), 'list', 'list-style:none strips list semantics in VoiceOver; the role restores them');
    assert.deepEqual(links().map((l) => l.getAttribute('href')), ['#intro', '#cupping', '#storage', '#price'], 'real fragment links — they work with no JS at all');
    assert.deepEqual(links().map((l) => l.tagName), ['A', 'A', 'A', 'A'], 'links are the default');
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

  test('@onSelect only reports: link mode keeps its hrefs and hands back the click', async function (assert) {
    let selected: { id: string; type: string; currentTarget: EventTarget | null }[] = [];
    const select = (id: string, event: Event) => selected.push({ id, type: event.type, currentTarget: event.currentTarget });
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} @onSelect={{select}} /></template>);
    assert.deepEqual(links().map((l) => l.tagName), ['A', 'A', 'A', 'A'], 'passing @onSelect does not turn the rows into buttons');
    assert.deepEqual(links().map((l) => l.getAttribute('href')), ['#intro', '#cupping', '#storage', '#price'], 'and the fragment links still navigate');
    let target = links()[2] as HTMLAnchorElement;
    await click(target);
    assert.deepEqual(selected, [{ id: 'storage', type: 'click', currentTarget: target }], 'a click reports the id and the event');
    assert.strictEqual(active(), 'storage');
  });

  test('@links={{false}} renders buttons that keep the list and the current marker', async function (assert) {
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} @links={{false}} /></template>);
    assert.strictEqual(nav().tagName, 'NAV', 'still a named nav landmark');
    assert.strictEqual(nav().querySelector('ol')?.getAttribute('role'), 'list');
    assert.strictEqual(buttons().length, 4, 'every row is a button');
    assert.strictEqual(nav().querySelectorAll('a').length, 0, 'and none is a link');
    assert.deepEqual(buttons().map((b) => b.getAttribute('type')), ['button', 'button', 'button', 'button'], 'type=button, so a TOC inside a form never submits it');
    assert.true(buttons().every((b) => !b.hasAttribute('href')), 'no href: the caller owns scrolling');
    assert.deepEqual(
      Array.from(nav().querySelectorAll('.pretui-toc-row')).map((r) => r.getAttribute('style')),
      ['--_level: 1', '--_level: 2', '--_level: 2', '--_level: 1'],
      'levels indent the same way',
    );
    assert.strictEqual(active(), 'intro', 'aria-current="location" marks the first row');
    assert.deepEqual(marker(), ['1', `${buttons()[0]?.offsetTop}px`, `${buttons()[0]?.offsetHeight}px`], 'the marker parks on the first button');
  });

  test('a button click hands back the id and the click event, and moves the current row', async function (assert) {
    let selected: { id: string; type: string; currentTarget: EventTarget | null }[] = [];
    let changed: string[] = [];
    const select = (id: string, event: Event) => selected.push({ id, type: event.type, currentTarget: event.currentTarget });
    const record = (id: string) => changed.push(id);
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} @links={{false}} @onSelect={{select}} @onActiveChange={{record}} /></template>);
    let hashBefore = window.location.hash;
    let target = buttons()[2] as HTMLButtonElement;
    await click(target);
    assert.strictEqual(selected.length, 1);
    assert.strictEqual(selected[0]?.id, 'storage');
    assert.strictEqual(selected[0]?.type, 'click', 'the real click event');
    assert.strictEqual(selected[0]?.currentTarget, target, 'its currentTarget is the button, so the caller can find its own scroll root');
    assert.deepEqual(changed, ['storage'], '@onActiveChange still reports');
    assert.strictEqual(active(), 'storage');
    assert.deepEqual(marker(), ['1', `${target.offsetTop}px`, `${target.offsetHeight}px`], 'the marker travels to the clicked button');
    assert.strictEqual(window.location.hash, hashBefore, 'no fragment navigation');
  });

  test('a controlled @activeId in button mode holds still and reports the request', async function (assert) {
    let selected: string[] = [];
    const select = (id: string) => selected.push(id);
    await render(<template><TableOfContents @items={{ITEMS}} @spy={{false}} @links={{false}} @activeId='cupping' @onSelect={{select}} /></template>);
    await click(buttons()[3] as HTMLButtonElement);
    assert.strictEqual(active(), 'cupping', 'the owner decides');
    assert.deepEqual(selected, ['price']);
  });

  test('the item block gets each row’s position, in both modes', async function (assert) {
    await render(
      <template>
        <TableOfContents @items={{ITEMS}} @spy={{false}} @links={{false}}>
          <:item as |item isActive index|><span data-test-numbered>{{index}} {{item.label}}{{if isActive ' ●'}}</span></:item>
        </TableOfContents>
      </template>,
    );
    assert.deepEqual(
      Array.from(nav().querySelectorAll('button [data-test-numbered]')).map((e) => e.textContent),
      ['0 Introduction ●', '1 Cupping notes', '2 Storage', '3 Pricing'],
    );
    await render(
      <template>
        <TableOfContents @items={{ITEMS}} @spy={{false}}>
          <:item as |item isActive index|><span data-test-numbered>{{index}}:{{item.id}}{{if isActive ' ●'}}</span></:item>
        </TableOfContents>
      </template>,
    );
    assert.deepEqual(
      Array.from(nav().querySelectorAll('a [data-test-numbered]')).map((e) => e.textContent),
      ['0:intro ●', '1:cupping', '2:storage', '3:price'],
    );
  });

  test('button mode leaves the spy off unless the caller turns it on', async function (assert) {
    let changed: string[] = [];
    const record = (id: string) => changed.push(id);
    // headings carrying the item ids, the first one inside the read band
    await render(
      <template>
        <TableOfContents @items={{ITEMS}} @links={{false}} @defaultActiveId='price' @onActiveChange={{record}} />
        <h2 id='intro'>Introduction</h2><h3 id='cupping'>Cupping notes</h3><h3 id='storage'>Storage</h3><h2 id='price'>Pricing</h2>
      </template>,
    );
    await frames();
    assert.deepEqual(changed, [], 'no @spy: the ids are only keys, so nothing in the document is observed');
    assert.strictEqual(active(), 'price', 'the seeded row stays current');

    await render(
      <template>
        <TableOfContents @items={{ITEMS}} @links={{false}} @spy={{true}} @defaultActiveId='price' @onActiveChange={{record}} />
        <h2 id='intro'>Introduction</h2><h3 id='cupping'>Cupping notes</h3><h3 id='storage'>Storage</h3><h2 id='price'>Pricing</h2>
      </template>,
    );
    await frames();
    assert.deepEqual(changed, ['intro'], '@spy={{true}} opts back in, and the same headings move the current row');
    assert.strictEqual(active(), 'intro');
  });
});
