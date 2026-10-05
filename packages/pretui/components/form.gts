// Pretui — Form: the host that owns issues, submit, and the context its parts register with.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { on } from '@ember/modifier';
import { hash } from '@ember/helper';
import { CompoundField } from './compound-field';
import { ErrorSummary } from './error-summary';
import { FieldError } from './field-error';
import { FormField } from './form-field';
import { FormLayout } from './form-layout';
import { FormSection } from './form-section';
import { FormContext } from '../internal/forms-core';
import type { FormFocusTarget, FormHost, FormIssue, FormMode } from '../internal/forms-core';

// ── Form ─────────────────────────────────────────────────────────────────
// The host. Three commit models, because a Boxel card autosaves and has no
// submit — wiring a classic submit form into a card edit view is exactly
// what sank the earlier attempt. SLDS had already solved this; the modes are
// its three shapes made explicit:
//
//   @mode='submit'  commit on submit · validate on submit, focus first error
//                   → React Spectrum classic. Errors are WITHHELD until the
//                     user tries to commit.
//   @mode='live'    commit per field, immediately · issues are ambient advice
//                   and never a gate → the card-autosave shape. Submitting
//                   does not refuse and does not move focus.
//   @mode='record'  commit per field inline, saved as a batch · validate per
//                   field plus a summary → the SLDS record-detail page. The
//                   <:footer> block docks (sticky, not fixed) and its save
//                   goes through the same gate as submit mode.
//
// @validationBehavior is React Spectrum's switch, same names: 'aria'
// (default) puts `novalidate` on the form so the browser's own bubbles never
// race ours; 'native' leaves native constraint validation switched on.
//
// The form NEVER validates. It is handed FormIssue[] and does three things
// with them: routes them to fields by whole-string path equality, gates the
// commit on the blocking ones, and moves focus when it refuses.

/* eslint-disable @typescript-eslint/no-explicit-any -- the curried
   contextual components in the yielded hash are any-typed exactly as in
   freestyle.gts's Args hash; every other member is precisely typed. */
export interface FormApi {
  /** FormField, pre-bound to this form's context. */
  Field: any;
  /** FormLayout, pre-bound to this form's context. */
  Layout: any;
  /** FormSection, pre-bound to this form's context — a real fieldset. */
  Section: any;
  /** ErrorSummary, pre-bound to this form's context. */
  Summary: any;
  /** CompoundField, pre-bound to this form's context. */
  Compound: any;
  /** FieldError, for rendering an issue outside a field. */
  Error: any;
  context: FormContext;
  mode: FormMode;
  issues: FormIssue[];
  blockingIssues: FormIssue[];
  hasBlockingIssues: boolean;
  unroutedIssues: FormIssue[];
  dirty: boolean;
  pristine: boolean;
  submitted: boolean;
  disabled: boolean;
  busy: boolean;
  submit: () => void;
  reset: () => void;
  markDirty: () => void;
  markPristine: () => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface FormSignature {
  Args: {
    /** 'submit' (default) | 'live' | 'record'. See the table above. */
    mode?: FormMode;
    /** Already-computed issues. The component never produces these. */
    issues?: FormIssue[];
    /** Disable every field at once (travels through the context). */
    disabled?: boolean;
    /** A commit is in flight: sets aria-busy and blocks re-submission. */
    busy?: boolean;
    /** Called on a commit that passed the gate. */
    onSubmit?: (event: Event) => void;
    /** Called when the native form resets. */
    onReset?: (event: Event) => void;
    /** Called with the blocking issues when a commit is refused — the hook
     *  for a toast, a telemetry ping, or a scroll. */
    onInvalidSubmit?: (issues: FormIssue[]) => void;
    /** Where focus lands on a refused commit: 'field' (default, React
     *  Spectrum's behavior), 'summary' (the GOV.UK behavior), or 'none'. */
    focusOnInvalid?: FormFocusTarget;
    /** 'aria' (default) adds novalidate; 'native' leaves the browser's own
     *  constraint validation and its bubbles switched on. */
    validationBehavior?: 'aria' | 'native';
    /** Accessible name for the form landmark. */
    label?: string;
    /** id of an element naming the form, if a heading already does it. */
    labelledBy?: string;
  };
  Blocks: {
    /** The form body. Receives the whole API. */
    default: [FormApi];
    /** Action bar. Docks (sticky) in record mode. NOTE: using this block
     *  means the body must be written as an explicit <:default> — mixing
     *  loose content with named blocks fails the realm transpile. */
    footer: [FormApi];
  };
  Element: HTMLFormElement;
}

export class Form extends Component<FormSignature> implements FormHost {
  context = new FormContext(this);

  get mode(): FormMode {
    return this.args.mode ?? 'submit';
  }
  get issues(): FormIssue[] {
    return this.args.issues ?? [];
  }
  get disabled(): boolean {
    return Boolean(this.args.disabled);
  }
  get busy(): boolean {
    return Boolean(this.args.busy);
  }
  get focusOnInvalid(): FormFocusTarget {
    return this.args.focusOnInvalid ?? 'field';
  }
  /** 'aria' is React Spectrum's default and ours: we own the messaging, so
   *  the browser must not also pop its own bubbles over our fields. */
  get novalidateAttr(): string | undefined {
    return (this.args.validationBehavior ?? 'aria') === 'aria'
      ? 'novalidate'
      : undefined;
  }
  /** live mode has no gate at all — issues there are advice, and refusing a
   *  commit would contradict per-field autosave. */
  get gates(): boolean {
    return this.mode !== 'live';
  }
  get isDocked(): boolean {
    return this.mode === 'record';
  }

