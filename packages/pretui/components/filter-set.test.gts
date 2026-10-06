// Pretui — FilterSet unit tests, plus the pure BXL helpers it and the builder
// share (conditionSummary, conditionToBxl, quoteBxlValue, expressionToBxl,
// the custom-logic tokenizer/remap/validator).
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FilterSet } from './filter-set';
import { appendLogicRef, conditionSummary, conditionToBxl, expressionToBxl, newCondition, quoteBxlValue, remapCustomLogic, seedCustomLogic, serializeLogic, tokenizeLogic, validateCustomLogic } from '../internal/forms-expression';
import type { ExpressionCondition, ExpressionResource } from '../internal/forms-expression';

const RESOURCES: ExpressionResource[] = [
  { value: 'Total', label: 'Total', type: 'currency' },
  { value: '"Approver Email"', label: 'Approver email', type: 'text' },
  { value: 'Budget', label: 'Approved budget', type: 'currency' },
];
const OVER: ExpressionCondition = { id: 'c1', targetPath: 'Total', operator: '>', value: '10000' };
const NO_MAIL: ExpressionCondition = { id: 'c2', targetPath: '"Approver Email"', operator: 'is empty', value: '' };
const HALF: ExpressionCondition = { id: 'c3', targetPath: 'Total', operator: '=', value: '' };
const VS_BUDGET: ExpressionCondition = { id: 'c4', targetPath: 'Total', operator: '>', value: 'Budget', valueKind: 'path' };

function set(): HTMLElement {
  return document.querySelector('[data-test-pretui-filter-set]') as HTMLElement;
}
function items(): HTMLElement[] {
  return Array.from(set().querySelectorAll('.fs-item')) as HTMLElement[];
}

