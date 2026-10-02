// Pretui — FormField: a labelled control that registers with its Form and routes its issues.
import Component from '@glimmer/component';
import { guidFor } from '@ember/object/internals';
import { Label } from './label';
import { Tooltip } from './tooltip';
import { FieldError } from './field-error';
import { FormContext, isBlocking, normalizeSeverity, sortIssues } from '../internal/forms-core';
import type { FormFieldHandle, FormIssue, FormMode, FormSeverity } from '../internal/forms-core';

// ── FormField ────────────────────────────────────────────────────────────
// The workhorse: SLDS's `.slds-form-element` with its __label / __icon /
// __control / __help / __static parts and its _stacked / _horizontal /
// _readonly modifiers, wearing React Spectrum's description-and-error
// aria-describedby semantics.
//
// It takes a PLAIN VALUE and a PATH. It does not take a FieldDef, does not
// know what a schema is, and does not own a control: the control arrives as
// the <:control> named block (Law 7 — anything visual a caller might replace
// is a slot, not a string), and the field yields it everything it needs to
// wire itself: id, describedBy, invalid, required, disabled, readonly.
//
// Dropped from SLDS on purpose:
//   • `_compound` / `_address` fieldset variants — a compound field is a
//     GROUP of fields, which is FormLayout's job plus a <fieldset>; folding
//     it into the field element is what makes the SLDS component take
//     twenty-six props.
//   • `hasLeftIcon` / `hasRightIcon` / `hasRightIconGroup` — icon affordances
//     inside the control belong to the control (Pretui's InputGroup already
//     does this properly); a field should not be telling its slot where its
//     own icons go.
//   • `slds-hint-parent` — a hover-reveal for the inline-edit pencil. Reveal
//     -on-hover hides an affordance from touch and keyboard users; the
//     <:after> slot renders whatever it is given, always visible.
//   • `column` (`_1-col` / `_2-col`) is kept, but as @span, since the columns
//     themselves are FormLayout's grid rather than a class on the field.

/** What a FormSection needs from the fields inside it, so it can count the
 *  issues it owns even while collapsed. Supplied automatically by
 *  `section.Field` / `section.Layout`. */
export interface FormSectionRegistry {
  claimField(handle: FormFieldHandle): void;
  releaseField(rootId: string): void;
}

export interface FormControlContext {
  /** id for the control — the label's `for` points here. */
  id: string;
  /** id of the label element. */
  labelId: string;
  /** Space-joined description + error ids, or undefined when there is
   *  nothing to describe. Put this on the control's aria-describedby. */
  describedBy: string | undefined;
  /** id of the description region, if any. */
  descriptionId: string | undefined;
  /** id of the message region, if any issues are showing. */
  errorId: string | undefined;
  /** True when a blocking issue is showing — set aria-invalid from this. */
  invalid: boolean;
  required: boolean;
  disabled: boolean;
  readonly: boolean;
  /** The field's BXL label path, passed through for convenience. */
  path: string | undefined;
  /** Call from the control's own change handler when a form-level dirty flag
   *  is wanted without relying on the form's input/change listener. */
  markDirty: () => void;
}

