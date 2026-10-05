// Pretui — FieldError usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { FieldError } from './field-error';
import type { FormIssue } from '../internal/forms-core';

// ── FieldError ───────────────────────────────────────────────────────────
const SEVERITIES = ['error', 'warning', 'info', 'critical'];

// Ported from React Spectrum's <FieldError> (errors only, no severity) and
// SLDS's .slds-form-element__help (one flat style). Dropped: React
// Spectrum's render-prop signature — the message is authored by a rule and
// printed verbatim, so there is nothing for a render prop to reshape.
class FieldErrorUsage extends Component {
  severityOptions = SEVERITIES;

  @tracked severity = 'error';
  @tracked message =
    'Da Hong Pao lot DHP-04 is booked at 96 kg against an 84 kg allocation.';
  @tracked ruleId = 'lot-allocation-ceiling';
  @tracked announce = false;
  @tracked showRuleId = true;

  setSeverity = (v: string) => (this.severity = v);
  setMessage = (v: string) => (this.message = v);
  setRuleId = (v: string) => (this.ruleId = v);
  setAnnounce = (v: boolean) => (this.announce = v);
  setShowRuleId = (v: boolean) => (this.showRuleId = v);

  get issue(): FormIssue {
    return {
      ruleId: this.ruleId,
      targetPath: '"Line Item"[SKU = "DHP-04"].Quantity',
      severity: this.severity,
      message: this.message,
    };
  }
  get resolvedNote() {
    return this.severity === 'error' ||
      this.severity === 'warning' ||
      this.severity === 'info'
      ? `severity '${this.severity}' is known`
      : `severity '${this.severity}' is unknown → renders as error (fail closed)`;
  }
  get usage() {
    let bits = ['@issue={{this.issue}}'];
    if (this.announce) bits.push('@announce={{true}}');
    if (this.showRuleId) bits.push('@showRuleId={{true}}');
    return `<FieldError ${bits.join(' ')} />`;
  }

  <template>
    <FreestyleUsage
      @name='FieldError'
      @description="One issue, rendered. Three severities on the Law 2 hue treatment, sharing Alert's glyph vocabulary so a field message and a banner about the same thing read as one system. Unknown severities FAIL CLOSED — anything that is not exactly 'warning' or 'info' renders and blocks as an error, matching the guide contract where an unevaluable rule counts as a failure. The live-region policy is deliberate: role='alert' interrupts, so @announce is opt-in and FormField only turns it on in record mode, where the message follows one discrete commit. In submit mode the ErrorSummary announces by taking focus; in live mode nothing announces and the message is still read when the field is focused, because it is in the control's aria-describedby."
      @source={{this.usage}}
    >
      <:example>
        <div class='demo-forms-errorstage'>
          <FieldError
            @issue={{this.issue}}
            @announce={{this.announce}}
            @showRuleId={{this.showRuleId}}
          />
          <p class='demo-forms-readout'>{{this.resolvedNote}}</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='severity'
          @defaultValue='error'
          @value={{this.severity}}
          @options={{this.severityOptions}}
          @description="Demo knob writing issue.severity. 'critical' is in the list on purpose: it is not a known severity, so it must render as an error."
          @onInput={{this.setSeverity}}
        />
        <Args.String
          @name='message'
          @value={{this.message}}
          @description='Demo knob writing issue.message. Rendered verbatim — a rule author wrote it, and rewriting rule copy in a component is how enterprise forms end up lying about what failed.'
          @onInput={{this.setMessage}}
        />
        <Args.String
          @name='ruleId'
          @value={{this.ruleId}}
          @description='Demo knob writing issue.ruleId — optional provenance back to the rule.'
          @onInput={{this.setRuleId}}
        />
        <Args.Bool
          @name='announce'
          @defaultValue={{false}}
          @value={{this.announce}}
          @description="Add role='alert'. Only where the message appears as the result of a discrete commit — never on a control that revalidates per keystroke."
          @onInput={{this.setAnnounce}}
        />
        <Args.Bool
          @name='showRuleId'
          @defaultValue={{false}}
          @value={{this.showRuleId}}
          @description='Print issue.ruleId as a mono accent-tinted Token (Law 3 — machine values look like machine values).'
          @onInput={{this.setShowRuleId}}
        />
        <Args.Object
          @name='issue'
          @required={{true}}
          @description='The FormIssue: { targetPath, severity, message, ruleId? }.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='--pretui-issue-error'
          @value='var(--destructive)'
          @description='Hue for the error severity; the whole treatment derives from it.'
        />
        <Css.Basic
          @name='--pretui-issue-warning'
          @value='var(--warning)'
          @description='Hue for the warning severity.'
        />
        <Css.Basic
          @name='--pretui-issue-info'
          @value='var(--pretui-info)'
          @description='Hue for the info severity.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .demo-forms-errorstage {
        display: grid;
        gap: 6px;
        max-width: 28rem;
      }
      .demo-forms-readout {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_FIELD_ERROR: Record<string, unknown> = {
  FieldError: FieldErrorUsage,
};
