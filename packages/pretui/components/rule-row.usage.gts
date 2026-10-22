// Pretui — RuleRow usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { RuleRow } from './rule-row';
import type { ExpressionModel, GuideRule, RuleStatus } from '../internal/forms-expression';
import { REQUEST_RESOURCES, condition } from '../demo-forms-expression';

// ── RuleRow ← no upstream ────────────────────────────────────────────────
//
// SLDS's expression component stops at the condition list and never names
// what the conditions are FOR, so the metadata half is new work laid out on
// the SLDS stacked form-element grid. Dropped: nothing (there is no upstream
// surface to drop).
const STATUS_KNOB = ['unknown', 'pass', 'fail', 'error'];

class RuleRowUsage extends Component {
  statusOptions = STATUS_KNOB;
  resources = REQUEST_RESOURCES;

  @tracked rule: GuideRule = {
    ruleId: 'total-within-approved-budget',
    label: 'Total must not exceed the approved budget',
    severity: 'error',
    targetPath: 'Total',
    message:
      'This request is over the approved budget for Wuyi Origins. Reduce the lot or raise the budget first.',
    expression: 'Total <= "Approved Budget"',
  };
  @tracked model: ExpressionModel = {
    logic: 'all',
    customLogic: '',
    conditions: [condition('Total', '<=', '"Approved Budget"', 'path')],
  };
  @tracked status: RuleStatus = 'fail';
  @tracked statusDetail = 'Total $12,480 · Approved Budget $9,000';
  @tracked readonly = false;

  setStatus = (v: string) => (this.status = v as RuleStatus);
  setDetail = (v: string) => (this.statusDetail = v);
  setReadonly = (v: boolean) => (this.readonly = v);

  onChange = (rule: GuideRule, model: ExpressionModel) => {
    this.rule = rule;
    this.model = model;
  };

  get usage() {
    let bits = [
      '@rule={{this.rule}}',
      '@model={{this.model}}',
      '@resources={{this.resources}}',
      '@allowFieldComparison={{true}}',
      `@status='${this.status}'`,
    ];
    if (this.readonly) {
      bits.push('@readonly={{true}}');
    }
    bits.push('@onChange={{this.onChange}}');
    return `<RuleRow\n  ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='RuleRow'
      @description='One BXL guide rule, edited: label, severity, target path and failure message above an ExpressionBuilder that composes the expression. This is the bridge between the visual builder and the rule record — the record it emits is the guide shape verbatim, { ruleId, label, severity, targetPath, message, expression }, with no second shape invented alongside it. The pass/fail chip is a CANNED verdict passed in as @status: this component evaluates nothing, and an evaluation that errors is a failure, not an unknown.'
      @source={{this.usage}}
    >
      <:example>
        <RuleRow
          @rule={{this.rule}}
          @model={{this.model}}
          @resources={{this.resources}}
          @allowFieldComparison={{true}}
          @status={{this.status}}
          @statusDetail={{this.statusDetail}}
          @readonly={{this.readonly}}
          @onChange={{this.onChange}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='rule'
          @value={{this.rule}}
          @description='The rule record in BXL guide shape. Edited in place and handed back whole by @onChange with expression freshly composed from the model.'
        />
        <Args.Object
          @name='model'
          @value={{this.model}}
          @description='The authoring state behind rule.expression. Omit it and the expression renders read-only: BXL source is deliberately never parsed back into rows, because a lossy round-trip would quietly rewrite a rule someone wrote by hand.'
        />
        <Args.Object
          @name='resources'
          @value={{this.resources}}
          @description='Forwarded to the builder, and the default source of the target-path choices when @targetPaths is omitted.'
        />
        <Args.String
          @name='status'
          @defaultValue='unknown'
          @value={{this.status}}
          @options={{this.statusOptions}}
          @description='A canned verdict from an evaluation that happened somewhere else. pass / fail / error / unknown. Nothing in this file computes it, and nothing here can: the component holds no BXL import by design.'
          @onInput={{this.setStatus}}
        />
        <Args.String
          @name='statusDetail'
          @value={{this.statusDetail}}
          @description='Prose beside the status chip — the observed value, or the compile error from a failed prepare.'
          @onInput={{this.setDetail}}
        />
        <Args.Object
          @name='targetPaths'
          @value={{null}}
          @description='Choices for targetPath. Falls back to @resources; when neither is supplied the path becomes a free-text input, so a predicate path like "Line Item"[SKU = "DHP-04"].Quantity stays typable. The path is matched as ONE opaque string everywhere — never split on “.”.'
        />
        <Args.Object
          @name='severities'
          @value={{null}}
          @description='Severity choices. Defaults to error / warning / info. An unrecognised severity is treated as an error — fail closed, matching the guide contract.'
        />
        <Args.Bool
          @name='readonly'
          @defaultValue={{false}}
          @value={{this.readonly}}
          @description='Disable every control, including the nested builder.'
          @onInput={{this.setReadonly}}
        />
        <Args.String
          @name='and'
          @defaultValue='and'
          @value={{null}}
          @description='BXL conjunction keyword used when composing. Paired with @or; exposed because the keyword is a property of the BXL dialect, not of this component.'
        />
        <Args.Action
          @name='onChange'
          @description='Fires with (rule, model) on every edit. rule.expression is recomposed from the model each time; the caller persists the rule and may cache the model as the editor projection.'
        />
        <Args.Action
          @name='onRemove'
          @description='Supplying it reveals the remove control in the header.'
        />
        <Args.Yield
          @name=':value'
          @description="Forwarded verbatim to the builder's value slot."
        />
        <Args.Yield
          @name=':actions'
          @description='Extra controls in the footer, beside the composed source.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_RULE_ROW: Record<string, unknown> = {
  RuleRow: RuleRowUsage,
};