export interface FormFieldSignature {
  Args: {
    /** Visible label. Rendered through Pretui's Label (the mono eyebrow
     *  voice), as a <label for> normally and a <span> in static display. */
    label?: string;
    /** BXL label path this field stands for. Issues whose targetPath equals
     *  this string — whole-string, never parsed — are picked up. */
    path?: string;
    /** The plain value — a string, a number, a boolean, or nothing. NOT a
     *  FieldDef: a form field here is a value and a path, which is the whole
     *  point of building this in a component library first. Used only for
     *  the static display; an editable field gets its value from whatever
     *  control the caller puts in <:control>. Anything richer than a scalar
     *  belongs in the <:static> block. */
    value?: string | number | boolean | null;
    /** Persistent helper prose under the control. Joined into describedBy
     *  ahead of any error, matching React Spectrum's order. */
    description?: string;
    /** Field-level help. Reveals on hover/focus of the help button and is
     *  wired to it with a unique id (SLDS hardcodes id="help"). */
    help?: string;
    /** Marks required: an aria-hidden asterisk plus a visually-hidden
     *  "(required)" inside the label, and required:true in the control
     *  context. */
    required?: boolean;
    /** Suppress the asterisk only; the accessible marking stays. */
    hideRequiredIndicator?: boolean;
    /** Disabled: the control cannot be used and the field dims. */
    disabled?: boolean;
    /** Read-only, SLDS `_readonly`: the value is still selectable and the
     *  control still focusable, but the field's chrome flattens. A DIFFERENT
     *  render from @disabled on purpose — "you may not change this" and "this
     *  is not available right now" are different sentences. */
    readonly?: boolean;
    /** Static display, SLDS `__static`: no control at all, the value as text
     *  under a faux <span> label. The resting state of a record page. */
    static?: boolean;
    /** Force the invalid dress without an issue (e.g. a control that failed
     *  its own native constraint). */
    invalid?: boolean;
    /** Issues for this field, when used WITHOUT a Form. Overrides the
     *  form-routed set. */
    issues?: FormIssue[];
    /** 'stacked' (label above) or 'horizontal' (label beside). FormLayout
     *  curries this in; it collapses to stacked in a narrow container. */
    layout?: 'stacked' | 'horizontal';
    /** Grid columns to span inside a FormLayout — SLDS's `_2-col`. */
    span?: number;
    /** Supply your own control id instead of the generated one. */
    controlId?: string;
    /** Keep the label in the accessible tree but out of the picture. */
    labelHidden?: boolean;
    /** Reserve the message row's height so a row of side-by-side fields does
     *  not jump when an error appears. Default true. */
    reserveMessageSpace?: boolean;
    /** Render warning/info issues as well as errors. Default true. */
    showAdvisory?: boolean;
    /** Print each issue's ruleId as a Token — provenance for rule authors. */
    showRuleId?: boolean;
    /** Override the live-region policy (default: announce in record mode
     *  only — see FieldError's note). */
    announceErrors?: boolean;
    /** Placeholder for a static display with no value. Default '—'. */
    emptyText?: string;
    /** The owning form's context. Supplied automatically by `form.Field`. */
    form?: FormContext;
    /** The enclosing FormSection, if any. Supplied automatically by
     *  `section.Field` / `grid.Field` inside a section. */
    section?: FormSectionRegistry;
  };
  Blocks: {
    /** The control. Receives everything needed to wire itself. */
    control: [FormControlContext];
    /** Static display body — richer than a bare value (a link, an Avatar,
     *  a Chip). Falls back to @value. */
    static: [];
    /** Rich description, instead of the @description string. */
    description: [];
    /** Rendered beside the control: SLDS's `__undo` revert button, an inline
     *  edit pencil, a unit suffix. */
    after: [];
  };
  Element: HTMLDivElement;
}

function either(a: unknown, b: unknown): boolean {
  return Boolean(a) || Boolean(b);
}

