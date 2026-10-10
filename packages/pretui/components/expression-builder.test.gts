// Pretui — ExpressionBuilder unit tests.
// The pure composition helpers are asserted in filter-set.test.gts.
//
// Focus travel after add/remove/move is not asserted here; the announcements
// that accompany it are. (Focus does stick in this harness — see form.test.gts
// — so this is a coverage choice, not a harness limit.)
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ExpressionBuilder } from './expression-builder';
import type { ExpressionCondition, ExpressionIssue, ExpressionModel, ExpressionResource } from '../internal/forms-expression';

const RESOURCES: ExpressionResource[] = [
  { value: 'Total', label: 'Total', type: 'currency' },
  { value: '"Approver Email"', label: 'Approver email', type: 'text' },
  { value: 'Budget', label: 'Approved budget', type: 'currency' },
];
const OVER: ExpressionCondition = { id: 'c1', targetPath: 'Total', operator: '>', value: '10000' };
const NO_MAIL: ExpressionCondition = { id: 'c2', targetPath: '"Approver Email"', operator: 'is empty', value: '' };

function builder(): HTMLElement {
  return document.querySelector('[data-test-pretui-expression-builder]') as HTMLElement;
}
function rows(): HTMLElement[] {
  return Array.from(builder().querySelectorAll('[data-test-pretui-expression-row]')) as HTMLElement[];
}
function rowN(n: number): HTMLElement {
  return builder().querySelector(`[data-test-pretui-expression-row="${n}"]`) as HTMLElement;
}
function control(name: string, n: number): HTMLElement | null {
  return builder().querySelector(`[data-test-pretui-expression-${name}="${n}"]`);
}
function has(name: string, n: number): HTMLElement {
  let el = control(name, n);
  if (!el) {
    throw new Error(`expected control ${name} in row ${n}`);
  }
  return el;
}
async function pickOption(wrapper: HTMLElement, text: string) {
  await click(wrapper.querySelector('[data-test-pretui-select-trigger]') as HTMLElement);
  // the listbox renders in the dropdown wormhole, outside the wrapper
  let opt = Array.from(document.querySelectorAll("[role='listbox'] [data-test-pretui-select-option]")).find((o) => o.textContent?.trim() === text) as HTMLElement;
  await click(opt);
}
function announcement(): string | undefined {
  return builder().querySelector('[role="status"]')?.textContent?.trim();
}

