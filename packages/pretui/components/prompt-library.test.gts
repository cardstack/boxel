// Pretui — PromptLibrary unit tests. Imports from ../agentic-shelf; when PromptLibrary moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PromptLibrary } from './prompt-library';
import type { PromptTemplate } from './prompt-library';

const PROMPTS: PromptTemplate[] = [
  { id: 'p1', title: 'Summarise the lot', body: 'Give me the cupping notes in three lines.', category: 'Research', tags: ['cupping'] },
  { id: 'p2', title: 'Draft a reply', body: 'Write a polite reply to the supplier.', category: 'Writing' },
  { id: 'p3', title: 'Price check', body: 'Compare against the approved budget.', category: 'Research', tags: ['budget', 'finance'] },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-prompt-library]') as HTMLElement;
}
function titles(): string[] {
  return Array.from(root().querySelectorAll('.pretui-plib-card-title')).map((t) => t.textContent?.trim() as string);
}
/** The hook is forwarded onto the <input> itself. */
function search(): HTMLInputElement {
  let el = root().querySelector('[data-test-pretui-prompt-library-search]') as HTMLElement;
  if (el.tagName !== 'INPUT') throw new Error(`search hook is on a ${el.tagName}, not the input`);
  return el as HTMLInputElement;
}
function categoryRadios(): HTMLInputElement[] {
  return Array.from(root().querySelectorAll('[data-test-pretui-prompt-library-categories] input[type="radio"]')) as HTMLInputElement[];
}
function count(): string | undefined {
  return root().querySelector('.pretui-plib-count')?.textContent?.trim();
}

module('Pretui | components/prompt-library', function (hooks) {
  setupCardTest(hooks);

  test('shows every prompt with a derived category filter and a live result count', async function (assert) {
    await render(<template><PromptLibrary @prompts={{PROMPTS}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Prompt library');
    assert.deepEqual(titles(), ['Summarise the lot', 'Draft a reply', 'Price check']);
    assert.strictEqual(count(), '3 prompts');
    assert.strictEqual(root().querySelector('.pretui-plib-count')?.getAttribute('role'), 'status');
    assert.deepEqual(categoryRadios().map((r) => r.value), ['all', 'Research', 'Writing'], 'All plus every category in first-seen order — no second list to keep in sync');
    assert.true(categoryRadios()[0]?.checked);
    assert.deepEqual(Array.from(root().querySelectorAll('.pretui-plib-card')[2]?.querySelectorAll('[data-test-pretui-chip]') ?? []).map((c) => c.textContent?.trim()), ['budget', 'finance']);
    assert.strictEqual(root().querySelector('[data-test-pretui-prompt-library-copy]'), null, 'no copy without a handler');
  });

  test('filters by category and by a case-insensitive search over title, body and tags', async function (assert) {
    let cats: string[] = [];
    let queries: string[] = [];
    const onCategoryChange = (c: string) => cats.push(c);
    const onQueryChange = (q: string) => queries.push(q);
    await render(<template><PromptLibrary @prompts={{PROMPTS}} @onCategoryChange={{onCategoryChange}} @onQueryChange={{onQueryChange}} /></template>);
    await click(categoryRadios()[1] as HTMLElement);
    assert.deepEqual(cats, ['Research']);
    assert.deepEqual(titles(), ['Summarise the lot', 'Price check']);
    assert.strictEqual(count(), '2 prompts');

    await fillIn(search(), 'FINANCE');
    assert.deepEqual(queries, ['FINANCE']);
    assert.deepEqual(titles(), ['Price check'], 'matched on a tag, within the category');
    assert.strictEqual(count(), '1 prompt');
  });

  test('an empty result shows an EmptyState with the caller wording', async function (assert) {
    await render(<template><PromptLibrary @prompts={{PROMPTS}} @emptyMessage='Try a shorter search.' /></template>);
    await fillIn(search(), 'zebra');
    assert.deepEqual(titles(), []);
    assert.true(root().querySelector('[data-test-pretui-empty]')?.textContent?.includes('Try a shorter search.'));
    assert.strictEqual(count(), '0 prompts');
  });

  test('Use and Copy report the prompt; labels are caller-settable', async function (assert) {
    let used: string[] = [];
    let copied: string[] = [];
    const onUse = (p: PromptTemplate) => used.push(p.id);
    const onCopy = (p: PromptTemplate) => copied.push(p.id);
    await render(<template><PromptLibrary @prompts={{PROMPTS}} @onUse={{onUse}} @onCopy={{onCopy}} @useLabel='Insert' @title='Shelf' /></template>);
    assert.strictEqual(root().querySelector('.pretui-plib-title')?.textContent?.trim(), 'Shelf');
    let uses = Array.from(root().querySelectorAll('[data-test-pretui-prompt-library-use]')) as HTMLButtonElement[];
    assert.strictEqual(uses[0]?.textContent?.trim(), 'Insert');
    await click(uses[1] as HTMLElement);
    let copies = Array.from(root().querySelectorAll('[data-test-pretui-prompt-library-copy]')) as HTMLButtonElement[];
    assert.strictEqual(copies[2]?.getAttribute('aria-label'), 'Copy prompt: Price check');
    await click(copies[2] as HTMLElement);
    assert.deepEqual(used, ['p2']);
    assert.deepEqual(copied, ['p3']);
  });

  test('controlled query and category hold still and report', async function (assert) {
    let cats: string[] = [];
    const onCategoryChange = (c: string) => cats.push(c);
    await render(<template><PromptLibrary @prompts={{PROMPTS}} @category='Writing' @query='' @onCategoryChange={{onCategoryChange}} /></template>);
    assert.deepEqual(titles(), ['Draft a reply']);
    await click(categoryRadios()[0] as HTMLElement);
    assert.deepEqual(cats, ['all']);
    assert.deepEqual(titles(), ['Draft a reply'], 'the owner decides');
  });

  test('hides the category filter when nothing is categorised', async function (assert) {
    const FLAT: PromptTemplate[] = [{ id: 'x', title: 'One', body: 'b' }];
    await render(<template><PromptLibrary @prompts={{FLAT}} /></template>);
    assert.strictEqual(root().querySelector('[data-test-pretui-prompt-library-categories]'), null);
  });
});
