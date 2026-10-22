// Pretui — TaskRow unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { TaskRow } from './task-row';
import type { TaskRowDetail } from './task-row';

const DETAILS: TaskRowDetail[] = [
  { id: 'd1', label: 'Rows matched', meta: '7' },
  { id: 'd2', label: 'Rows written', meta: '7' },
];

function row(): HTMLElement {
  return document.querySelector('[data-test-pretui-task-row]') as HTMLElement;
}
function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-test-pretui-task-row]')) as HTMLElement[];
}
function toggle(): HTMLButtonElement | null {
  return row().querySelector('[data-test-pretui-task-row-toggle]');
}

module('Pretui | components/task-row', function (hooks) {
  setupCardTest(hooks);

  test('is never colour alone: each state carries a glyph or the queue position AND a word', async function (assert) {
    await render(
      <template>
        <TaskRow @label='a' @index={{1}} />
        <TaskRow @label='b' @index={{2}} @state='running' />
        <TaskRow @label='c' @state='completed' />
        <TaskRow @label='d' @state='failed' @statusText='Realm returned 403' />
      </template>,
    );
    assert.deepEqual(rows().map((r) => r.dataset['state']), ['pending', 'running', 'completed', 'failed']);
    assert.deepEqual(rows().map((r) => r.querySelector('.pill')?.textContent?.trim()), ['Queued', 'Running', 'Completed', 'Realm returned 403']);
    assert.deepEqual(rows().slice(0, 2).map((r) => r.querySelector('.index')?.textContent?.trim()), ['1', '2'], 'the position sits inside the ring');
    assert.ok(rows()[1]?.querySelector('.ring-arc'), 'running adds the moving arc');
    assert.strictEqual((rows()[2]?.querySelector('.disc') as HTMLElement).dataset['tone'], 'ok');
    assert.strictEqual((rows()[3]?.querySelector('.disc') as HTMLElement).dataset['tone'], 'bad');
  });

  test('without details the head is static — no button, no disclosure', async function (assert) {
    await render(<template><TaskRow @label='Sync' @amount='7 SKUs' /></template>);
    assert.strictEqual(toggle(), null);
    assert.strictEqual((row().querySelector('.pretui-taskrow-head') as HTMLElement).dataset['static'], 'true');
    assert.strictEqual(row().querySelector('[data-test-pretui-disclosure]'), null);
    assert.strictEqual(row().querySelector('.amount')?.textContent?.trim(), '7 SKUs');
    assert.strictEqual(row().querySelector('.index')?.textContent?.trim(), '', 'blank, never "undefined"');
  });

  test('with details the head becomes a disclosure toggle over a definition list', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><TaskRow @label='Sync' @details={{DETAILS}} @onOpenChange={{record}}><span data-test-extra>log</span></TaskRow></template>);
    let t = toggle() as HTMLButtonElement;
    assert.strictEqual(t.getAttribute('aria-expanded'), 'false');
    let panel = document.getElementById(t.getAttribute('aria-controls') as string) as HTMLElement;
    assert.true(panel.inert, 'closed receipts are out of the tab order');
    assert.deepEqual(Array.from(row().querySelectorAll('dt')).map((d) => d.textContent?.trim()), ['Rows matched', 'Rows written']);
    assert.deepEqual(Array.from(row().querySelectorAll('dd')).map((d) => d.textContent?.trim()), ['7', '7']);
    assert.ok(row().querySelector('.pretui-taskrow-body [data-test-extra]'));

    await click(t);
    assert.strictEqual(t.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(row().dataset['open'], 'true');
    assert.false(panel.inert);
    assert.deepEqual(seen, [true]);
  });

  test('seeds from @defaultOpen; a controlled @open holds still; @flat drops the capsule', async function (assert) {
    await render(<template><TaskRow @label='Sync' @details={{DETAILS}} @defaultOpen={{true}} @flat={{true}} /></template>);
    assert.strictEqual(toggle()?.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(row().dataset['flat'], 'true');

    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><TaskRow @label='Sync' @details={{DETAILS}} @open={{false}} @onOpenChange={{record}} /></template>);
    await click(toggle() as HTMLElement);
    assert.strictEqual(toggle()?.getAttribute('aria-expanded'), 'false', 'the owner decides');
    assert.deepEqual(seen, [true]);
  });
});
