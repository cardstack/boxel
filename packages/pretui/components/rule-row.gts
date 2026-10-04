// Pretui — RuleRow: one validation rule with its severity and live status.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { IconButton } from './icon-button';
import { Input } from './input';
import { Select } from './select';
import type { SelectOption } from './select';
import { Divider } from './divider';
import { Chip } from './chip';
import { Token } from './token';
import { ExpressionBuilder } from './expression-builder';
import type { ExpressionValueContext } from './expression-builder';
import { RemoveIcon, expressionToBxl } from '../internal/forms-expression';
import type { ExpressionModel, ExpressionOperator, ExpressionResource, GuideRule, RuleStatus } from '../internal/forms-expression';

// ── RuleRow ──────────────────────────────────────────────────────────────

const SEVERITY_OPTIONS: SelectOption[] = [
  { value: 'error', label: 'Error — blocks' },
  { value: 'warning', label: 'Warning — advisory' },
  { value: 'info', label: 'Info — informational' },
];

// Severity hue is semantic, not hashed: an error is always the destructive
// hue. Unknown severities fail closed to the error hue, matching the guide
// contract's "treat an unrecognised severity as an error".
function severityHue(severity: string): string {
  if (severity === 'warning') {
    return 'var(--warning, var(--boxel-warning))';
  }
  if (severity === 'info') {
    return 'var(--pretui-info, var(--boxel-blue))';
  }
  return 'var(--destructive)';
}

function statusHueFor(status: RuleStatus): string {
  if (status === 'pass') {
    return 'var(--success, var(--boxel-success))';
  }
  if (status === 'fail' || status === 'error') {
    return 'var(--destructive)';
  }
  return 'var(--muted-foreground)';
}

export interface RuleRowSignature {
  Args: {
    /** The rule record, in guide shape. Edited in place and handed back
     * whole by `@onChange` — this component invents no other rule shape. */
    rule: GuideRule;
    /** The authoring state behind `rule.expression`. Omit it and the
     * expression is shown read-only: BXL source is never parsed back into a
     * model here, because a lossy round-trip would quietly rewrite a rule. */
    model?: ExpressionModel;
    /** Fields the expression builder offers. */
    resources?: ExpressionResource[];
    /** Operator catalogue fallback, forwarded to the builder. */
    operators?: ExpressionOperator[];
    /** Forwarded to the builder — offer the Value / Field switch. */
    allowFieldComparison?: boolean;
    /** Severity choices. Defaults to error / warning / info. */
    severities?: SelectOption[];
    /** Choices for `targetPath`. Falls back to `@resources`; when neither is
     * supplied the path is a free-text input so predicate paths stay typable. */
    targetPaths?: SelectOption[];
    /** A CANNED verdict from an evaluation that happened somewhere else.
     * Nothing in this file computes it. */
    status?: RuleStatus;
    /** Prose beside the status chip — the observed value, the error text. */
    statusDetail?: string;
    /** Render every control disabled. */
    readonly?: boolean;
    /** Fires with the whole rule (expression freshly composed) and the model
     * that produced it. */
    onChange?: (rule: GuideRule, model: ExpressionModel) => void;
    /** Shows a remove control when supplied. */
    onRemove?: () => void;
    /** BXL conjunction keyword. Default `and`. */
    and?: string;
    /** BXL disjunction keyword. Default `or`. */
    or?: string;
  };
  Blocks: {
    /** Forwarded verbatim to the builder's value slot. */
    value: [ExpressionValueContext];
    /** Extra controls in the footer, beside the composed source. */
    actions: [];
  };
  Element: HTMLElement;
}

/**
 * One BXL guide rule, edited: the metadata (label, severity, target path,
 * message) above an `ExpressionBuilder` that composes `rule.expression`.
 *
 * This is the bridge between the visual builder and the rule record. There is
 * no upstream for it — SLDS's expression component stops at the condition
 * list and never names what the conditions are FOR — so the metadata half is
 * new work, laid out on the SLDS stacked form-element grid.
 */
export class RuleRow extends Component<RuleRowSignature> {
  @tracked private internalModel?: ExpressionModel;

