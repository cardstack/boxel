// Pretui — FieldError: the message line under a field, one severity glyph per issue.
import Component from '@glimmer/component';
import { Token } from './token';
import { normalizeSeverity } from '../internal/forms-core';
import type { FormIssue, FormSeverity } from '../internal/forms-core';

// ── FieldError ───────────────────────────────────────────────────────────
// One issue, rendered. Ported from React Spectrum's <FieldError> (which is
// errors-only and unstyled by severity) and SLDS's
// `.slds-form-element__help` (one flat red line, no severity concept).
//
// Better than both: three severities on the Law 2 hue treatment (one hue in,
// a complete treatment out), fail-closed normalisation, optional rule
// provenance as a Law 3 Token, and — the part everyone gets wrong — a
// DELIBERATE live-region policy.
//
// The live-region policy, stated plainly: role='alert' interrupts. A field
// message that re-renders on every keystroke must never be a live region, or
// a screen-reader user is talked over while typing. So @announce is opt-in
// and FormField only turns it on for `record` mode, where an error appears as
// the result of one discrete commit. In `submit` mode the ErrorSummary
// announces by TAKING FOCUS; in `live` mode nothing announces, and the
// message is still read whenever the field itself is focused because
// FormField put its id in the control's aria-describedby.

const SEVERITY_GLYPHS: Record<FormSeverity, string> = {
  // Same glyph vocabulary as Alert, so a field message and a
  // banner about the same thing read as one system.
  error: '✕',
  warning: '!',
  info: 'i',
};

export interface FieldErrorSignature {
  Args: {
    /** The issue to render. Its message is printed verbatim — a rule author
     *  wrote it, and rewriting rule copy in a component is how enterprise
     *  forms end up lying about what failed. */
    issue: FormIssue;
    /** Add role='alert'. Default false. Only turn this on where the message
     *  appears as the result of a discrete commit — never on a control that
     *  revalidates per keystroke. */
    announce?: boolean;
    /** Show `issue.ruleId` as a mono Token after the message (Law 3). */
    showRuleId?: boolean;
  };
  Element: HTMLDivElement;
}

export class FieldError extends Component<FieldErrorSignature> {
  get severity(): FormSeverity {
    return normalizeSeverity(this.args.issue?.severity);
  }
  get glyph(): string {
    return SEVERITY_GLYPHS[this.severity];
  }
  get role(): string | undefined {
    return this.args.announce ? 'alert' : undefined;
  }
  get ruleId(): string | undefined {
    return this.args.showRuleId ? this.args.issue?.ruleId : undefined;
  }
  <template>
    <div
      class='pretui-field-error'
      role={{this.role}}
      data-severity={{this.severity}}
      data-test-pretui-field-error
      ...attributes
    >
      <span class='pretui-field-error-glyph' aria-hidden='true'>{{this.glyph}}</span>
      <span class='pretui-field-error-msg'>{{@issue.message}}</span>
      {{#if this.ruleId}}
        <Token @value={{this.ruleId}} class='pretui-field-error-rule' />
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        /* Law 2 — one hue in, a complete treatment out. The severity picks the
           hue; the recipe below is written once and reads it. */
        .pretui-field-error {
          --pretui-issue-hue: var(--pretui-issue-error, var(--destructive));
          display: flex;
          align-items: flex-start;
          gap: var(--pretui-issue-gap, 5px);
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 16px;
          font-weight: 500;
          color: color-mix(
            in oklch,
            var(--foreground) 22%,
            var(--pretui-issue-hue)
          );
          min-width: 0;
        }
        .pretui-field-error[data-severity='warning'] {
          --pretui-issue-hue: var(--pretui-issue-warning, var(--warning, var(--boxel-warning)));
        }
        .pretui-field-error[data-severity='info'] {
          --pretui-issue-hue: var(--pretui-issue-info, var(--pretui-info, var(--boxel-blue)));
        }
        .pretui-field-error-glyph {
          flex: none;
          width: 13px;
          height: 13px;
          margin-top: 1.5px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 8px;
          font-weight: 700;
          line-height: 1;
          background: var(--pretui-issue-hue);
          color: var(--pretui-on-neutral, var(--boxel-light));
        }
        .pretui-field-error-msg {
          min-width: 0;
        }
      }
      /* Unlayered: Token styles its root unlayered, and unlayered CSS beats
         any layer. */
      .pretui-field-error .pretui-field-error-rule {
        flex: none;
      }
    </style>
  </template>
}
