// Pretui — ErrorSummary: the list of blocking issues a refused submit focuses.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { iconFor } from '../icon-registry';
import { FormContext, isBlocking, normalizeSeverity, sortIssues } from '../internal/forms-core';
import type { FormIssue, FormSeverity } from '../internal/forms-core';

// ── ErrorSummary ─────────────────────────────────────────────────────────
// The form-level list, and the reason nothing gets dropped.
//
// Ported in spirit from the GOV.UK / React Spectrum error-summary pattern
// (neither SLDS nor React Spectrum ships one as a component). Two deltas
// from the pattern as usually written:
//
//   • Rows are BUTTONS, not `href="#id"` anchors. An anchor mutates the URL,
//     and inside a Boxel card the URL is the card's — a fragment jump there
//     is a navigation, not a focus move. The button calls focusPath() and
//     lands focus on exactly the same element the anchor would have.
//   • The shell is NOT Alert, even though it would have been
//     one line. Alert hardcodes role='alert' (danger) / role='status' — a
//     live region that would re-announce the whole list on every keystroke in
//     live mode, and double-announce at submit on top of the focus move.
//     The summary announces by TAKING FOCUS, which is the whole point of it.
//
// The correctness contract: every issue in the form appears here. An issue
// whose targetPath matched no rendered field is rendered with an explicit
// "not on this form" marking rather than being filtered away, because a
// dropped error is worse than an ugly one.

interface SummaryRow {
  issue: FormIssue;
  severity: FormSeverity;
  routed: boolean;
}