export class FormField
  extends Component<FormFieldSignature>
  implements FormFieldHandle
{
  private guid = guidFor(this);

  get rootId(): string {
    return `${this.guid}-fld`;
  }
  get controlId(): string {
    return this.args.controlId ?? `${this.guid}-ctl`;
  }
  get labelId(): string {
    return `${this.guid}-lbl`;
  }
  get descriptionId(): string {
    return `${this.guid}-dsc`;
  }
  get messageId(): string {
    return `${this.guid}-msg`;
  }
  get helpId(): string {
    return `${this.guid}-help`;
  }
  get path(): string {
    return this.args.path ?? '';
  }

  constructor(owner: unknown, args: FormFieldSignature['Args']) {
    super(owner as never, args);
    this.args.form?.registerField(this);
    this.args.section?.claimField(this);
  }
  willDestroy(): void {
    super.willDestroy();
    this.args.form?.unregisterField(this.rootId);
    this.args.section?.releaseField(this.rootId);
  }

  get mode(): FormMode {
    return this.args.form?.mode ?? 'submit';
  }
  get layout(): 'stacked' | 'horizontal' {
    return this.args.layout ?? 'stacked';
  }
  get disabled(): boolean {
    return Boolean(this.args.disabled || this.args.form?.disabled);
  }
  get readonly(): boolean {
    return Boolean(this.args.readonly);
  }
  get emptyText(): string {
    return this.args.emptyText ?? '—';
  }
  get displayValue(): string | number | boolean {
    let value = this.args.value;
    return value === undefined || value === null || value === ''
      ? this.emptyText
      : value;
  }
  get showRequiredMark(): boolean {
    return Boolean(this.args.required) && !this.args.hideRequiredIndicator;
  }
  get helpLabel(): string {
    return this.args.label ? `Help: ${this.args.label}` : 'Help';
  }
  get reserveMessageSpace(): boolean {
    return this.args.reserveMessageSpace ?? true;
  }
  get span(): number | undefined {
    return this.args.span;
  }

  /** Issues routed to this field. @issues wins so the component works
   *  stand-alone; otherwise the form's list is filtered by WHOLE-STRING
   *  equality on targetPath. */
  get issues(): FormIssue[] {
    if (this.args.issues) {
      return sortIssues(this.args.issues);
    }
    return this.args.form?.issuesFor(this.args.path) ?? [];
  }

  /** In `submit` mode a field is not "invalid" before the user has tried to
   *  commit — React Spectrum's rule, and the reason a fresh form is not a
   *  wall of red. Advisory issues are never withheld: they are advice, not a
   *  verdict. */
  get holdErrors(): boolean {
    return (
      this.mode === 'submit' &&
      this.args.form !== undefined &&
      !this.args.form.submitAttempted &&
      this.args.issues === undefined
    );
  }
  get visibleIssues(): FormIssue[] {
    let visible =
      this.args.showAdvisory === false ? this.issues.filter(isBlocking) : this.issues;
    return this.holdErrors ? visible.filter((issue) => !isBlocking(issue)) : visible;
  }
  get invalid(): boolean {
    return (
      Boolean(this.args.invalid) || this.visibleIssues.some(isBlocking)
    );
  }
  get topSeverity(): FormSeverity | undefined {
    let first = this.visibleIssues[0];
    return first ? normalizeSeverity(first.severity) : undefined;
  }
  get announce(): boolean {
    return this.args.announceErrors ?? this.mode === 'record';
  }
  get rootRole(): string | undefined {
    // Static display has no control for the label to point at, so the pair
    // is exposed as a labelled group instead of an orphaned span.
    return this.args.static ? 'group' : undefined;
  }
  get rootLabelledBy(): string | undefined {
    return this.args.static && this.args.label ? this.labelId : undefined;
  }

  /** Built in the template so it can see (has-block 'description'). */
  describedByFor = (hasDescriptionBlock: boolean): string | undefined => {
    let ids: string[] = [];
    if (hasDescriptionBlock || this.args.description) {
      ids.push(this.descriptionId);
    }
    if (this.visibleIssues.length > 0) {
      ids.push(this.messageId);
    }
    return ids.length > 0 ? ids.join(' ') : undefined;
  };

  controlContextFor = (hasDescriptionBlock: boolean): FormControlContext => ({
    id: this.controlId,
    labelId: this.labelId,
    describedBy: this.describedByFor(hasDescriptionBlock),
    descriptionId:
      hasDescriptionBlock || this.args.description ? this.descriptionId : undefined,
    errorId: this.visibleIssues.length > 0 ? this.messageId : undefined,
    invalid: this.invalid,
    required: Boolean(this.args.required),
    disabled: this.disabled,
    readonly: this.readonly,
    path: this.args.path,
    markDirty: this.markDirty,
  });

  markDirty = (): void => {
    this.args.form?.markDirty();
  };

  <template>
    {{#let (has-block 'description') as |hasDescriptionBlock|}}
      <div
        class='pretui-formfield'
        id={{this.rootId}}
        role={{this.rootRole}}
        aria-labelledby={{this.rootLabelledBy}}
        tabindex='-1'
        data-layout={{this.layout}}
        data-mode={{this.mode}}
        data-invalid={{if this.invalid 'true'}}
        data-severity={{this.topSeverity}}
        data-required={{if @required 'true'}}
        data-disabled={{if this.disabled 'true'}}
        data-readonly={{if this.readonly 'true'}}
        data-static={{if @static 'true'}}
        data-span={{this.span}}
        data-test-pretui-form-field
        ...attributes
      >
        <div class='pretui-formfield-labelrow'>
          {{#if @label}}
            <span
              class='pretui-formfield-labelbox'
              data-hidden={{if @labelHidden 'true'}}
            >
              {{#if @static}}
                <Label @tag='span' id={{this.labelId}}>
                  {{#if this.showRequiredMark}}<abbr
                      class='pretui-formfield-req'
                      aria-hidden='true'
                    >*</abbr>{{/if}}{{@label}}{{#if
                    @required
                  }}<span class='pretui-formfield-sr'>(required)</span>{{/if}}
                </Label>
              {{else}}
                <Label @for={{this.controlId}} id={{this.labelId}}>
                  {{#if this.showRequiredMark}}<abbr
                      class='pretui-formfield-req'
                      aria-hidden='true'
                    >*</abbr>{{/if}}{{@label}}{{#if
                    @required
                  }}<span class='pretui-formfield-sr'>(required)</span>{{/if}}
                </Label>
              {{/if}}
            </span>
          {{/if}}
          {{#if @help}}
            <span class='pretui-formfield-helpwrap'>
              <Tooltip @content={{@help}} @side='top'>
                <button
                  type='button'
                  class='pretui-formfield-helpbtn'
                  aria-label={{this.helpLabel}}
                  aria-describedby={{this.helpId}}
                >?</button>
              </Tooltip>
              {{! The bubble Tooltip renders cannot be referenced (it exposes
                  no id), so the described text is mirrored here where
                  aria-describedby can actually resolve it. Named rather than
                  hidden: Tooltip wants an @id arg, filed for the next wave. }}
              <span id={{this.helpId}} class='pretui-formfield-sr'>{{@help}}</span>
            </span>
          {{/if}}
        </div>

        <div class='pretui-formfield-main'>
          <div class='pretui-formfield-controlrow'>
            {{#if @static}}
              <div class='pretui-formfield-static' data-pretui-form-control>
                {{#if (has-block 'static')}}
                  {{yield to='static'}}
                {{else}}
                  {{this.displayValue}}
                {{/if}}
              </div>
            {{else}}
              <div class='pretui-formfield-control' data-pretui-form-control>
                {{yield (this.controlContextFor hasDescriptionBlock) to='control'}}
              </div>
            {{/if}}
            {{#if (has-block 'after')}}
              <div class='pretui-formfield-after'>{{yield to='after'}}</div>
            {{/if}}
          </div>

          {{#if (either hasDescriptionBlock @description)}}
            <div class='pretui-formfield-description' id={{this.descriptionId}}>
              {{#if hasDescriptionBlock}}
                {{yield to='description'}}
              {{else}}
                {{@description}}
              {{/if}}
            </div>
          {{/if}}

          <div
            class='pretui-formfield-msgs'
            id={{this.messageId}}
            data-reserve={{if this.reserveMessageSpace 'true'}}
          >
            {{#each this.visibleIssues key='@index' as |issue|}}
              <FieldError
                @issue={{issue}}
                @announce={{this.announce}}
                @showRuleId={{@showRuleId}}
              />
            {{/each}}
          </div>
        </div>
      </div>
    {{/let}}
    <style scoped>
      @layer PretComponent {
        .pretui-formfield {
          display: grid;
          gap: var(--pretui-field-row-gap, 4px);
          align-content: start;
          min-width: 0;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
        }
        /* The root is a focus fallback for routing, never a tab stop, and must
           not draw a focus ring of its own when it takes programmatic focus —
           it draws the field's ring instead (see :focus-visible below). */
        .pretui-formfield:focus {
          outline: none;
        }
        .pretui-formfield:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 3px;
          border-radius: var(--radius);
        }
        /* SLDS `_horizontal`: label beside control on one hairline grid. */
        .pretui-formfield[data-layout='horizontal'] {
          grid-template-columns: var(--pretui-field-label-width, 9rem) minmax(0, 1fr);
          column-gap: var(--pretui-field-column-gap, var(--space-4, 11px));
          align-items: start;
        }
        .pretui-formfield[data-layout='horizontal'] .pretui-formfield-labelrow {
          min-height: var(--control-h, 28px);
          align-items: center;
        }
        /* Unnamed container query only — the named form silently deletes every
           following rule in the file. Resolves against the nearest ANCESTOR
           container, which is FormLayout's outer element; with no FormLayout
           above it there is no container and the query simply never matches,
           so a stand-alone horizontal field stays horizontal. */
        @container (max-width: 34rem) {
          .pretui-formfield[data-layout='horizontal'] {
            grid-template-columns: minmax(0, 1fr);
          }
          .pretui-formfield[data-layout='horizontal'] .pretui-formfield-labelrow {
            min-height: 0;
            align-items: flex-start;
          }
        }
        /* SLDS's `_2-col` — declared here rather than by FormLayout because
           scoped CSS cannot reach a child component's root element. */
        .pretui-formfield[data-span='2'] {
          grid-column: span 2;
        }
        .pretui-formfield[data-span='3'] {
          grid-column: span 3;
        }
        .pretui-formfield-labelrow {
          display: flex;
          align-items: flex-start;
          gap: 4px;
          min-width: 0;
        }
        .pretui-formfield-labelbox {
          min-width: 0;
        }
        .pretui-formfield-labelbox[data-hidden='true'] {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-formfield-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-formfield-req {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
          text-decoration: none;
          margin-right: 0.25ch;
        }
        .pretui-formfield-helpbtn {
          width: 14px;
          height: 14px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 700;
          line-height: 1;
          cursor: help;
          color: var(--muted-foreground);
          background: var(--inset, var(--boxel-100));
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .pretui-formfield-helpbtn:hover {
          color: var(--foreground);
          background: var(--hover, var(--boxel-100));
        }
        .pretui-formfield-helpbtn:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-formfield-main {
          display: grid;
          gap: var(--pretui-field-row-gap, 4px);
          align-content: start;
          min-width: 0;
        }
        .pretui-formfield-controlrow {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        .pretui-formfield-control {
          flex: 1 1 auto;
          min-width: 0;
        }
        .pretui-formfield-after {
          flex: none;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        /* SLDS `__static` — the record page's resting state. */
        .pretui-formfield-static {
          flex: 1 1 auto;
          min-width: 0;
          min-height: var(--control-h, 28px);
          display: flex;
          align-items: center;
          line-height: 18px;
          overflow-wrap: anywhere;
        }
        .pretui-formfield-description {
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 16px;
          color: var(--muted-foreground);
        }
        .pretui-formfield-msgs {
          display: grid;
          gap: 2px;
        }
        /* Alignment law: a row of side-by-side fields must not jump when one
           of them grows a message. */
        .pretui-formfield-msgs[data-reserve='true'] {
          min-height: 16px;
        }
        /* The invalid and readonly dresses travel through the INHERITED token
           channel — --field is the control face, --input the control hairline,
           both read by Pretui's Input / Textarea / Select. No selector reaches
           into the caller's control, so any control that speaks the Pretui
           tokens re-dresses itself for free. */
        .pretui-formfield[data-invalid='true'] {
          --input: var(--destructive);
          --field: color-mix(in oklch, var(--destructive) 5%, var(--card));
        }
        .pretui-formfield[data-severity='warning'] {
          --input: var(--warning, var(--boxel-warning));
          --field: color-mix(in oklch, var(--warning, var(--boxel-warning)) 5%, var(--card));
        }
        /* SLDS `_readonly`: the chrome goes away, the value does not. Distinct
           from disabled — nothing is dimmed and the control keeps focus. */
        .pretui-formfield[data-readonly='true'] {
          --field: transparent;
          --input: transparent;
        }
        .pretui-formfield[data-disabled='true'] {
          opacity: var(--pretui-field-disabled-opacity, 0.5);
        }
        .pretui-formfield[data-static='true'] .pretui-formfield-static {
          color: var(--foreground);
        }
      }
    </style>
  </template>
}
