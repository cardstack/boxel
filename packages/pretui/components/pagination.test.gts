// Pretui — Pagination unit tests. Imports from ../structure; when Pagination moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Pagination } from './pagination';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function texts(sel: string): (string | undefined)[] {
  return all(sel).map((e) => e.textContent?.trim());
}

module('Pretui | components/pagination', function (hooks) {
  setupCardTest(hooks);

  test('Pagination is a labelled nav that marks the current page', async function (assert) {
    await render(<template><Pagination @pages={{5}} /></template>);
    let nav = q('[data-test-pretui-pagination]');
    assert.strictEqual(nav.tagName, 'NAV');
    assert.strictEqual(nav.getAttribute('aria-label'), 'Pagination');
    let current = nav.querySelector('[aria-current="page"]') as HTMLElement;
    assert.strictEqual(current.textContent?.trim(), '1', 'page 1 by default');
    assert.strictEqual(current.dataset['state'], 'active');
  });

  test('Pagination disables the arrow at each end rather than hiding it', async function (assert) {
    await render(<template><Pagination @pages={{3}} /></template>);
    let prev = q('[aria-label="Previous"]') as HTMLButtonElement;
    let next = q('[aria-label="Next"]') as HTMLButtonElement;
    // Pinned as shipped (KNOWN GAP): native `disabled` drops Previous out of
    // the tab order at page 1. pagination.md names `aria-disabled` as the
    // one-line fix; when it lands, flip this to aria-disabled="true".
    assert.true(prev.disabled, 'nothing before page 1 — KNOWN GAP: native disabled, not aria-disabled');
    assert.false(next.disabled);

    await click(next);
    await click(next);
    assert.strictEqual(q('[aria-current="page"]').textContent?.trim(), '3');
    assert.true((q('[aria-label="Next"]') as HTMLButtonElement).disabled, 'nothing after the last page');
    assert.false((q('[aria-label="Previous"]') as HTMLButtonElement).disabled);
  });

  test('Pagination elides the middle, keeping the ends and the neighbours of the current page', async function (assert) {
    await render(<template><Pagination @pages={{20}} @defaultPage={{10}} /></template>);
    assert.deepEqual(
      texts('.pretui-page:not([aria-label]), .pretui-gap'),
      ['1', '…', '9', '10', '11', '…', '20'],
      'one gap on each side, never two in a row',
    );
  });

  test('Pagination runs uncontrolled from @defaultPage and reports every move', async function (assert) {
    let seen: number[] = [];
    const record = (n: number) => seen.push(n);
    await render(<template><Pagination @pages={{6}} @defaultPage={{3}} @onPageChange={{record}} /></template>);
    assert.strictEqual(q('[aria-current="page"]').textContent?.trim(), '3');

    await click('[aria-label="Next"]');
    assert.strictEqual(q('[aria-current="page"]').textContent?.trim(), '4', 'it moves itself');
    assert.deepEqual(seen, [4], 'and tells the caller');
  });

  test('Pagination stays put when @page is controlled, but still reports the request', async function (assert) {
    let seen: number[] = [];
    const record = (n: number) => seen.push(n);
    await render(<template><Pagination @pages={{6}} @page={{2}} @onPageChange={{record}} /></template>);

    await click('[aria-label="Next"]');
    assert.strictEqual(
      q('[aria-current="page"]').textContent?.trim(),
      '2',
      'a controlled page does not drift out from under its owner',
    );
    assert.deepEqual(seen, [3], 'the owner is told what was asked for');
  });

  test('Pagination clamps a jump request to the real range', async function (assert) {
    let seen: number[] = [];
    const record = (n: number) => seen.push(n);
    // A controlled page outside the range leaves both arrows enabled, so each
    // press hands go() a value it has to clamp.
    await render(<template><Pagination @pages={{4}} @page={{9}} @onPageChange={{record}} /></template>);
    await click('[aria-label="Next"]');
    await render(<template><Pagination @pages={{4}} @page={{-3}} @onPageChange={{record}} /></template>);
    await click('[aria-label="Previous"]');
    assert.deepEqual(seen, [4, 1], 'never a page that does not exist');
  });
});
