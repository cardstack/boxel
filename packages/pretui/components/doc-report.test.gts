// Pretui — DocReport unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DocReport } from './doc-report';
import type { DocCard } from './doc-report';

const CARDS: DocCard[] = [
  { id: 'c1', label: 'Wuyi Origins', summary: 'Account · Fujian' },
  { id: 'c2', label: 'Spring cupping' },
];
const META = ['12 sources', '3 min read'];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-doc-report]') as HTMLElement;
}
function toggle(): HTMLButtonElement {
  return root().querySelector('[data-test-pretui-doc-report-toggle]') as HTMLButtonElement;
}

module('Pretui | components/doc-report', function (hooks) {
  setupCardTest(hooks);

  test('is an article with an eyebrow, title, machine-value facts and a clipped body', async function (assert) {
    await render(
      <template>
        <DocReport @title='Spring lot pricing' @eyebrow='Research · 12 sources' @meta={{META}}>
          <:default><p data-test-body>The market is thin.</p></:default>
          <:actions><button type='button' data-test-act>Share</button></:actions>
        </DocReport>
      </template>,
    );
    assert.strictEqual(root().tagName, 'ARTICLE');
    assert.strictEqual(root().querySelector('.pretui-doc-eyebrow')?.textContent?.trim(), 'Research · 12 sources');
    assert.strictEqual(root().querySelector('.pretui-doc-title')?.textContent?.trim(), 'Spring lot pricing');
    let facts = root().querySelector('.pretui-doc-meta') as HTMLElement;
    assert.strictEqual(facts.getAttribute('aria-label'), 'Report facts');
    assert.deepEqual(Array.from(facts.querySelectorAll('code')).map((c) => c.textContent), ['12 sources', '3 min read'], 'facts are set as machine values');
    assert.ok(root().querySelector('.pretui-doc-clip [data-test-pretui-prose] [data-test-body]'), 'the body is Prose');
    assert.ok(root().querySelector('.pretui-doc-head [data-test-act]'));
    assert.strictEqual(root().dataset['expanded'], undefined);
    assert.strictEqual(toggle().textContent?.trim(), 'Full report');
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(document.getElementById(toggle().getAttribute('aria-controls') as string), root().querySelector('.pretui-doc-clip'));
  });

  test('expands and collapses, renaming the toggle and reporting each move', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><DocReport @title='t' @onExpandedChange={{record}} @collapseLabel='Less'>body</DocReport></template>);
    await click(toggle());
    assert.strictEqual(root().dataset['expanded'], 'true');
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true', 'the a11y attribute follows, not only the styling hook');
    assert.strictEqual(toggle().textContent?.trim(), 'Less');
    await click(toggle());
    assert.deepEqual(seen, [true, false]);
  });

  test('a controlled @expanded holds still and reports', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><DocReport @title='t' @expanded={{true}} @onExpandedChange={{record}}>body</DocReport></template>);
    await click(toggle());
    assert.strictEqual(root().dataset['expanded'], 'true', 'the owner decides');
    assert.deepEqual(seen, [false]);
  });

  test('lists the cited cards as named pills that open on click', async function (assert) {
    let opened: string[] = [];
    const onOpenCard = (c: DocCard) => opened.push(c.id);
    await render(<template><DocReport @title='t' @cards={{CARDS}} @onOpenCard={{onOpenCard}}>body</DocReport></template>);
    let list = root().querySelector('.pretui-doc-pills') as HTMLElement;
    assert.strictEqual(list.getAttribute('aria-label'), 'Cards cited');
    let pills = Array.from(list.querySelectorAll('[data-test-pretui-doc-report-pill]')) as HTMLButtonElement[];
    assert.deepEqual(pills.map((p) => p.textContent?.trim()), ['Wuyi Origins', 'Spring cupping']);
    await click(pills[1] as HTMLElement);
    assert.deepEqual(opened, ['c2']);
    assert.strictEqual(list.querySelectorAll('[data-test-pretui-tooltip]').length, 2, 'each pill previews on hover AND focus');
  });
});
