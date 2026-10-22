// Pretui — ExpressionBuilder usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { FreestyleUsage } from './freestyle-usage';
import { Input } from './input';
import { Select } from './select';
import { NumberInput } from './number-input';
import { ExpressionBuilder } from './expression-builder';
import { expressionToBxl } from '../internal/forms-expression';
import type { ExpressionValueContext } from './expression-builder';
import type { ExpressionCondition, ExpressionLogic, ExpressionModel } from '../internal/forms-expression';
import { LOGIC_KNOB, REQUEST_RESOURCES, condition } from '../demo-forms-expression';

// ── ExpressionBuilder ← SLDS expression/base + expression/custom-logic ────
//
// Dropped upstream knobs: `optionSelected` with a `formula` option (the
// rich-text formula editor is not ported — Law 9, no vendored engines);
// `isGroup` / `groupName` (nested condition groups — parentheses in custom
// logic express the same thing over one flat, remappable row list);
// `resourceIsSelected` / `inputIsDisabled` / `buttonIsDisabled` (SLDS's static
// snapshot switches; here those states follow from the data);
// `placeholderText` as a global prop (each column carries its own).
class ExpressionBuilderUsage extends Component {
  logicOptions = LOGIC_KNOB;
  resources = REQUEST_RESOURCES;

  @tracked conditions: ExpressionCondition[] = [
    condition('Total', '>', '10000'),
    condition('"Approver Email"', 'is empty', ''),
    condition('Stage', '=', 'Negotiation'),
  ];
  @tracked logic: ExpressionLogic = 'custom';
  @tracked customLogic = '1 AND (2 OR 3)';
  @tracked readonly = false;
  @tracked allowFieldComparison = true;
  @tracked conditionNoun = 'Condition';
  @tracked titleText = 'Escalation conditions';

  setLogic = (v: string) => (this.logic = v as ExpressionLogic);
  setCustomLogic = (v: string) => (this.customLogic = v);
  setReadonly = (v: boolean) => (this.readonly = v);
  setAllowField = (v: boolean) => (this.allowFieldComparison = v);
  setNoun = (v: string) => (this.conditionNoun = v || 'Condition');
  setTitle = (v: string) => (this.titleText = v);

  onChange = (model: ExpressionModel) => {
    this.conditions = model.conditions;
    this.logic = model.logic;
    this.customLogic = model.customLogic;
  };

  get model(): ExpressionModel {
    return {
      logic: this.logic,
      customLogic: this.customLogic,
      conditions: this.conditions,
    };
  }
  get composed() {
    return (
      expressionToBxl(this.model, { resources: this.resources }) ||
      '(not composable yet)'
    );
  }
  get usage() {
    let bits = [
      '@conditions={{this.conditions}}',
      `@logic='${this.logic}'`,
      `@customLogic='${this.customLogic}'`,
      '@resources={{this.resources}}',
    ];
    if (this.allowFieldComparison) {
      bits.push('@allowFieldComparison={{true}}');
    }
    if (this.readonly) {
      bits.push('@readonly={{true}}');
    }
    bits.push('@onChange={{this.onChange}}');
    return `<ExpressionBuilder\n  ${bits.join('\n  ')}\n>\n  <:value as |ctx|>…typed control per ctx.resource.type…</:value>\n</ExpressionBuilder>`;
  }

  // The value control varies by operator AND by field type — which is exactly
  // why the builder yields it rather than taking a string prop (Law 7).
  isPicklist = (ctx: ExpressionValueContext) =>
    ctx.resource?.type === 'picklist' || ctx.resource?.type === 'boolean';
  isNumeric = (ctx: ExpressionValueContext) =>
    ctx.resource?.type === 'number' || ctx.resource?.type === 'currency';
  isDate = (ctx: ExpressionValueContext) => ctx.resource?.type === 'date';
  numberOf = (raw: string) => {
    let n = Number(raw);
    return raw === '' || Number.isNaN(n) ? null : n;
  };
  commitNumber = (ctx: ExpressionValueContext, value: number | null) => {
    ctx.setValue(value === null ? '' : String(value));
  };

