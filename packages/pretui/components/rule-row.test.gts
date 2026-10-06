// Pretui — RuleRow unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { RuleRow } from './rule-row';
import type { ExpressionModel, ExpressionResource, GuideRule } from '../internal/forms-expression';

const RESOURCES: ExpressionResource[] = [
  { value: 'Total', label: 'Total', type: 'currency' },
  { value: 'Budget', label: 'Approved budget', type: 'currency' },
];
const RULE: GuideRule = {
  ruleId: 'R-12',
  label: 'Within budget',
  severity: 'error',
  targetPath: 'Total',
  message: 'Total exceeds the approved budget.',
  expression: 'Total <= Budget',
};
const MODEL: ExpressionModel = {
  logic: 'all',
  customLogic: '',
  conditions: [{ id: 'c1', targetPath: 'Total', operator: '<=', value: 'Budget', valueKind: 'path' }],
};

function row(): HTMLElement {
  return document.querySelector('[data-test-pretui-rule-row]') as HTMLElement;
}
function inputIn(sel: string): HTMLInputElement {
  let el = document.querySelector(sel) as HTMLElement;
  return (el.tagName === 'INPUT' ? el : el.querySelector('input')) as HTMLInputElement;
}
function expression(): HTMLElement {
  return row().querySelector('[data-test-pretui-rule-expression]') as HTMLElement;
}

module('Pretui | components/rule-row', function (hooks) {
  setupCardTest(hooks);

  test('shows the rule id, a not-evaluated status, and every editable part of the rule', async function (assert) {
    const noop = () => {};
    await render(<template><RuleRow @rule={{RULE}} @onChange={{noop}} /></template>);
    assert.strictEqual(row().getAttribute('data-test-pretui-rule-row'), 'R-12');
    assert.strictEqual(row().dataset['severity'], 'error');
    assert.strictEqual(row().dataset['status'], 'unknown', 'nothing here evaluates; a verdict has to be handed in');
    assert.strictEqual(row().querySelector('[data-test-pretui-rule-status]')?.textContent?.trim(), 'Not evaluated');
    assert.strictEqual(row().querySelector('[data-test-pretui-token]')?.textContent?.trim(), 'R-12');
    assert.strictEqual(inputIn('[data-test-pretui-rule-label]').value, 'Within budget');
    assert.strictEqual(inputIn('[data-test-pretui-rule-message]').value, 'Total exceeds the approved budget.');
    assert.strictEqual(inputIn('[data-test-pretui-rule-path]').value, 'Total', 'with no resources the path is free text, so predicate paths stay typable');
    assert.strictEqual(document.querySelector(`label[for="${inputIn('[data-test-pretui-rule-label]').id}"]`)?.textContent?.trim(), 'Rule name');
  });

  test('maps a canned status to its chip label and detail', async function (assert) {
    const noop = () => {};
    await render(<template><RuleRow @rule={{RULE}} @status='fail' @statusDetail='Total is 12,480' @onChange={{noop}} /></template>);
    assert.strictEqual(row().dataset['status'], 'fail');
    assert.strictEqual(row().querySelector('[data-test-pretui-rule-status]')?.textContent?.trim(), 'Failing');
    assert.strictEqual(row().querySelector('.rr-detail')?.textContent?.trim(), 'Total is 12,480');
  });

  test('without a model the expression is shown as authored and never rewritten', async function (assert) {
    let seen: GuideRule[] = [];
    const onChange = (r: GuideRule) => seen.push(r);
    await render(<template><RuleRow @rule={{RULE}} @onChange={{onChange}} /></template>);
    assert.ok(row().querySelector('.rr-nomodel'), 'says why there is no visual editor');
    assert.strictEqual(row().querySelector('[data-test-pretui-expression-builder]'), null);
    assert.strictEqual(expression().textContent?.trim(), 'Total <= Budget');

    await fillIn(inputIn('[data-test-pretui-rule-label]'), 'Stays within budget');
    assert.strictEqual(seen.at(-1)?.label, 'Stays within budget');
    assert.strictEqual(seen.at(-1)?.expression, 'Total <= Budget', 'BXL source is never parsed back and re-composed');
    assert.strictEqual(seen.at(-1)?.ruleId, 'R-12', 'the whole rule comes back, in guide shape');
  });

  test('with a model the builder appears and the composed expression follows it', async function (assert) {
    let seen: [GuideRule, ExpressionModel][] = [];
    const onChange = (r: GuideRule, m: ExpressionModel) => seen.push([r, m]);
    await render(<template><RuleRow @rule={{RULE}} @model={{MODEL}} @resources={{RESOURCES}} @onChange={{onChange}} /></template>);
    assert.ok(row().querySelector('[data-test-pretui-expression-builder]'));
    assert.strictEqual(expression().textContent?.trim(), 'Total <= Budget', 'composed from the model, not copied from rule.expression');
    assert.strictEqual(expression().dataset['empty'], undefined);

    await fillIn(inputIn('[data-test-pretui-rule-message]'), 'Over budget.');
    assert.strictEqual(seen.at(-1)?.[0].message, 'Over budget.');
    assert.strictEqual(seen.at(-1)?.[0].expression, 'Total <= Budget', 'freshly composed on every change');
    assert.deepEqual(seen.at(-1)?.[1], MODEL, 'and the model that produced it travels with it');
  });

  test('an incomplete model composes to nothing and the row says so', async function (assert) {
    const EMPTY: ExpressionModel = { logic: 'all', customLogic: '', conditions: [] };
    const noop = () => {};
    await render(<template><RuleRow @rule={{RULE}} @model={{EMPTY}} @onChange={{noop}} /></template>);
    assert.strictEqual(expression().dataset['empty'], 'true');
    assert.strictEqual(expression().textContent?.trim(), '— the expression is not complete yet —');
  });

  test('offers the target path as a select when resources are known', async function (assert) {
    const noop = () => {};
    await render(<template><RuleRow @rule={{RULE}} @resources={{RESOURCES}} @onChange={{noop}} /></template>);
    assert.ok(document.querySelector('[data-test-pretui-rule-path] .pretui-selecttrigger'), 'a Select, not free text');
    assert.true(document.querySelector('[data-test-pretui-rule-path] .pretui-selecttrigger')?.textContent?.includes('Total'));
  });

  test('shows a remove control only when given a handler, named after the rule', async function (assert) {
    const noop = () => {};
    await render(<template><RuleRow @rule={{RULE}} @onChange={{noop}} /></template>);
    assert.strictEqual(row().querySelector('[data-test-pretui-rule-remove]'), null);

    let removes = 0;
    const onRemove = () => (removes += 1);
    await render(<template><RuleRow @rule={{RULE}} @onChange={{noop}} @onRemove={{onRemove}} /></template>);
    let btn = row().querySelector('[data-test-pretui-rule-remove]') as HTMLButtonElement;
    assert.strictEqual(btn.getAttribute('aria-label'), 'Remove rule Within budget');
    await click(btn);
    assert.strictEqual(removes, 1);
  });

  test('readonly disables every control including remove', async function (assert) {
    const noop = () => {};
    await render(<template><RuleRow @rule={{RULE}} @readonly={{true}} @onChange={{noop}} @onRemove={{noop}} /></template>);
    assert.true(inputIn('[data-test-pretui-rule-label]').disabled);
    assert.true(inputIn('[data-test-pretui-rule-message]').disabled);
    assert.true((row().querySelector('[data-test-pretui-rule-remove]') as HTMLButtonElement).disabled);
  });
});