export interface ErrorSummarySignature {
  Args: {
    /** Issues to summarise, when used WITHOUT a Form. */
    issues?: FormIssue[];
    /** The owning form's context. Supplied automatically by `form.Summary`. */
    form?: FormContext;
    /** Heading text. Defaults to a count sentence. */
    title?: string;
    /** aria-level for the heading — a card does not know its host's outline,
     *  so the level is a knob rather than a hardcoded <h2>. Default 3. */
    headingLevel?: number;
    /** Include warnings and info alongside errors. Default false. */
    showAdvisory?: boolean;
    /** Render even before a submit has been attempted. */
    always?: boolean;
    /** Add role='alert'. Off by default: the summary announces by taking
     *  focus, and a live region on top of that double-announces. */
    announce?: boolean;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export class ErrorSummary extends Component<ErrorSummarySignature> {
  private guid = guidFor(this);

  get id(): string {
    return `${this.guid}-summary`;
  }

  constructor(owner: unknown, args: ErrorSummarySignature['Args']) {
    super(owner as never, args);
    this.args.form?.registerSummary(this.id);
  }
  willDestroy(): void {
    super.willDestroy();
    this.args.form?.unregisterSummary(this.id);
  }

  get sourceIssues(): FormIssue[] {
    return this.args.issues ?? this.args.form?.issues ?? [];
  }
  get rows(): SummaryRow[] {
    let issues = this.args.showAdvisory
      ? sortIssues(this.sourceIssues)
      : sortIssues(this.sourceIssues.filter(isBlocking));
    return issues.map((issue) => ({
      issue,
      severity: normalizeSeverity(issue.severity),
      routed: this.isRouted(issue),
    }));
  }
  private isRouted(issue: FormIssue): boolean {
    let form = this.args.form;
    if (!form) {
      return false;
    }
    // Before the first registration snapshot lands, assume routed — the
    // alternative is a one-frame flash of "not on this form" on every issue.
    return !form.settled || form.isClaimed(issue.targetPath);
  }
  /** Only mark unrouted rows when there is a form to be unrouted FROM. */
  get marksUnrouted(): boolean {
    return this.args.form !== undefined;
  }
  get visible(): boolean {
    if (this.rows.length === 0) {
      return false;
    }
    if (this.args.always) {
      return true;
    }
    let form = this.args.form;
    if (!form) {
      return true;
    }
    // A submit-mode form is not "in error" until the user has tried.
    return form.mode !== 'submit' || form.submitAttempted;
  }
  get title(): string {
    if (this.args.title) {
      return this.args.title;
    }
    let count = this.rows.length;
    return count === 1
      ? 'There is 1 issue to fix'
      : `There are ${count} issues to fix`;
  }
  get headingLevel(): string {
    return String(this.args.headingLevel ?? 3);
  }
  get role(): string | undefined {
    return this.args.announce ? 'alert' : undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- icons are
  // resolved dynamically from the registry, which is any-typed by design
  get glyph(): any {
    return iconFor('circle-alert');
  }

  claimFocus = modifier((el: HTMLElement) => {
    if (this.args.form?.takeSummaryFocus()) {
      el.focus();
    }
  });

  goTo = (row: SummaryRow): void => {
    this.args.form?.focusPath(row.issue.targetPath);
  };

  <template>
    {{#if this.visible}}
      <div
        class='pretui-error-summary'
        id={{this.id}}
        tabindex='-1'
        role={{this.role}}
        {{this.claimFocus}}
        data-test-pretui-error-summary
        ...attributes
      >
        <div class='pretui-error-summary-head'>
          {{#let this.glyph as |Glyph|}}
            {{#if Glyph}}
              <Glyph
                class='pretui-error-summary-glyph'
                width='15'
                height='15'
                role='presentation'
              />
            {{/if}}
          {{/let}}
          <div
            class='pretui-error-summary-title'
            role='heading'
            aria-level={{this.headingLevel}}
          >{{this.title}}</div>
        </div>
        {{#if (has-block)}}
          <p class='pretui-error-summary-intro'>{{yield}}</p>
        {{/if}}
        <ul class='pretui-error-summary-list'>
          {{#each this.rows key='@index' as |row|}}
            <li class='pretui-error-summary-row' data-severity={{row.severity}}>
              {{#if row.routed}}
                <button
                  type='button'
                  class='pretui-error-summary-link'
                  {{on 'click' (fn this.goTo row)}}
                >{{row.issue.message}}</button>
              {{else}}
                <span class='pretui-error-summary-orphan'>
                  <span class='pretui-error-summary-text'>{{row.issue.message}}</span>
                  {{#if this.marksUnrouted}}
                    <span
                      class='pretui-error-summary-badge'
                      title={{row.issue.targetPath}}
                    >no field on this form</span>
                  {{/if}}
                </span>
              {{/if}}
            </li>
          {{/each}}
        </ul>
      </div>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        .pretui-error-summary {
          --pretui-issue-hue: var(--pretui-issue-error, var(--destructive));
          display: grid;
          gap: var(--space-3, 8px);
          padding: var(--space-4, 11px) var(--space-4, 11px)
            calc(var(--space-4, 11px) - 2px);
          border-radius: var(--radius-surface, 10px);
          background: color-mix(
            in oklch,
            var(--pretui-issue-hue) var(--pretui-chip-mix, 10%),
            var(--card)
          );
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px
              color-mix(in oklch, var(--pretui-issue-hue) 28%, var(--border))
          );
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
        }
        .pretui-error-summary:focus {
          outline: none;
        }
        .pretui-error-summary:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-error-summary-head {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
        }
        .pretui-error-summary-glyph {
          flex: none;
          --icon-color: var(--pretui-issue-hue);
          color: var(--pretui-issue-hue);
        }
        .pretui-error-summary-title {
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 600;
          color: color-mix(
            in oklch,
            var(--foreground) 45%,
            var(--pretui-issue-hue)
          );
        }
        .pretui-error-summary-intro {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-error-summary-list {
          margin: 0;
          padding: 0 0 0 var(--space-4, 11px);
          display: grid;
          gap: 3px;
        }
        .pretui-error-summary-row {
          --pretui-issue-hue: var(--pretui-issue-error, var(--destructive));
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 17px;
          color: color-mix(
            in oklch,
            var(--foreground) 22%,
            var(--pretui-issue-hue)
          );
          list-style: disc;
        }
        .pretui-error-summary-row[data-severity='warning'] {
          --pretui-issue-hue: var(--pretui-issue-warning, var(--warning, var(--boxel-warning)));
        }
        .pretui-error-summary-row[data-severity='info'] {
          --pretui-issue-hue: var(--pretui-issue-info, var(--pretui-info, var(--boxel-blue)));
        }
        .pretui-error-summary-link {
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          color: inherit;
          text-align: left;
          text-decoration: underline;
          text-underline-offset: 2px;
          cursor: pointer;
        }
        .pretui-error-summary-link:hover {
          text-decoration-thickness: 2px;
        }
        .pretui-error-summary-link:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: 3px;
        }
        .pretui-error-summary-orphan {
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
          flex-wrap: wrap;
        }
        .pretui-error-summary-badge {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          padding: 0 5px;
          border-radius: 4px;
          color: var(--muted-foreground);
          background: var(--inset, var(--boxel-100));
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
      }
    </style>
  </template>
}
