// Pretui — Thinking unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Thinking } from './thinking';
import type { ThinkingRow } from './thinking';

const ROWS: ThinkingRow[] = [
  { id: 'r1', primary: 'Read the listing', state: 'done', secondary: 'listing.gts', mono: true },
  { id: 'r2', primary: 'Edit the price field', state: 'running', add: 4, del: 1 },
  { id: 'r3', primary: 'The margin looks thin for a spring lot.', wrap: true },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-thinking]') as HTMLElement;
}
function toggle(): HTMLButtonElement {
  return root().querySelector('[data-test-pretui-thinking-toggle]') as HTMLButtonElement;
}
function disclosure(): HTMLElement {
  return root().querySelector('[data-test-pretui-disclosure]') as HTMLElement;
}
function rows(): HTMLElement[] {
  return Array.from(root().querySelectorAll('.pretui-trace-row:not([data-kind="query"])')) as HTMLElement[];
}

module('Pretui | components/thinking', function (hooks) {
  setupCardTest(hooks);

  test('a settled trace is collapsed under its done label', async function (assert) {
    await render(<template><Thinking @rows={{ROWS}} @doneLabel='Thought for 4 seconds' /></template>);
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(toggle().textContent?.trim(), 'Thought for 4 seconds');
    assert.strictEqual(toggle().dataset['working'], undefined);
    assert.strictEqual(disclosure().dataset['open'], undefined);
    assert.true(disclosure().inert, 'a closed panel is out of the tab order, not merely invisible');
    assert.strictEqual(document.getElementById(toggle().getAttribute('aria-controls') as string), disclosure());
    assert.strictEqual(root().querySelector('[role="status"]')?.textContent?.trim(), 'Thought for 4 seconds');
  });

  test('while working it shimmers, opens by default, and the live region says so', async function (assert) {
    await render(<template><Thinking @rows={{ROWS}} @working={{true}} /></template>);
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true', 'a trace in progress is worth watching');
    assert.strictEqual(toggle().dataset['working'], 'true');
    assert.strictEqual((toggle().querySelector('.pretui-trace-label') as HTMLElement).dataset['shimmer'], 'true');
    assert.strictEqual(toggle().textContent?.trim(), 'Thinking');
    assert.strictEqual(disclosure().dataset['open'], 'true');
    assert.false(disclosure().inert);
    assert.strictEqual(root().querySelector('[role="status"]')?.textContent?.trim(), 'Thinking');
  });

  test('renders each row by state with a staggered delay, and pins the query above them', async function (assert) {
    await render(<template><Thinking @rows={{ROWS}} @query='spring lots over budget' @defaultExpanded={{true}} /></template>);
    let query = root().querySelector('[data-kind="query"]') as HTMLElement;
    assert.strictEqual(query.querySelector('.pretui-trace-primary')?.textContent?.trim(), 'spring lots over budget');
    assert.strictEqual(rows().length, 3);
    assert.ok(rows()[0]?.querySelector('.pretui-trace-check'), 'done shows a check');
    assert.ok(rows()[1]?.querySelector('[data-test-pretui-spinner]'), 'running spins');
    assert.deepEqual(rows().map((r) => r.getAttribute('style')), ['--pretui-trace-delay: 0ms', '--pretui-trace-delay: 90ms', '--pretui-trace-delay: 180ms']);
    assert.true(rows()[1]?.textContent?.includes('+4'), 'added lines');
    assert.true(rows()[1]?.textContent?.includes('−1'), 'removed lines, with a real minus sign');
    assert.true(rows()[0]?.textContent?.includes('listing.gts'));
    assert.deepEqual(
      rows().map((r) => r.querySelector('.pretui-trace-primary')?.textContent?.trim()),
      ['Read the listing', 'Edit the price field', 'The margin looks thin for a spring lot.'],
    );
  });

  test('toggles, reports each move, and a controlled @expanded holds still', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><Thinking @rows={{ROWS}} @onExpandedChange={{record}} /></template>);
    await click(toggle());
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true');
    assert.strictEqual(disclosure().dataset['open'], 'true');
    await click(toggle());
    assert.deepEqual(seen, [true, false]);

    await render(<template><Thinking @rows={{ROWS}} @expanded={{false}} @onExpandedChange={{record}} /></template>);
    await click(toggle());
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false', 'the owner decides');
    assert.deepEqual(seen.at(-1), true);
  });

  test('appends the default block inside the rail', async function (assert) {
    await render(<template><Thinking @rows={{ROWS}} @defaultExpanded={{true}}><span data-test-extra>more</span></Thinking></template>);
    assert.ok(root().querySelector('.pretui-trace-rail [data-test-extra]'));
  });
});