module('Pretui | components/expression-builder', function (hooks) {
  setupCardTest(hooks);

  test('starts empty with a warning that nothing composes yet, and an add button', async function (assert) {
    let issues: ExpressionIssue[] | undefined;
    const onIssues = (i: ExpressionIssue[]) => (issues = i);
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @onIssues={{onIssues}} /></template>);
    assert.strictEqual(builder().querySelector('[data-test-pretui-expression-title]')?.textContent?.trim(), 'Conditions');
    assert.strictEqual(rows().length, 0);
    assert.true(builder().querySelector('[data-test-pretui-expression-issues]')?.textContent?.includes('No conditions yet'));
    assert.ok(builder().querySelector('[data-test-pretui-expression-add]'));
    assert.strictEqual(issues, undefined, 'nothing is reported until something changes');
  });

  test('adding a row reports the model and the derived issue, and announces it', async function (assert) {
    let model: ExpressionModel | undefined;
    let issues: ExpressionIssue[] | undefined;
    const onChange = (m: ExpressionModel) => (model = m);
    const onIssues = (i: ExpressionIssue[]) => (issues = i);
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @onChange={{onChange}} @onIssues={{onIssues}} /></template>);
    await click('[data-test-pretui-expression-add]');
    assert.strictEqual(rows().length, 1);
    assert.strictEqual(model?.conditions.length, 1);
    assert.strictEqual(model?.conditions[0]?.targetPath, '', 'a blank row');
    assert.deepEqual(issues?.map((i) => [i.severity, i.message]), [['error', 'Condition 1 has no field selected.']]);
    assert.strictEqual(rowN(1).dataset['invalid'], 'true');
    assert.true(rowN(1).textContent?.includes('has no field selected'), 'the row wears its own message');
    assert.strictEqual(announcement(), 'Condition 1 added. 1 total.');
  });

  test('picking a field seeds the operator from that type; a unary operator hides the value control', async function (assert) {
    let model: ExpressionModel | undefined;
    const onChange = (m: ExpressionModel) => (model = m);
    const START = [{ id: 'c1', targetPath: '', operator: '', value: '' }];
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{START}} @onChange={{onChange}} /></template>);
    await pickOption(has('resource', 1), 'Approver email');
    assert.strictEqual(model?.conditions[0]?.targetPath, '"Approver Email"', 'the BXL path, quoted as the catalogue wrote it');
    assert.strictEqual(model?.conditions[0]?.operator, '=', 'the first operator of the text catalogue');
    assert.ok(control('value', 1), 'a binary operator wants a value');

    await pickOption(has('operator', 1), 'is empty');
    assert.strictEqual(model?.conditions[0]?.operator, 'is empty');
    assert.strictEqual(model?.conditions[0]?.value, '', 'never keep a value under a unary op');
    assert.strictEqual(control('value', 1), null, 'the value column is suppressed');
    assert.strictEqual(rowN(1).dataset['invalid'], undefined, 'the row is complete');
  });

  test('typing a value commits it through the default control', async function (assert) {
    let model: ExpressionModel | undefined;
    const onChange = (m: ExpressionModel) => (model = m);
    const START = [{ id: 'c1', targetPath: 'Total', operator: '>', value: '' }];
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{START}} @onChange={{onChange}} /></template>);
    assert.strictEqual(rowN(1).dataset['invalid'], 'true', 'no value yet');
    let input = has('value', 1);
    await fillIn(input.tagName === 'INPUT' ? input : (input.querySelector('input') as HTMLElement), '10000');
    assert.strictEqual(model?.conditions[0]?.value, '10000');
    assert.strictEqual(rowN(1).dataset['invalid'], undefined);
  });

  test('changing the field keeps the operator only if the new catalogue offers it', async function (assert) {
    let model: ExpressionModel | undefined;
    const onChange = (m: ExpressionModel) => (model = m);
    const START = [{ id: 'c1', targetPath: 'Total', operator: '>', value: '5' }];
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{START}} @onChange={{onChange}} /></template>);
    await pickOption(has('resource', 1), 'Approved budget');
    assert.strictEqual(model?.conditions[0]?.operator, '>', 'currency → currency: the operator is still valid');
    assert.strictEqual(model?.conditions[0]?.value, '5');

    await pickOption(has('resource', 1), 'Approver email');
    assert.strictEqual(model?.conditions[0]?.operator, '=', '"greater than" means nothing for text — reset to the first text operator');
    assert.strictEqual(model?.conditions[0]?.value, '', 'and a stale value is not kept under it');
  });

  test('removes and reorders rows, renumbering the display, never the ids', async function (assert) {
    let model: ExpressionModel | undefined;
    const onChange = (m: ExpressionModel) => (model = m);
    const START = [OVER, NO_MAIL];
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{START}} @onChange={{onChange}} /></template>);
    assert.strictEqual(rows().length, 2);

    await click(has('down', 1));
    assert.deepEqual(model?.conditions.map((c) => c.id), ['c2', 'c1']);
    assert.strictEqual(announcement(), 'Condition moved to position 2 of 2.');

    await click(has('down', 2));
    assert.strictEqual(announcement(), 'Condition 2 is already last.', 'the end-of-list button is never disabled — it explains, so focus stays put');

    await click(has('remove', 1));
    assert.deepEqual(model?.conditions.map((c) => c.id), ['c1']);
    assert.strictEqual(rows().length, 1);
    assert.strictEqual(rowN(1).getAttribute('data-test-pretui-expression-row'), '1', 'the survivor is row 1 now');
    assert.strictEqual(announcement(), 'Condition 1 removed. 1 remaining.');
  });

  test('switching to custom logic seeds it from the joiner, and a bad reference is reported', async function (assert) {
    let model: ExpressionModel | undefined;
    const onChange = (m: ExpressionModel) => (model = m);
    const START = [OVER, NO_MAIL];
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{START}} @onChange={{onChange}} /></template>);
    await pickOption(builder().querySelector('[data-test-pretui-expression-logic]') as HTMLElement, 'Custom logic is met');
    assert.strictEqual(model?.logic, 'custom');
    assert.strictEqual(model?.customLogic, '1 AND 2', 'seeded, so the author edits rather than types from nothing');
    let custom = builder().querySelector('[data-test-pretui-expression-custom]') as HTMLElement;
    let input = custom.tagName === 'INPUT' ? custom : (custom.querySelector('input') as HTMLElement);

    await fillIn(input, '1 AND 3');
    assert.true(builder().querySelector('[data-test-pretui-expression-issues]')?.textContent?.includes('references condition 3, but there are only 2'));
    assert.strictEqual(rowN(2).dataset['unused'], 'true', 'row 2 is stranded and says so');
  });

  test('deleting a row rewrites the custom logic through ids, not arithmetic', async function (assert) {
    let model: ExpressionModel | undefined;
    const onChange = (m: ExpressionModel) => (model = m);
    const START = [OVER, NO_MAIL, { id: 'c3', targetPath: 'Budget', operator: '>', value: '1' }];
    await render(
      <template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{START}} @defaultLogic='custom' @defaultCustomLogic='1 AND (2 OR 3)' @onChange={{onChange}} /></template>,
    );
    await click(has('remove', 2));
    assert.strictEqual(model?.customLogic, '1 AND 2', 'row 3 became row 2 and the emptied group collapsed');
    assert.deepEqual(model?.conditions.map((c) => c.id), ['c1', 'c3']);
  });

  test('"always" hides the rows and composes to nothing to fix', async function (assert) {
    const START = [OVER];
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{START}} @defaultLogic='always' /></template>);
    assert.strictEqual(rows().length, 0);
    assert.strictEqual(builder().querySelector('[data-test-pretui-expression-add]'), null);
    assert.strictEqual(builder().querySelector('[data-test-pretui-expression-issues]'), null);
  });

  test('a controlled model reports the request and stays put; readonly and maxConditions gate the add', async function (assert) {
    let model: ExpressionModel | undefined;
    const onChange = (m: ExpressionModel) => (model = m);
    const HELD = [OVER];
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @conditions={{HELD}} @onChange={{onChange}} /></template>);
    await click('[data-test-pretui-expression-add]');
    assert.strictEqual(model?.conditions.length, 2, 'the owner is told');
    assert.strictEqual(rows().length, 1, 'and decides');

    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{HELD}} @maxConditions={{1}} /></template>);
    assert.true((builder().querySelector('[data-test-pretui-expression-add]') as HTMLButtonElement).disabled);

    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{HELD}} @readonly={{true}} /></template>);
    assert.strictEqual(builder().dataset['readonly'], 'true');
    assert.true((builder().querySelector('[data-test-pretui-expression-add]') as HTMLButtonElement).disabled);
    await settled();
  });

  test('merges caller issues with its own and names things by the caller noun', async function (assert) {
    const START = [OVER];
    const EXTRA: ExpressionIssue[] = [{ severity: 'warning', message: 'This rule duplicates R-4.' }, { severity: 'info', conditionId: 'c1', message: 'Rounded.' }];
    await render(<template><ExpressionBuilder @resources={{RESOURCES}} @defaultConditions={{START}} @issues={{EXTRA}} @conditionNoun='Check' @title='Gates' /></template>);
    assert.strictEqual(builder().querySelector('[data-test-pretui-expression-title]')?.textContent?.trim(), 'Gates');
    assert.true(builder().querySelector('[data-test-pretui-expression-issues]')?.textContent?.includes('duplicates R-4'), 'an expression-level issue goes to the list');
    assert.true(rowN(1).textContent?.includes('Rounded.'), 'a row-addressed issue goes to its row');
    assert.strictEqual(builder().querySelector('ol.xb-rows')?.getAttribute('aria-label'), 'Gates, 1 check', 'the noun is lowercased in running text');
  });
});
