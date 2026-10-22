// Pretui — FormSection: a fieldset region with an issue count and an optional disclosure.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { hash } from '@ember/helper';
import { guidFor } from '@ember/object/internals';
import { FormField } from './form-field';
import type { FormSectionRegistry } from './form-field';
import { FormLayout } from './form-layout';
import { ClaimSet, FormContext, isBlocking, sortIssues } from '../internal/forms-core';
import type { FormFieldHandle, FormIssue, FormSeverity } from '../internal/forms-core';

// ── FormSection ──────────────────────────────────────────────────────────
// Grouping. A real <fieldset> with a real <legend>, because that pairing IS
// the group for assistive technology — a div with a heading beside it is a
// heading beside some inputs, and a screen reader entering the third input
// has no idea it is in "Billing Address". SLDS groups form content the same
// way (its `slds-form-element` compound/address variants are fieldsets).
//
// The element also does real work: <fieldset disabled> natively disables
// every control inside it, including caller-supplied ones this component has
// never heard of — no context plumbing, no per-control flag. And the spec
// exempts the first <legend>'s descendants from that disabling, which is
// exactly right: a disabled section can still be expanded and collapsed.
//
// COLLAPSED SECTIONS AND HIDDEN ERRORS — the decision, stated:
// a collapsed section hides its body with `hidden`; it does NOT drop it from
// the DOM. That single choice buys three things. (1) Fields inside a
// collapsed section stay registered, so their issues still route and the
// ErrorSummary still lists them — an error behind a disclosure is never
// dropped. (2) The section can therefore count its own issues while shut,
// and shows that count in the legend, which becomes part of the group's
// accessible name. (3) Because the field exists, focus routing can reach it:
// the section registers a reveal callback with the form, so an ErrorSummary
// row or a refused submit opens the section and lands focus on the control.
// On top of that the section AUTO-EXPANDS once a commit has been refused and
// it holds a blocking issue — a user cannot fix what they cannot see, and
// leaving them to hunt through disclosures is the enterprise-form sin this
// whole territory exists to avoid. The cost is that collapsing saves no
// render work; for a section whose content is genuinely expensive, render it
// lazily yourself and declare @paths so the count still works.