  private get uid() {
    return guidFor(this);
  }
  get model(): ExpressionModel {
    return (
      this.args.model ??
      this.internalModel ?? { logic: 'all', customLogic: '', conditions: [] }
    );
  }
  get hasModel() {
    return this.args.model !== undefined || this.internalModel !== undefined;
  }
  get readonly() {
    return this.args.readonly ?? false;
  }
  get severities() {
    return this.args.severities ?? SEVERITY_OPTIONS;
  }
  get severity() {
    return this.args.rule.severity ?? 'error';
  }
  get severityHue() {
    return severityHue(String(this.severity));
  }
  get status(): RuleStatus {
    return this.args.status ?? 'unknown';
  }
  get statusLabel() {
    let map: Record<RuleStatus, string> = {
      pass: 'Passing',
      fail: 'Failing',
      error: 'Rule error',
      unknown: 'Not evaluated',
    };
    return map[this.status];
  }
  get statusHue() {
    return statusHueFor(this.status);
  }
  get targetPathOptions(): SelectOption[] {
    if (this.args.targetPaths) {
      return this.args.targetPaths;
    }
    return (this.args.resources ?? []).map((r) => ({
      value: r.value,
      label: r.label,
    }));
  }
  get usePathSelect() {
    return this.targetPathOptions.length > 0;
  }
  get labelId() {
    return `${this.uid}-label`;
  }
  get severityId() {
    return `${this.uid}-sev`;
  }
  get pathId() {
    return `${this.uid}-path`;
  }
  get messageId() {
    return `${this.uid}-message`;
  }
  get expressionId() {
    return `${this.uid}-expr`;
  }
  /** The composed BXL. Building a string is not evaluating one. */
  get composed(): string {
    if (!this.hasModel) {
      return this.args.rule.expression ?? '';
    }
    return expressionToBxl(this.model, {
      resources: this.args.resources,
      operators: this.args.operators,
      and: this.args.and,
      or: this.args.or,
    });
  }
  get composedDisplay() {
    return this.composed || '— the expression is not complete yet —';
  }

  private emit(rule: GuideRule, model: ExpressionModel) {
    let expression = this.hasModel
      ? expressionToBxl(model, {
          resources: this.args.resources,
          operators: this.args.operators,
          and: this.args.and,
          or: this.args.or,
        })
      : rule.expression;
    this.args.onChange?.({ ...rule, expression }, model);
  }

  setLabel = (value: string) => {
    this.emit({ ...this.args.rule, label: value }, this.model);
  };
  setSeverity = (value: string) => {
    this.emit({ ...this.args.rule, severity: value }, this.model);
  };
  setTargetPath = (value: string) => {
    this.emit({ ...this.args.rule, targetPath: value }, this.model);
  };
  setMessage = (value: string) => {
    this.emit({ ...this.args.rule, message: value }, this.model);
  };
  setModel = (model: ExpressionModel) => {
    this.internalModel = model;
    this.emit(this.args.rule, model);
  };