module('Pretui | components/filter-set', function (hooks) {
  setupCardTest(hooks);

  // ── pure helpers ────────────────────────────────────────────────────────
  test('conditionSummary reads with field labels, operator prose and quoted literals', function (assert) {
    assert.strictEqual(conditionSummary(OVER, RESOURCES), 'Total greater than “10000”');
    assert.strictEqual(conditionSummary(NO_MAIL, RESOURCES), 'Approver email is empty', 'unary: no value');
    assert.strictEqual(conditionSummary(HALF, RESOURCES), 'Total equals …', 'an unfinished row shows where the value goes');
    assert.strictEqual(conditionSummary(VS_BUDGET, RESOURCES), 'Total greater than Approved budget', 'a field comparison names the other field');
    assert.strictEqual(conditionSummary(newCondition(), RESOURCES), 'New condition');
  });

  test('conditionToBxl composes a row, or nothing when it is not finished', function (assert) {
    assert.strictEqual(conditionToBxl(OVER, RESOURCES), 'Total > 10000', 'a currency literal stays a number');
    assert.strictEqual(conditionToBxl(NO_MAIL, RESOURCES), '("Approver Email" | length) = 0', 'the unary template');
    assert.strictEqual(conditionToBxl(HALF, RESOURCES), '', 'an empty value composes to nothing — fail closed downstream');
    assert.strictEqual(conditionToBxl(VS_BUDGET, RESOURCES), 'Total > Budget', 'a path value goes in verbatim, never quoted');
    assert.strictEqual(conditionToBxl({ ...OVER, operator: 'contains', value: 'x' }, [{ value: 'Total', label: 'Total', type: 'text' }]), 'Total | contains("x")');
  });

  test('quoteBxlValue keeps numbers and booleans literal and JSON-quotes everything else', function (assert) {
    assert.strictEqual(quoteBxlValue('1,000', 'number'), '1000', 'grouping is stripped');
    assert.strictEqual(quoteBxlValue('12x', 'number'), '"12x"', 'an unparseable number is quoted so the failure is visible in the source');
    assert.strictEqual(quoteBxlValue('True', 'boolean'), 'true');
    assert.strictEqual(quoteBxlValue('yes', 'boolean'), '"yes"');
    assert.strictEqual(quoteBxlValue('say "hi"', 'text'), '"say \\"hi\\""', 'a stray quote cannot break out of the string at this layer');
  });

  test('a $-sequence in the value stays literal', function (assert) {
    assert.strictEqual(conditionToBxl({ ...OVER, value: 'a$&b' }, RESOURCES), 'Total > "a$&b"');
    assert.strictEqual(conditionToBxl({ ...OVER, value: 'a$$b' }, RESOURCES), 'Total > "a$$b"', 'and $$ is not collapsed');
  });

  test('expressionToBxl joins rows by the logic, bare when there is one, and always → true', function (assert) {
    assert.strictEqual(expressionToBxl({ logic: 'always', customLogic: '', conditions: [] }), 'true');
    assert.strictEqual(expressionToBxl({ logic: 'all', customLogic: '', conditions: [OVER, NO_MAIL] }, { resources: RESOURCES }), '(Total > 10000) and (("Approver Email" | length) = 0)');
    assert.strictEqual(expressionToBxl({ logic: 'any', customLogic: '', conditions: [OVER, NO_MAIL] }, { resources: RESOURCES }), '(Total > 10000) or (("Approver Email" | length) = 0)');
    assert.strictEqual(expressionToBxl({ logic: 'all', customLogic: '', conditions: [OVER, HALF] }, { resources: RESOURCES }), 'Total > 10000', 'the unfinished row is left out; one row needs no parens');
    assert.strictEqual(expressionToBxl({ logic: 'all', customLogic: '', conditions: [HALF] }, { resources: RESOURCES }), '', 'nothing usable composes to nothing');
    assert.strictEqual(expressionToBxl({ logic: 'all', customLogic: '', conditions: [OVER, NO_MAIL] }, { resources: RESOURCES, and: 'AND' }), '(Total > 10000) AND (("Approver Email" | length) = 0)', 'the keyword is a knob');
  });

  test('expressionToBxl honours custom logic and refuses to compose a weaker rule than authored', function (assert) {
    assert.strictEqual(
      expressionToBxl({ logic: 'custom', customLogic: '1 AND NOT 2', conditions: [OVER, NO_MAIL] }, { resources: RESOURCES }),
      '(Total > 10000) and not (("Approver Email" | length) = 0)',
    );
    assert.strictEqual(
      expressionToBxl({ logic: 'custom', customLogic: '1 AND 2', conditions: [OVER, HALF] }, { resources: RESOURCES }),
      '',
      'a reference to an unfinished row cannot be silently dropped — that would compose a rule that means less',
    );
    assert.strictEqual(expressionToBxl({ logic: 'custom', customLogic: '', conditions: [OVER] }), '');
  });

  test('the custom-logic tokenizer round-trips with canonical spacing', function (assert) {
    let tokens = tokenizeLogic('1 and(2  OR 3)');
    assert.deepEqual(tokens.map((t) => t.kind), ['ref', 'op', 'open', 'ref', 'op', 'ref', 'close']);
    assert.strictEqual(serializeLogic(tokens), '1 and (2 OR 3)', 'operator casing survives; spacing is regenerated');
    assert.strictEqual(tokenizeLogic('1 XOR 2').find((t) => t.kind === 'other')?.text, 'XOR', 'unknown words are kept for the validator to point at');
  });

  test('seedCustomLogic and appendLogicRef build on the joiner already in use', function (assert) {
    assert.strictEqual(seedCustomLogic(3, 'all'), '1 AND 2 AND 3');
    assert.strictEqual(seedCustomLogic(2, 'any'), '1 OR 2');
    assert.strictEqual(seedCustomLogic(0, 'all'), '');
    assert.strictEqual(appendLogicRef('1 OR 2', 3), '1 OR 2 OR 3', 'reuses the last joiner seen');
    assert.strictEqual(appendLogicRef('', 1), '1');
  });

  test('remapCustomLogic renumbers through ids and repairs the structure a deletion breaks', function (assert) {
    // rows [a, b, c] → b deleted → a=1, c=2
    const dropSecond = (n: number) => (n === 1 ? 1 : n === 2 ? null : n === 3 ? 2 : n);
    assert.strictEqual(remapCustomLogic('1 AND 2 AND 3', dropSecond), '1 AND 2');
    assert.strictEqual(remapCustomLogic('1 AND (2 OR 3)', dropSecond), '1 AND 2', 'the emptied group collapses');
    assert.strictEqual(remapCustomLogic('2 AND 1', dropSecond), '1', 'the operator goes with the reference');
    assert.strictEqual(remapCustomLogic('1 AND NOT 2', dropSecond), '1', 'a prefix NOT goes with it too');
    // a move: [a, b] → [b, a]
    const swap = (n: number) => (n === 1 ? 2 : 1);
    assert.strictEqual(remapCustomLogic('1 AND NOT 2', swap), '2 AND NOT 1');
    assert.strictEqual(remapCustomLogic('1 AND 9', (n) => n), '1 AND 9', 'an unknown reference is left for the validator, never deleted');
  });

  test('validateCustomLogic reports grammar, range and unused rows without ever editing', function (assert) {
    assert.deepEqual(validateCustomLogic('', 2).map((i) => i.severity), ['error'], 'empty with rows is an error');
    assert.deepEqual(validateCustomLogic('', 0), [], 'empty with no rows is nothing');
    assert.true(validateCustomLogic('1 AND', 1).some((i) => i.message.includes('incomplete')));
    assert.true(validateCustomLogic('(1 AND 2', 2).some((i) => i.message.includes('closing')));
    assert.true(validateCustomLogic('1 AND 2)', 2).some((i) => i.message.includes('unmatched')));
    assert.true(validateCustomLogic('1 AND 3', 2).some((i) => i.message.includes('references condition 3')));
    assert.true(validateCustomLogic('1 XOR 2', 2).some((i) => i.message.includes('“XOR” is not valid')));
    let unused = validateCustomLogic('1', 2);
    assert.deepEqual(unused.map((i) => [i.severity, i.message]), [['warning', 'Condition 2 is not used by the custom logic and will be ignored.']]);
    assert.deepEqual(validateCustomLogic('1 AND (2 OR NOT 3)', 3), [], 'a well-formed string is clean');
  });

  // ── the component ───────────────────────────────────────────────────────
  test('lists each condition as prose with a joiner between, not before the first', async function (assert) {
    const ROWS = [OVER, NO_MAIL];
    await render(<template><FilterSet @conditions={{ROWS}} @resources={{RESOURCES}} /></template>);
    assert.strictEqual(set().querySelector('.fs-title')?.textContent?.trim(), 'Conditions');
    assert.strictEqual(set().querySelector('.fs-list')?.getAttribute('aria-label'), 'Conditions, 2 in total, all must be met');
    assert.deepEqual(items().map((i) => i.querySelector('.fs-summary')?.textContent?.trim()), ['Total greater than “10000”', 'Approver email is empty']);
    assert.deepEqual(items().map((i) => i.querySelector('.fs-joiner')?.textContent?.trim()), [undefined, 'AND']);
    assert.strictEqual(items()[1]?.querySelector('.fs-joiner')?.getAttribute('aria-hidden'), 'true', 'the list label already said "all"');
  });

  test('says OR for any-logic, echoes custom logic as a Token, and collapses always', async function (assert) {
    const ROWS = [OVER, NO_MAIL];
    await render(<template><FilterSet @conditions={{ROWS}} @logic='any' @resources={{RESOURCES}} /></template>);
    assert.strictEqual(items()[1]?.querySelector('.fs-joiner')?.textContent?.trim(), 'OR');
    assert.true(set().querySelector('.fs-list')?.getAttribute('aria-label')?.includes('any must be met'));

    await render(<template><FilterSet @conditions={{ROWS}} @logic='custom' @customLogic='1 AND NOT 2' @resources={{RESOURCES}} /></template>);
    assert.strictEqual(set().querySelector('.fs-custom [data-test-pretui-token]')?.textContent?.trim(), '1 AND NOT 2');
    assert.true(set().querySelector('.fs-list')?.getAttribute('aria-label')?.includes('combined by custom logic 1 AND NOT 2'));

    await render(<template><FilterSet @conditions={{ROWS}} @logic='always' /></template>);
    assert.strictEqual(set().querySelector('.fs-list'), null);
    assert.strictEqual(set().querySelector('.fs-always')?.textContent?.trim(), 'No conditions — this always applies.');
  });

  test('marks the active row and the rows that cannot compose yet', async function (assert) {
    const ROWS = [OVER, HALF];
    await render(<template><FilterSet @conditions={{ROWS}} @resources={{RESOURCES}} @activeId='c3' /></template>);
    assert.deepEqual(items().map((i) => i.dataset['active']), [undefined, 'true']);
    assert.deepEqual(items().map((i) => i.dataset['incomplete']), [undefined, 'true']);
  });

  test('offers edit, remove and add only when given handlers, naming each by the row it acts on', async function (assert) {
    const ROWS = [OVER, NO_MAIL];
    await render(<template><FilterSet @conditions={{ROWS}} @resources={{RESOURCES}} /></template>);
    assert.strictEqual(set().querySelectorAll('button').length, 0, 'read-only by default');

    let edited: string[] = [];
    let removed: string[] = [];
    let adds = 0;
    const onEdit = (id: string) => edited.push(id);
    const onRemove = (id: string) => removed.push(id);
    const onAdd = () => (adds += 1);
    await render(
      <template><FilterSet @conditions={{ROWS}} @resources={{RESOURCES}} @onEdit={{onEdit}} @onRemove={{onRemove}} @onAdd={{onAdd}} /></template>,
    );
    let edit2 = set().querySelector('[data-test-pretui-filter-edit="2"]') as HTMLButtonElement;
    assert.strictEqual(edit2.getAttribute('aria-label'), 'Edit condition 2, Approver email is empty');
    await click(edit2);
    await click(set().querySelector('[data-test-pretui-filter-remove="1"]') as HTMLElement);
    await click(set().querySelector('[data-test-pretui-filter-add]') as HTMLElement);
    assert.deepEqual(edited, ['c2'], 'the id, not the number — rows renumber');
    assert.deepEqual(removed, ['c1']);
    assert.strictEqual(adds, 1);
  });

  test('renders a footer block beside the add button, or alone', async function (assert) {
    const ROWS = [OVER];
    await render(<template><FilterSet @conditions={{ROWS}}><:footer><span data-test-foot>hint</span></:footer></FilterSet></template>);
    assert.ok(set().querySelector('.fs-foot [data-test-foot]'));
  });
});