export interface FormSectionSignature {
  Args: {
    /** The legend. This is the group's accessible name. */
    title?: string;
    /** Optional prose under the legend, wired to the fieldset with
     *  aria-describedby. */
    description?: string;
    /** Give the section a disclosure button. */
    collapsible?: boolean;
    /** Controlled open state. Omit and use @defaultOpen for uncontrolled. */
    open?: boolean;
    /** Uncontrolled seed. Default true. */
    defaultOpen?: boolean;
    /** Fires with the requested state whenever the disclosure moves. */
    onOpenChange?: (open: boolean) => void;
    /** Native fieldset disabling — every control inside goes dead, the
     *  disclosure button keeps working. */
    disabled?: boolean;
    /** Paths this section owns, for a section whose fields are rendered
     *  lazily and so cannot register themselves. Merged with the registered
     *  set; normally unnecessary. */
    paths?: string[];
    /** Issues to consider, when used WITHOUT a Form. */
    issues?: FormIssue[];
    /** Hide the legend's issue count. Leaving this on is strongly advised —
     *  it is the collapsed section's only synchronous signal. */
    hideIssueCount?: boolean;
    /** Grid columns to span inside a FormLayout. Default: all of them. */
    span?: number;
    /** The owning form's context. Supplied automatically by `form.Section`. */
    form?: FormContext;
  };
  Blocks: {
    /** Section content. Receives { Field, Layout, open, issues }. */
    default: [FormSectionApi];
    /** Rendered at the right of the legend row — a row-count, an "Add" link. */
    actions: [];
  };
  Element: HTMLFieldSetElement;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- curried contextual
   components, any-typed exactly as in freestyle.gts's Args hash */
export interface FormSectionApi {
  /** FormField, pre-curried with the form context AND this section. */
  Field: any;
  /** FormLayout, pre-curried with both, so a two-column arrangement inside a
   *  section still counts toward the section's issue badge. */
  Layout: any;
  open: boolean;
  issues: FormIssue[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class FormSection
  extends Component<FormSectionSignature>
  implements FormSectionRegistry
{
  private guid = guidFor(this);
  private claims = new ClaimSet();

  @tracked internalOpen = this.args.defaultOpen ?? true;
  /** Set when the form asks the section to open so focus can land inside. */
  @tracked revealed = false;

  get id(): string {
    return `${this.guid}-sec`;
  }
  get bodyId(): string {
    return `${this.guid}-secbody`;
  }
  get descriptionId(): string {
    return `${this.guid}-secdsc`;
  }

  constructor(owner: unknown, args: FormSectionSignature['Args']) {
    super(owner as never, args);
    this.args.form?.registerSection(this.id, this.reveal);
  }
  willDestroy(): void {
    super.willDestroy();
    this.args.form?.unregisterSection(this.id);
    this.claims.teardown();
  }

  claimField = (handle: FormFieldHandle): void => {
    this.claims.add(handle);
  };
  releaseField = (rootId: string): void => {
    this.claims.remove(rootId);
  };

  get collapsible(): boolean {
    return Boolean(this.args.collapsible);
  }
  get open(): boolean {
    if (!this.collapsible) {
      return true;
    }
    if (this.revealed || this.forcedOpen) {
      return true;
    }
    return this.args.open ?? this.internalOpen;
  }
  /** A refused commit must never leave a blocking issue behind a shut
   *  disclosure. */
  get forcedOpen(): boolean {
    return Boolean(this.args.form?.submitAttempted) && this.blockingCount > 0;
  }
  get hiddenAttr(): string | undefined {
    return this.open ? undefined : 'hidden';
  }
  get describedBy(): string | undefined {
    return this.args.description ? this.descriptionId : undefined;
  }
  get spanStyleAttr(): string {
    return this.args.span === undefined ? 'all' : String(this.args.span);
  }

  get sectionIssues(): FormIssue[] {
    let source = this.args.issues ?? this.args.form?.issues ?? [];
    let declared = this.args.paths;
    return sortIssues(
      source.filter(
        (issue) =>
          this.claims.has(issue.targetPath) ||
          (declared !== undefined && declared.includes(issue.targetPath)),
      ),
    );
  }
  get blockingCount(): number {
    return this.sectionIssues.filter(isBlocking).length;
  }
  get advisoryCount(): number {
    return this.sectionIssues.length - this.blockingCount;
  }
  /** The badge obeys the same rule as every other error surface: in submit
   *  mode a form is not "in error" until the user has tried to commit, so a
   *  pristine form must not have one section already shouting. Advisories are
   *  never withheld — they are advice, not a verdict. */
  get holdErrors(): boolean {
    let form = this.args.form;
    return (
      form !== undefined &&
      form.mode === 'submit' &&
      !form.submitAttempted &&
      this.args.issues === undefined
    );
  }
  get visibleBlockingCount(): number {
    return this.holdErrors ? 0 : this.blockingCount;
  }
  get badgeText(): string | undefined {
    if (this.args.hideIssueCount) {
      return undefined;
    }
    if (this.visibleBlockingCount > 0) {
      return this.visibleBlockingCount === 1
        ? '1 error'
        : `${this.visibleBlockingCount} errors`;
    }
    if (this.advisoryCount > 0) {
      return this.advisoryCount === 1
        ? '1 notice'
        : `${this.advisoryCount} notices`;
    }
    return undefined;
  }
  get badgeSeverity(): FormSeverity {
    return this.visibleBlockingCount > 0 ? 'error' : 'warning';
  }
  get expandedAttr(): string {
    return this.open ? 'true' : 'false';
  }

  reveal = (): void => {
    this.revealed = true;
    if (this.args.open === undefined) {
      this.internalOpen = true;
    } else {
      this.args.onOpenChange?.(true);
    }
  };

  toggle = (): void => {
    let next = !this.open;
    this.revealed = false;
    if (this.args.open === undefined) {
      this.internalOpen = next;
    }
    this.args.onOpenChange?.(next);
  };

  <template>
    <fieldset
      class='pretui-formsection'
      id={{this.id}}
      data-pretui-form-section={{this.id}}
      disabled={{@disabled}}
      aria-describedby={{this.describedBy}}
      data-open={{if this.open 'true' 'false'}}
      data-collapsible={{if this.collapsible 'true'}}
      data-span={{this.spanStyleAttr}}
      data-test-pretui-form-section
      ...attributes
    >
      <legend class='pretui-formsection-legend'>
        {{#if this.collapsible}}
          <button
            type='button'
            class='pretui-formsection-toggle'
            aria-expanded={{this.expandedAttr}}
            aria-controls={{this.bodyId}}
            {{on 'click' this.toggle}}
          >
            <span class='pretui-formsection-caret' aria-hidden='true'></span>
            <span class='pretui-formsection-title'>{{@title}}</span>
          </button>
        {{else}}
          <span class='pretui-formsection-title'>{{@title}}</span>
        {{/if}}
        {{#if this.badgeText}}
          {{! In the legend on purpose: the legend IS the group's accessible
              name, so a collapsed section announces "Terms & Approval, 1
              error" the moment AT reaches it. }}
          <span
            class='pretui-formsection-badge'
            data-severity={{this.badgeSeverity}}
          >{{this.badgeText}}</span>
        {{/if}}
        {{#if (has-block 'actions')}}
          <span class='pretui-formsection-actions'>{{yield to='actions'}}</span>
        {{/if}}
      </legend>
      {{#if @description}}
        <p
          class='pretui-formsection-description'
          id={{this.descriptionId}}
        >{{@description}}</p>
      {{/if}}
      <div
        class='pretui-formsection-body'
        id={{this.bodyId}}
        data-pretui-form-section-body
        hidden={{this.hiddenAttr}}
      >
        {{yield
          (hash
            Field=(component FormField form=@form section=this)
            Layout=(component FormLayout form=@form section=this)
            open=this.open
            issues=this.sectionIssues
          )
        }}
      </div>
    </fieldset>
    <style scoped>
      @layer PretComponent {
        /* Fieldset's UA dress is a border and a legend that punches through it
           — Law 1 says depth is a hairline plus a shadow, never a box drawn for
           separation, so the UA chrome goes and the section reads as a titled
           block of rhythm. */
        .pretui-formsection {
          display: grid;
          gap: var(--pretui-section-gap, var(--space-4, 11px));
          align-content: start;
          min-width: 0;
          margin: 0;
          padding: 0;
          border: 0;
          /* Sections are grid items of a FormLayout; a group spans the whole
             grid unless told otherwise. */
          grid-column: 1 / -1;
        }
        .pretui-formsection[data-span='1'] {
          grid-column: span 1;
        }
        .pretui-formsection[data-span='2'] {
          grid-column: span 2;
        }
        .pretui-formsection-legend {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          width: 100%;
          padding: 0 0 var(--space-3, 8px);
          box-shadow: 0 1px 0 var(--border);
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-weight: 600;
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-formsection-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          letter-spacing: inherit;
          text-transform: inherit;
          color: inherit;
          cursor: pointer;
        }
        .pretui-formsection-toggle:hover {
          color: var(--foreground);
        }
        .pretui-formsection-toggle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 3px;
          border-radius: 3px;
        }
        /* One state, one property: the caret turns. Law 5 — the rotation
           encodes open/closed, which is a state transition the reader would
           otherwise have to infer, and the END state is what shows with
           reduced motion. */
        .pretui-formsection-caret {
          width: 0;
          height: 0;
          flex: none;
          border-top: 4px solid transparent;
          border-bottom: 4px solid transparent;
          border-left: 5px solid currentColor;
          transition: transform var(--pretui-dur-snap, 180ms)
            var(--pretui-ease-snap, ease);
        }
        .pretui-formsection[data-open='true'] .pretui-formsection-caret {
          transform: rotate(90deg);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-formsection-caret {
            transition: none;
          }
        }
        .pretui-formsection-title {
          min-width: 0;
        }
        .pretui-formsection-badge {
          --pretui-issue-hue: var(--pretui-issue-error, var(--destructive));
          flex: none;
          padding: 0 6px;
          border-radius: 4px;
          font-size: var(--text-ui-xs, 11px);
          letter-spacing: var(--track-eyebrow, 0.08em);
          background: color-mix(
            in oklch,
            var(--pretui-issue-hue) var(--pretui-chip-mix, 18%),
            var(--card)
          );
          color: color-mix(
            in oklch,
            var(--foreground) 30%,
            var(--pretui-issue-hue)
          );
          box-shadow: 0 0 0 1px
            color-mix(in oklch, var(--pretui-issue-hue) 28%, var(--border));
        }
        .pretui-formsection-badge[data-severity='warning'] {
          --pretui-issue-hue: var(--pretui-issue-warning, var(--warning, var(--boxel-warning)));
        }
        .pretui-formsection-actions {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 6px;
          text-transform: none;
          letter-spacing: normal;
        }
        .pretui-formsection-description {
          margin: 0;
          font-family: var(--font-sans);
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 16px;
          color: var(--muted-foreground);
        }
        .pretui-formsection-body {
          display: grid;
          gap: var(--pretui-section-gap, var(--space-4, 11px));
          align-content: start;
          min-width: 0;
        }
        /* A disabled fieldset dims as one block; nothing inside has to know. */
        .pretui-formsection:disabled .pretui-formsection-body {
          opacity: var(--pretui-field-disabled-opacity, 0.5);
        }
      }
    </style>
  </template>
}