  <template>
    <article
      class='pretui-rulerow'
      data-severity={{this.severity}}
      data-status={{this.status}}
      data-test-pretui-rule-row={{@rule.ruleId}}
      ...attributes
    >
      <header class='rr-head'>
        <Chip
          @label={{this.statusLabel}}
          @hue={{this.statusHue}}
          data-test-pretui-rule-status
        />
        <Token @value={{@rule.ruleId}} @hue={{this.severityHue}} />
        {{#if @statusDetail}}
          <span class='rr-detail'>{{@statusDetail}}</span>
        {{/if}}
        <span class='rr-spacer'></span>
        {{#if @onRemove}}
          <IconButton
            @label='Remove rule {{@rule.label}}'
            @variant='ghost'
            disabled={{this.readonly}}
            {{on 'click' @onRemove}}
            data-test-pretui-rule-remove
          ><RemoveIcon class='rr-icon' /></IconButton>
        {{/if}}
      </header>

      <div class='rr-meta'>
        <div class='rr-meta-wide'>
          <label class='rr-label' for={{this.labelId}}>Rule name</label>
          <Input
            @value={{@rule.label}}
            @controlId={{this.labelId}}
            @placeholder='Total is within the approved budget'
            @disabled={{this.readonly}}
            @onInput={{this.setLabel}}
            data-test-pretui-rule-label
          />
        </div>
        <div>
          <label class='rr-label' for={{this.severityId}}>Severity</label>
          <Select
            @options={{this.severities}}
            @value={{this.severity}}
            @controlId={{this.severityId}}
            @disabled={{this.readonly}}
            @onValueChange={{this.setSeverity}}
            data-test-pretui-rule-severity
          />
        </div>
        <div>
          <label class='rr-label' for={{this.pathId}}>Target path</label>
          {{#if this.usePathSelect}}
            <Select
              @options={{this.targetPathOptions}}
              @value={{@rule.targetPath}}
              @controlId={{this.pathId}}
              @placeholder='Where the failure points…'
              @disabled={{this.readonly}}
              @onValueChange={{this.setTargetPath}}
              data-test-pretui-rule-path
            />
          {{else}}
            <Input
              @value={{@rule.targetPath}}
              @controlId={{this.pathId}}
              @placeholder='"Approver Email"'
              @disabled={{this.readonly}}
              @onInput={{this.setTargetPath}}
              data-test-pretui-rule-path
            />
          {{/if}}
        </div>
        <div class='rr-meta-wide'>
          <label class='rr-label' for={{this.messageId}}>Message shown on failure</label>
          <Input
            @value={{@rule.message}}
            @controlId={{this.messageId}}
            @placeholder='Add an approver before submitting.'
            @disabled={{this.readonly}}
            @onInput={{this.setMessage}}
            data-test-pretui-rule-message
          />
        </div>
      </div>

      <Divider />

      {{#if this.hasModel}}
        <ExpressionBuilder
          @conditions={{this.model.conditions}}
          @logic={{this.model.logic}}
          @customLogic={{this.model.customLogic}}
          @resources={{@resources}}
          @operators={{@operators}}
          @allowFieldComparison={{@allowFieldComparison}}
          @readonly={{this.readonly}}
          @title='Rule conditions'
          @logicLabel='This rule passes when'
          @onChange={{this.setModel}}
        >
          <:value as |ctx|>
            {{#if (has-block 'value')}}
              {{yield ctx to='value'}}
            {{else}}
              <Input
                @value={{ctx.condition.value}}
                @controlId={{ctx.controlId}}
                @placeholder='Value'
                @disabled={{ctx.disabled}}
                @onInput={{ctx.setValue}}
              />
            {{/if}}
          </:value>
        </ExpressionBuilder>
      {{else}}
        <p class='rr-nomodel'>
          This rule's expression was authored as BXL source. Pass
          <code>@model</code>
          to edit it visually — the source is never parsed back into a model,
          so nothing here can silently rewrite it.
        </p>
      {{/if}}

      <footer class='rr-foot'>
        <div class='rr-source'>
          <span class='rr-label' id={{this.expressionId}}>
            Composed expression
          </span>
          <code
            class='rr-bxl'
            aria-labelledby={{this.expressionId}}
            data-empty={{unless this.composed 'true'}}
            data-test-pretui-rule-expression
          >{{this.composedDisplay}}</code>
        </div>
        <div class='rr-actions'>{{yield to='actions'}}</div>
      </footer>

    </article>
    <style scoped>
      @layer PretComponent {
        .pretui-rulerow {
          container-type: inline-size;
          display: block;
          padding: var(--space-4, 11px);
          border-radius: var(--radius-surface, 14px);
          background: var(--card);
          box-shadow: var(--pretui-shadow-control, 0 0 0 1px var(--border));
          color: var(--foreground);
          font-size: var(--text-ui-md, 12.5px);
        }
        .rr-head {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          flex-wrap: wrap;
          margin-bottom: var(--space-3, 8px);
        }
        .rr-spacer {
          flex: 1;
        }
        .rr-detail {
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .rr-icon {
          --icon-color: currentColor;
          width: 13px;
          height: 13px;
        }
        .rr-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--space-3, 8px);
        }
        .rr-meta-wide {
          grid-column: 1 / -1;
        }
        .rr-label {
          display: block;
          margin-bottom: 3px;
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: var(--track-eyebrow, 0.06em);
          color: var(--muted-foreground);
        }
        .rr-nomodel {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .rr-nomodel code {
          font-family: var(--font-mono);
        }
        .rr-foot {
          display: flex;
          align-items: flex-end;
          gap: var(--space-3, 8px);
          margin-top: var(--space-4, 11px);
          padding-top: var(--space-3, 8px);
          box-shadow: inset 0 1px 0 var(--border);
        }
        .rr-source {
          flex: 1;
          min-width: 0;
        }
        .rr-bxl {
          display: block;
          overflow-x: auto;
          padding: 6px 8px;
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          font-family: var(--font-mono);
          font-size: calc(var(--text-body, 15px) - 3.5px);
          line-height: 1.5;
          white-space: pre;
          color: var(--foreground);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .rr-bxl[data-empty='true'] {
          color: var(--muted-foreground);
          font-style: italic;
        }
        .rr-actions {
          display: flex;
          gap: 6px;
        }
        @container (max-width: 34rem) {
          .rr-meta {
            grid-template-columns: minmax(0, 1fr);
          }
          .rr-foot {
            flex-direction: column;
            align-items: stretch;
          }
        }
      }
    </style>
  </template>
}