  willDestroy(): void {
    super.willDestroy();
    this.context.teardown();
  }

  handleSubmit = (event: Event): void => {
    event.preventDefault();
    this.context.submitAttempted = true;
    if (this.busy) {
      return;
    }
    if (this.gates && this.context.hasBlockingIssues) {
      this.args.onInvalidSubmit?.(this.context.blockingIssues);
      this.context.focusInvalid();
      return;
    }
    this.args.onSubmit?.(event);
  };

  handleReset = (event: Event): void => {
    this.context.markPristine();
    this.args.onReset?.(event);
  };

  // Dirty tracking rides the form's own bubbled input/change, so a caller
  // does not have to remember to call markDirty from every control. The
  // control context yields markDirty as well for controls that commit
  // without emitting either (a custom picker, a drag handle).
  handleEdit = (_event: Event): void => {
    this.context.markDirty();
  };

  private formEl: HTMLFormElement | undefined;
  captureForm = modifier((el: HTMLFormElement) => {
    this.formEl = el;
    return () => {
      this.formEl = undefined;
    };
  });

  // Through the element, so native validation and the caller's own listeners
  // see the same submit and reset a button would produce.
  requestSubmit = (): void => {
    if (this.disabled) {
      return;
    }
    if (this.formEl) {
      this.formEl.requestSubmit();
    } else {
      this.handleSubmit(new Event('submit', { cancelable: true }));
    }
  };
  requestReset = (): void => {
    if (this.disabled) {
      return;
    }
    if (this.formEl) {
      this.formEl.reset();
    } else {
      this.handleReset(new Event('reset'));
    }
  };

  <template>
    <form
      class='pretui-form'
      novalidate={{this.novalidateAttr}}
      aria-busy={{if this.busy 'true'}}
      aria-label={{@label}}
      aria-labelledby={{@labelledBy}}
      data-mode={{this.mode}}
      data-dirty={{if this.context.dirty 'true'}}
      data-submitted={{if this.context.submitAttempted 'true'}}
      data-busy={{if this.busy 'true'}}
      data-test-pretui-form
      {{on 'submit' this.handleSubmit}}
      {{on 'reset' this.handleReset}}
      {{this.captureForm}}
      {{on 'input' this.handleEdit}}
      {{on 'change' this.handleEdit}}
      ...attributes
    >
      {{#let
        (hash
          Field=(component FormField form=this.context)
          Layout=(component FormLayout form=this.context)
          Section=(component FormSection form=this.context)
          Compound=(component CompoundField form=this.context)
          Summary=(component ErrorSummary form=this.context)
          Error=FieldError
          context=this.context
          mode=this.mode
          issues=this.issues
          blockingIssues=this.context.blockingIssues
          hasBlockingIssues=this.context.hasBlockingIssues
          unroutedIssues=this.context.unroutedIssues
          dirty=this.context.dirty
          pristine=this.context.pristine
          submitted=this.context.submitAttempted
          disabled=this.disabled
          busy=this.busy
          submit=this.requestSubmit
          reset=this.requestReset
          markDirty=this.context.markDirty
          markPristine=this.context.markPristine
        )
        as |api|
      }}
        <div class='pretui-form-body'>{{yield api}}</div>
        {{#if (has-block 'footer')}}
          <div
            class='pretui-form-footer'
            data-docked={{if this.isDocked 'true'}}
          >{{yield api to='footer'}}</div>
        {{/if}}
      {{/let}}
    </form>
    <style scoped>
      @layer PretComponent {
        .pretui-form {
          display: grid;
          gap: var(--pretui-form-gap, var(--space-5, 14px));
          align-content: start;
          min-width: 0;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
        }
        .pretui-form-body {
          display: grid;
          gap: var(--pretui-form-gap, var(--space-5, 14px));
          align-content: start;
          min-width: 0;
        }
        .pretui-form-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        /* SLDS's docked-form-footer, minus the viewport-pinned positioning and
           full-bleed width that put its bar over the host's own chrome when the
           form lives in a card pane. Sticky keeps it at the bottom of the
           form's own scroll box, where it belongs. */
        .pretui-form-footer[data-docked='true'] {
          position: sticky;
          bottom: 0;
          z-index: 2;
          margin-top: calc(var(--space-3, 8px) * -1);
          padding: var(--space-3, 8px) var(--space-4, 11px);
          border-radius: var(--radius-surface, 10px);
          background: var(--card);
          box-shadow: var(
            --pretui-shadow-raised,
            0 0 0 1px var(--border), 0 -2px 10px rgb(0 0 0 / 0.08)
          );
        }
        /* A busy form still shows its content — it just stops taking input.
           No spinner overlay: the caller's footer owns the busy affordance
           (Button already has @busy), and an overlay would hide the very
           values the user is waiting on. */
        .pretui-form[data-busy='true'] .pretui-form-body {
          pointer-events: none;
        }
      }
    </style>
  </template>
}