  <template>
    <FreestyleUsage
      @name='ExpressionBuilder'
      @description='The condition-row editor behind every rule, filter and trigger — a list of (field, operator, value) rows joined by all / any / custom logic. Reach for it wherever a person authors a predicate as data rather than as code: BXL guide validation rules, list-view filters, approval routing, alert triggers. It composes Select, Input, Button, IconButton, ButtonGroup, Menu and Chip, and takes the value control as a named block because the right-hand side varies by operator AND by field type. Honest limits: it never evaluates anything (it emits a BXL string for someone else to run, fail-closed), it has no nested condition groups (parentheses in custom logic cover the same ground over a flat, remappable list), and BXL source is never parsed back into rows.'
      @source={{this.usage}}
    >
      <:example>
        <ExpressionBuilder
          @conditions={{this.conditions}}
          @logic={{this.logic}}
          @customLogic={{this.customLogic}}
          @resources={{this.resources}}
          @title={{this.titleText}}
          @conditionNoun={{this.conditionNoun}}
          @allowFieldComparison={{this.allowFieldComparison}}
          @readonly={{this.readonly}}
          @onChange={{this.onChange}}
        >
          <:value as |ctx|>
            {{#if (this.isPicklist ctx)}}
              <Select
                @options={{ctx.options}}
                @value={{ctx.condition.value}}
                @controlId={{ctx.controlId}}
                @placeholder='Choose…'
                @disabled={{ctx.disabled}}
                @onValueChange={{ctx.setValue}}
              />
            {{else if (this.isNumeric ctx)}}
              <NumberInput
                @value={{this.numberOf ctx.condition.value}}
                @controlId={{ctx.controlId}}
                @disabled={{ctx.disabled}}
                @onInput={{fn this.commitNumber ctx}}
              />
            {{else}}
              <Input
                @value={{ctx.condition.value}}
                @controlId={{ctx.controlId}}
                @type={{if (this.isDate ctx) 'date' 'text'}}
                @placeholder='Value'
                @disabled={{ctx.disabled}}
                @onInput={{ctx.setValue}}
              />
            {{/if}}
          </:value>
        </ExpressionBuilder>

        <p class='pretui-demo-readout' data-test-xb-readout>
          composed →
          <code>{{this.composed}}</code>
        </p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='conditions'
          @value={{this.conditions}}
          @description='Controlled row list. Each row is { id, targetPath, operator, value, valueKind? }. id is stable for the life of the edit session and is what custom-logic references are remapped through — the display number is only ever derived from array position. Seed @defaultConditions instead for the uncontrolled path.'
        />
        <Args.String
          @name='logic'
          @defaultValue='all'
          @value={{this.logic}}
          @options={{this.logicOptions}}
          @description="How the rows combine. all/any join with AND/OR; custom hands the joiner over to a row-number string; always drops the rows entirely and composes to true. Switching to custom seeds the string from the current joiner when it is empty."
          @onInput={{this.setLogic}}
        />
        <Args.String
          @name='customLogic'
          @value={{this.customLogic}}
          @description='The row-number logic, e.g. 1 AND (2 OR 3). NOT is allowed. Delete row 2 and watch it rewrite itself: references are remapped from stable row ids, the orphaned operator goes with the deleted row, empty groups collapse, and anything that still does not parse is reported rather than silently repaired.'
          @onInput={{this.setCustomLogic}}
        />
        <Args.Object
          @name='resources'
          @value={{this.resources}}
          @description='The fields the left column offers. Each carries the BXL label path it writes verbatim into targetPath — bare (Total), quoted ("Approver Email"), or a predicate path ("Line Item"[SKU = "DHP-04"].Quantity). type picks the default operator catalogue and the value quoting; options reaches the value slot for picklists.'
        />
        <Args.Object
          @name='operators'
          @value={{null}}
          @description='Operator catalogue fallback when a resource declares none and its type default is not wanted. Each operator may carry a bxl template ({path}, {op}, {value}) and arity: 0 for unary operators like “is empty”, which suppress the value column entirely.'
        />
        <Args.Bool
          @name='allowFieldComparison'
          @defaultValue={{false}}
          @value={{this.allowFieldComparison}}
          @description='Offer a Value / Field switch on the right-hand side so a condition can compare two fields — “Total must not exceed the approved budget”. In Field mode the builder owns the picker and the value slot is skipped; the stored value is a label path, emitted into BXL unquoted.'
          @onInput={{this.setAllowField}}
        />
        <Args.String
          @name='title'
          @defaultValue='Conditions'
          @value={{this.titleText}}
          @description='Heading above the builder. Also the name of the overflow menu button.'
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='conditionNoun'
          @defaultValue='Condition'
          @value={{this.conditionNoun}}
          @description='Singular noun for a row. It appears in EVERY accessible name — “Condition 3 field”, “Move condition 3 up”, “Condition 3 of 4” — so a rule builder can call its rows Criteria or Filters and the whole a11y surface follows.'
          @onInput={{this.setNoun}}
        />
        <Args.Bool
          @name='readonly'
          @defaultValue={{false}}
          @value={{this.readonly}}
          @description='Disable every control. The review/approved state; the rows still read.'
          @onInput={{this.setReadonly}}
        />
        <Args.Number
          @name='maxConditions'
          @value={{null}}
          @description='Refuse to add past this many rows. Unlimited when omitted. The add button disables; nothing else changes.'
        />
        <Args.Object
          @name='issues'
          @value={{null}}
          @description='Caller-supplied authoring problems, merged with the ones the builder derives (missing field, missing operator, missing value, dangling or unused custom-logic reference). Rows are addressed by conditionId; anything without one lands in the expression-level list under the rows.'
        />
        <Args.Action
          @name='onChange'
          @description='Fires after every structural or field change with the whole ExpressionModel { logic, customLogic, conditions } — including the rewritten customLogic. This is the single change channel; there is no per-row callback.'
        />
        <Args.Action
          @name='onIssues'
          @description='Fires alongside onChange with the derived issue list for the model being handed over, so a caller can gate its save button without re-deriving them.'
        />
        <Args.Yield
          @name=':value'
          @description='The right-hand value control, yielded { condition, index, number, resource, operator, controlId, label, describedBy, disabled, options, valueKind, setValue }. Put controlId on the control and it is already wired to a per-row accessible name. Falls back to a plain Input.'
        />
        <Args.Yield
          @name=':header'
          @description='Extra content between the joiner row and the rows — a hint, a preset picker.'
        />
        <Args.Yield
          @name=':footer'
          @description='Extra buttons beside Add condition.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_EXPRESSION_BUILDER: Record<string, unknown> = {
  ExpressionBuilder: ExpressionBuilderUsage,
};
