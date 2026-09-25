// Pretui — controls territory, extras wave: the remaining boxel-ui INPUT
// controls plus the typed-input split (NumberInput, PasswordInput,
// SearchInput, UrlInput). Foundation rules in force: wrap boxel-ui at
// runtime where its machinery earns its keep (EmailInput / PhoneInput
// validation engines, InputGroup's contextual accessory surface, the
// BoxelInput core under every typed input), build fresh where boxel-ui has
// nothing standalone (Stepper) or its wart list forbids reuse (CopyButton
// rides ember-velcro Tooltip) — all dressed in Pretui tokens only (h28,
// --field/--input, --radius, --text-ui-md 12.5px).
// Wave-0 adaptations (documented inline): CopyButton resets its copied
// state on pointerleave/blur instead of setTimeout (realm forbids timers);
// the boxel-ui wrappers re-skin through the semantic-token + --boxel-*
// custom-property channel on a wrapper div (their internal debounce is
// boxel-ui's own runtime, not authored here).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { htmlSafe } from '@ember/template';
import {
  BoxelInput,
  BoxelInputGroup,
  EmailInput as BoxelEmailInput,
  PhoneInput as BoxelPhoneInput,
} from '@cardstack/boxel-ui/components';
import type {
  EmailFormatValidationError,
  NormalizePhoneFormatResult,
} from '@cardstack/boxel-ui/helpers';
import { IconButton } from './icon-button';
import { emit, firstDefined } from '../pretui-primitives';
import type { IconButtonSignature } from './icon-button';
import type {
  ControlAliasArgs,
  ControlNotifyArgs,
  PretuiSizeArg,
} from '../pretui-primitives';
import {
  PasswordStrength,
  estimateWhenIdle,
  loadPasswordEstimator,
  type StrengthReading,
} from '../password-strength';

// ── Label ────────────────────────────────────────────────────────────────
// Fresh, tiny. Ported semantics from boxel-ui label/index.gts (tag
// polymorphism + default block), re-voiced as the Pretui field eyebrow:
// small-caps mono, the same voice as PropRow labels and table headers.
// boxel-ui's `(element @tag)` helper becomes simple if branches over the
// three tags a form label actually takes.

export type PretuiLabelTag = 'label' | 'span' | 'legend';

function isTag(tag: string | undefined, t: string): boolean {
  return tag === t;
}

export interface LabelSignature {
  Args: {
    tag?: PretuiLabelTag;
    /** id of the control this label points at (label tag only) */
    for?: string;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

export const Label: TemplateOnlyComponent<LabelSignature> = <template>
  {{#if (isTag @tag 'legend')}}
    <legend class='pretui-label' data-test-pretui-label ...attributes>
      {{yield}}
    </legend>
  {{else if (isTag @tag 'span')}}
    <span class='pretui-label' data-test-pretui-label ...attributes>
      {{yield}}
    </span>
  {{else}}
    <label
      class='pretui-label'
      for={{@for}}
      data-test-pretui-label
      ...attributes
    >
      {{yield}}
    </label>
  {{/if}}
  <style scoped>
    .pretui-label {
      display: inline-block;
      padding: 0;
      font-family: var(--font-mono);
      font-size: var(--text-ui-xs, 11px);
      font-weight: 500;
      line-height: 16px;
      letter-spacing: var(--track-eyebrow, 0.08em);
      text-transform: uppercase;
      color: var(--muted-foreground);
    }
  </style>
</template>;

// ── CopyButton ───────────────────────────────────────────────────────────
// Fresh small. boxel-ui's copy-button rides Tooltip (ember-velcro
// wormhole — wart list forbids); this one is an IconButton that copies
// @text to the clipboard and swaps its glyph to a success check while the
// "copied" state holds. Wave-0 adaptation: no setTimeout in the realm, so
// the state resets on pointerleave/blur instead of a 2s timer — the
// confirmation lives exactly as long as the pointer lingers.

export interface CopyButtonSignature {
  Args: {
    text?: string | null | undefined;
    /** alias — the clipboard payload is this control's value, and `@value`
     * is what Chakra/Ant/Mantine's Clipboard all call it */
    value?: string | null | undefined;
    /** accessible name while idle — 'Copy to clipboard' by default */
    label?: string;
    variant?: IconButtonSignature['Args']['variant'];
    size?: PretuiSizeArg;
  };
  Element: HTMLButtonElement;
}

export class CopyButton extends Component<CopyButtonSignature> {
  @tracked copied = false;

  get label() {
    return this.copied ? 'Copied' : (this.args.label ?? 'Copy to clipboard');
  }
  get text() {
    return firstDefined(this.args.text, this.args.value);
  }
  copy = (_e: Event) => {
    let text = this.text;
    if (text == null) {
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        this.copied = true;
      },
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      },
    );
  };
  reset = (_e: Event) => {
    this.copied = false;
  };
  <template>
    <IconButton
      @label={{this.label}}
      @variant={{@variant}}
      @size={{@size}}
      data-state={{if this.copied 'copied'}}
      data-test-pretui-copy-button
      {{on 'click' this.copy}}
      {{on 'pointerleave' this.reset}}
      {{on 'blur' this.reset}}
      ...attributes
    >
      {{#if this.copied}}
        <svg
          class='pretui-copy-check'
          width='13'
          height='13'
          viewBox='0 0 14 14'
          aria-hidden='true'
        ><path
            d='M2.5 7.5 5.5 10.5 11.5 3.5'
            fill='none'
            stroke='currentColor'
            stroke-width='1.6'
            stroke-linecap='round'
            stroke-linejoin='round'
          /></svg>
      {{else}}
        <svg
          width='13'
          height='13'
          viewBox='0 0 14 14'
          aria-hidden='true'
        ><rect
            x='4.75'
            y='4.75'
            width='7.5'
            height='7.5'
            rx='1.75'
            fill='none'
            stroke='currentColor'
            stroke-width='1.3'
          /><path
            d='M9.25 3.25v-.5a1.5 1.5 0 0 0-1.5-1.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h.5'
            fill='none'
            stroke='currentColor'
            stroke-width='1.3'
            stroke-linecap='round'
          /></svg>
      {{/if}}
    </IconButton>
    <style scoped>
      .pretui-copy-check {
        color: var(--success, var(--boxel-success));
      }
    </style>
  </template>
}

// ── Stepper ──────────────────────────────────────────────────────────────
// Fresh — the property-panel number control neither library ships
// standalone: a centered number input flanked by −/+ buttons sharing one
// hairline. Kit contract state: @tracked internal seeded from
// defaultValue, args.value ?? internal wins. Values clamp at the bounds
// and the flanking buttons disable when the value sits on them. The text
// field commits on 'change' (blur / Enter / native spinners) so clamping
// never fights mid-keystroke.

export interface StepperSignature {
  Args: {
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    controlId?: string;
    onValueChange?: (value: number) => void;
    /** aliases — the HTML/Mantine notify, the Aria boolean spelling */
    onChange?: (value: number) => void;
    isDisabled?: boolean;
  };
  Element: HTMLDivElement;
}

export class Stepper extends Component<StepperSignature> {
  @tracked internal = this.args.defaultValue ?? this.args.min ?? 0;

  get value() {
    return this.args.value ?? this.internal;
  }
  get step() {
    return this.args.step ?? 1;
  }
  get atMin() {
    return this.args.min !== undefined && this.value <= this.args.min;
  }
  get atMax() {
    return this.args.max !== undefined && this.value >= this.args.max;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get decDisabled() {
    return this.disabled || this.atMin;
  }
  get incDisabled() {
    return this.disabled || this.atMax;
  }

  private clamp(v: number) {
    if (this.args.min !== undefined) {
      v = Math.max(this.args.min, v);
    }
    if (this.args.max !== undefined) {
      v = Math.min(this.args.max, v);
    }
    return v;
  }
  private commit(v: number) {
    let next = this.clamp(v);
    if (this.args.value === undefined) {
      this.internal = next;
    }
    emit([this.args.onValueChange, this.args.onChange], next);
  }
  decrement = (_e: Event) => {
    this.commit(this.value - this.step);
  };
  increment = (_e: Event) => {
    this.commit(this.value + this.step);
  };
  handleChange = (ev: Event) => {
    let input = ev.target as HTMLInputElement;
    let v = parseFloat(input.value);
    if (Number.isNaN(v)) {
      // restore the last good value on unparsable text
      input.value = String(this.value);
      return;
    }
    this.commit(v);
    input.value = String(this.clamp(v));
  };
  <template>
    <div
      class='pretui-stepper'
      data-disabled={{if this.disabled 'true'}}
      data-test-pretui-stepper
      ...attributes
    >
      <button
        type='button'
        class='pretui-stepper-btn'
        aria-label='Decrement'
        disabled={{this.decDisabled}}
        {{on 'click' this.decrement}}
      >
        <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'><path
            d='M2 5h6'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
            stroke-linecap='round'
          /></svg>
      </button>
      <input
        id={{@controlId}}
        class='pretui-stepper-input'
        type='number'
        value={{this.value}}
        min={{@min}}
        max={{@max}}
        step={{this.step}}
        disabled={{this.disabled}}
        {{on 'change' this.handleChange}}
      />
      <button
        type='button'
        class='pretui-stepper-btn'
        aria-label='Increment'
        disabled={{this.incDisabled}}
        {{on 'click' this.increment}}
      >
        <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'><path
            d='M5 2v6M2 5h6'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
            stroke-linecap='round'
          /></svg>
      </button>
    </div>
    <style scoped>
      .pretui-stepper {
        display: inline-flex;
        align-items: stretch;
        height: var(--control-h, 28px);
        border-radius: var(--radius);
        background: var(--field, var(--boxel-light));
        box-shadow: 0 0 0 1px var(--input);
        overflow: hidden;
      }
      .pretui-stepper:has(.pretui-stepper-input:focus-visible) {
        outline: 2px solid transparent;
        outline-offset: 1px;
        box-shadow: 0 0 0 2px var(--primary),
          var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.16));
      }
      .pretui-stepper[data-disabled] {
        opacity: 0.45;
      }
      .pretui-stepper-btn {
        display: grid;
        place-items: center;
        width: 26px;
        border: 0;
        padding: 0;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
        flex: none;
      }
      .pretui-stepper-btn:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-stepper-btn:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .pretui-stepper-input {
        width: var(--pretui-stepper-w, 52px);
        min-width: 0;
        border: 0;
        padding: 0 2px;
        background: transparent;
        text-align: center;
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
        appearance: textfield;
        outline: none;
      }
      .pretui-stepper-input::-webkit-outer-spin-button,
      .pretui-stepper-input::-webkit-inner-spin-button {
        appearance: none;
        margin: 0;
      }
    </style>
  </template>
}

// ── InputGroup — WRAPS boxel-ui ──────────────────────────────────────────
// Rebuilt ON boxel-ui's InputGroup (standing reuse directive — supersedes
// the wave-0 fresh-minimal cut): the whole contextual-component surface is
// now live. The Pretui blocks map onto boxel's:
//   <:start>/<:end>   plain content, auto-wrapped in Accessories.Text —
//                     the original Pretui surface, preserved.
//   <:before>/<:after> pass boxel's Accessories through (Button /
//                     IconButton / Select / Text) for composite groups.
//   <:default>        passes boxel's Controls (Input / Textarea) +
//                     Accessories + {elementId} through for multi-control
//                     groups; boxel then ignores @value/@placeholder/@type.
// Validation graduates from boolean @invalid (kept) to boxel's @state enum
// + @errorMessage/@helperText rows. The wrapper div carries the Pretui
// re-skin via the semantic-token + --boxel-* channel; splatted attributes
// stay on the wrapper. Known wart (accepted): the Select accessory's
// dropdown portals to boxel's wormhole, so it wears boxel default colors,
// not Pretui tokens (accessory has no @renderInPlace passthrough).
// The yielded block-arg types are re-asserted locally (asAccessories /
// asControls casts) because boxel's AccessoriesBlockArg type rides
// @glint/template, which realm code cannot import.

export type InputGroupState =
  | 'none'
  | 'valid'
  | 'invalid'
  | 'loading'
  | 'initial';

interface IGButtonSignature {
  Args: { disabled?: boolean; kind?: string };
  Blocks: { default: [] };
  Element: HTMLButtonElement | HTMLAnchorElement;
}
interface IGIconButtonSignature {
  Args: {
    disabled?: boolean;
    height?: string;
    icon?: unknown;
    width?: string;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement | HTMLAnchorElement;
}
interface IGTextSignature {
  Args: unknown;
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}
interface IGSelectSignature {
  Args: {
    disabled?: boolean;
    dropdownClass?: string;
    matchTriggerWidth?: boolean;
    onChange: (item: unknown) => void;
    options: unknown[];
    placeholder?: string;
    searchEnabled?: boolean;
    searchField?: string;
    selected?: unknown;
  };
  Blocks: { default: [unknown] };
  Element: HTMLElement;
}
interface IGInputSignature {
  Args: {
    disabled?: boolean;
    onBlur?: (ev: Event) => void;
    onFocus?: (ev: Event) => void;
    onInput?: (val: string) => void;
    placeholder?: string;
    readonly?: boolean;
    required?: boolean;
    value?: string | null;
  };
  Element: HTMLInputElement;
}
interface IGTextareaSignature {
  Args: { placeholder?: string; value?: string | null };
  Element: HTMLTextAreaElement;
}

type IGComponent<S> = new (
  owner: unknown,
  args: S extends { Args: infer A } ? A : never,
) => Component<S>;

export interface InputGroupAccessories {
  Button: IGComponent<IGButtonSignature>;
  IconButton: IGComponent<IGIconButtonSignature>;
  Select: IGComponent<IGSelectSignature>;
  Text: IGComponent<IGTextSignature>;
}
export interface InputGroupControls {
  Input: IGComponent<IGInputSignature>;
  Textarea: IGComponent<IGTextareaSignature>;
}
export interface InputGroupApi {
  elementId: string;
}

function asAccessories(a: unknown): InputGroupAccessories {
  return a as InputGroupAccessories;
}
function asControls(c: unknown): InputGroupControls {
  return c as InputGroupControls;
}

export interface InputGroupSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    type?: string;
    disabled?: boolean;
    /** kept — sugar for @state='invalid' */
    invalid?: boolean;
    controlId?: string;
    onInput?: (value: string) => void;
    /** additive — boxel's validation-state enum; wins over @invalid */
    state?: InputGroupState;
    /** additive — error row under the group; renders while state=invalid */
    errorMessage?: string;
    /** additive — helper row under the group */
    helperText?: string;
    /** additive — forwarded to the built-in input */
    required?: boolean;
    readonly?: boolean;
    autocomplete?: string;
    /** alias — React Aria / Base UI spelling of @invalid */
    isInvalid?: boolean;
  };
  Blocks: {
    start: [];
    end: [];
    before: [InputGroupAccessories, InputGroupApi];
    after: [InputGroupAccessories, InputGroupApi];
    default: [InputGroupControls, InputGroupAccessories, InputGroupApi];
  };
  Element: HTMLDivElement;
}

export class InputGroup extends Component<InputGroupSignature> {
  get invalid() {
    return firstDefined(this.args.invalid, this.args.isInvalid) ?? false;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  get readonly() {
    return firstDefined(
      this.args.readonly,
      this.args.isReadOnly,
      this.args.readOnly,
    );
  }
  get state(): InputGroupState | undefined {
    return this.args.state ?? (this.invalid ? 'invalid' : undefined);
  }
  handleInput = (value: string) => {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
  };
  <template>
    <div
      class='pretui-boxelwrap pretui-inputgroup'
      data-state={{this.state}}
      data-disabled={{if this.disabled 'true'}}
      data-test-pretui-input-group
      ...attributes
    >
      {{#if (has-block)}}
        {{! Consumer supplies the controls — boxel skips its built-in input. }}
        <BoxelInputGroup
          @id={{@controlId}}
          @disabled={{this.disabled}}
          @state={{this.state}}
          @errorMessage={{@errorMessage}}
          @helperText={{@helperText}}
        >
          <:before as |Accessories group|>
            {{#if (has-block 'start')}}
              <Accessories.Text>{{yield to='start'}}</Accessories.Text>
            {{/if}}
            {{yield (asAccessories Accessories) group to='before'}}
          </:before>
          <:default as |Controls Accessories group|>
            {{yield
              (asControls Controls)
              (asAccessories Accessories)
              group
            }}
          </:default>
          <:after as |Accessories group|>
            {{yield (asAccessories Accessories) group to='after'}}
            {{#if (has-block 'end')}}
              <Accessories.Text>{{yield to='end'}}</Accessories.Text>
            {{/if}}
          </:after>
        </BoxelInputGroup>
      {{else}}
        <BoxelInputGroup
          @id={{@controlId}}
          @value={{@value}}
          @placeholder={{@placeholder}}
          @type={{@type}}
          @disabled={{this.disabled}}
          @readonly={{this.readonly}}
          @required={{this.required}}
          @autocomplete={{@autocomplete}}
          @state={{this.state}}
          @errorMessage={{@errorMessage}}
          @helperText={{@helperText}}
          @onInput={{this.handleInput}}
        >
          <:before as |Accessories group|>
            {{#if (has-block 'start')}}
              <Accessories.Text>{{yield to='start'}}</Accessories.Text>
            {{/if}}
            {{yield (asAccessories Accessories) group to='before'}}
          </:before>
          <:after as |Accessories group|>
            {{yield (asAccessories Accessories) group to='after'}}
            {{#if (has-block 'end')}}
              <Accessories.Text>{{yield to='end'}}</Accessories.Text>
            {{/if}}
          </:after>
        </BoxelInputGroup>
      {{/if}}
    </div>
    <style scoped>
      /* Pretui group dress via the token channel: field face, hairline,
         h28, r(--radius), 12.5px type; the ring token powers boxel's
         focus-within outline. */
      .pretui-inputgroup {
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-font-size-sm: var(--text-ui-sm, 11.5px);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
      .pretui-inputgroup[data-disabled] {
        opacity: 0.75;
      }
    </style>
  </template>
}

// ── EmailInput — WRAPS boxel-ui ──────────────────────────────────────────
// boxel-ui's validation engine (format checks, debounced feedback,
// blur-gated error surfacing) is the value; only the cloth changes. The
// wrapper div carries the re-skin through the semantic-token + --boxel-*
// custom-property channel — no CSS reaches into boxel-ui markup. Surface
// adaptation: boxel's 3-arg onChange(value, validationError, ev) splits
// into Pretui's @onInput(value) + @onValidation(errorMessage | null).

export interface EmailInputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    controlId?: string;
    onInput?: (value: string) => void;
    onValidation?: (error: string | null) => void;
  };
  Element: HTMLDivElement;
}

export class EmailInput extends Component<EmailInputSignature> {
  get boxelValue() {
    return this.args.value ?? null;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  handleChange = (
    value: string | null,
    validation: EmailFormatValidationError | null,
    _ev: Event,
  ) => {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value ?? '',
    );
    this.args.onValidation?.(validation ? validation.message : null);
  };
  <template>
    <div class='pretui-boxelwrap' data-test-pretui-email-input ...attributes>
      <BoxelEmailInput
        @value={{this.boxelValue}}
        @onChange={{this.handleChange}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        id={{@controlId}}
      />
    </div>
    <style scoped>
      /* Pretui control dress fed into boxel-ui's Input via its token
         channel: semantic vars (--background/--border/--ring read the
         Pretui field tokens) plus the --boxel-* dimension knobs. The two
         --boxel-sp-* overrides tune boxel's inner padding so the control
         lands on the h28 / 0-9px Pretui input geometry. */
      .pretui-boxelwrap {
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
    </style>
  </template>
}

// ── PhoneInput — WRAPS boxel-ui ──────────────────────────────────────────
// Same wrap as EmailInput: boxel-ui's awesome-phonenumber machinery
// (as-you-type formatting, E.164 normalization, region validation) intact,
// Pretui cloth via the token channel. onChange's NormalizePhoneFormatResult
// collapses to @onValidation(errorMessage | null); @onInput receives the
// sanitized value boxel emits (E.164 when valid, trimmed digits otherwise).

export interface PhoneInputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    controlId?: string;
    onInput?: (value: string) => void;
    onValidation?: (error: string | null) => void;
  };
  Element: HTMLDivElement;
}

export class PhoneInput extends Component<PhoneInputSignature> {
  get boxelValue() {
    return this.args.value ?? null;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  handleChange = (
    value: string | null,
    validation: NormalizePhoneFormatResult | null,
    _ev: Event,
  ) => {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value ?? '',
    );
    this.args.onValidation?.(
      validation && !validation.ok ? validation.error.message : null,
    );
  };
  <template>
    <div class='pretui-boxelwrap' data-test-pretui-phone-input ...attributes>
      <BoxelPhoneInput
        @value={{this.boxelValue}}
        @onChange={{this.handleChange}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        id={{@controlId}}
      />
    </div>
    <style scoped>
      /* Same re-skin channel as EmailInput — see that component's note. */
      .pretui-boxelwrap {
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
    </style>
  </template>
}

// ── Typed inputs — the input family split into first-class components ────
// Each rides BoxelInput's machinery for its native type and adds the one
// behavior that type deserves (spinners+clamping, reveal, clear,
// validation). Kit contract throughout: value?/onInput? in the EmailInput
// arg style, controlId for label wiring, data-test-pretui-* on the
// wrapper, data-* state reflection. The shared inline style wins the two
// spots the token channel cannot reach (UA font; element-local vars in
// boxel's sheet).
// Same 28px pin as controls.gts's INPUT_FONT — the seven typed wrappers
// carry the identical --boxel-sp-xs channel and were all 29.31px.
const TYPED_FONT = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: 18px; padding-block: 4px;',
);

// ── NumberInput — WRAPS boxel-ui ─────────────────────────────────────────
// BoxelInput @type='number' with the numeric knobs surfaced: @min/@max/
// @step ride the native control (spinners + keyboard), and values clamp to
// the bounds and round to @precision decimals on commit (change event —
// blur / Enter / spinners) so clamping never fights mid-keystroke.
// @onInput speaks number | null (null = empty/unparsable), Stepper-style.

export interface NumberInputSignature {
  Args: ControlNotifyArgs<number | null> & {
    value?: number | null;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
    /** decimal places applied on commit (0 = integers) */
    precision?: number;
    disabled?: boolean;
    required?: boolean;
    controlId?: string;
    onInput?: (value: number | null) => void;
    /**
     * Force the committed value back inside `@min`/`@max` (default true —
     * the behaviour this component has always had). Set false to let an
     * out-of-range value stand and be REPORTED instead: a silent clamp tells
     * the reader nothing about why their number changed, which is the whole
     * of the complaint against clamp-only number fields.
     */
    clamp?: boolean;
    /** force the invalid dress regardless of range */
    invalid?: boolean;
    /** aliases — React Aria / Base UI boolean spellings */
    isDisabled?: boolean;
    isRequired?: boolean;
    isInvalid?: boolean;
    /** message under the control; wins over the derived range message */
    errorMessage?: string;
    /** wording for the derived out-of-range message — receives (min, max),
     * either of which may be undefined */
    rangeMessage?: (min?: number, max?: number) => string;
  };
  Element: HTMLDivElement;
}

const defaultRangeMessage = (min?: number, max?: number) => {
  if (min !== undefined && max !== undefined) {
    return `Enter a number between ${min} and ${max}.`;
  }
  if (min !== undefined) {
    return `Enter ${min} or more.`;
  }
  if (max !== undefined) {
    return `Enter ${max} or less.`;
  }
  return 'Out of range.';
};

export class NumberInput extends Component<NumberInputSignature> {
  get boxelValue() {
    return this.args.value ?? null;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  get invalid() {
    return firstDefined(this.args.invalid, this.args.isInvalid) ?? false;
  }
  private notify(v: number | null) {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      v,
    );
  }
  get clamps() {
    return this.args.clamp ?? true;
  }
  /** A named tri-state, not a boolean: 'none' (nothing to say) is different
   * from 'valid' (checked and fine), and only 'invalid' dresses the field. */
  get rangeState(): 'valid' | 'invalid' | 'none' {
    let v = this.args.value;
    if (v === null || v === undefined || Number.isNaN(v)) return 'none';
    if (this.args.min === undefined && this.args.max === undefined) {
      return 'none';
    }
    let low = this.args.min !== undefined && v < this.args.min;
    let high = this.args.max !== undefined && v > this.args.max;
    return low || high ? 'invalid' : 'valid';
  }
  get state() {
    return this.invalid || this.rangeState === 'invalid' ? 'invalid' : 'none';
  }
  get errorMessage() {
    if (this.args.errorMessage) return this.args.errorMessage;
    if (this.rangeState !== 'invalid') return undefined;
    let format = this.args.rangeMessage ?? defaultRangeMessage;
    return format(this.args.min, this.args.max);
  }
  private roundOnly(v: number) {
    if (this.args.precision === undefined) return v;
    let m = Math.pow(10, this.args.precision);
    return Math.round(v * m) / m;
  }
  private clampRound(v: number) {
    if (this.args.min !== undefined) {
      v = Math.max(this.args.min, v);
    }
    if (this.args.max !== undefined) {
      v = Math.min(this.args.max, v);
    }
    if (this.args.precision !== undefined) {
      let m = Math.pow(10, this.args.precision);
      v = Math.round(v * m) / m;
    }
    return v;
  }
  handleInput = (val: string) => {
    let v = val === '' ? NaN : Number(val);
    this.notify(Number.isNaN(v) ? null : v);
  };
  handleChange = (ev: Event) => {
    let input = ev.target as HTMLInputElement;
    let v = input.value === '' ? NaN : Number(input.value);
    if (Number.isNaN(v)) {
      return; // empty stays empty; the browser blocks unparsable text
    }
    // Rounding still applies when clamping is off — precision is a display
    // contract, the bounds are a validity one.
    let next = this.clamps ? this.clampRound(v) : this.roundOnly(v);
    let display =
      this.args.precision !== undefined
        ? next.toFixed(this.args.precision)
        : String(next);
    if (input.value !== display) {
      input.value = display;
    }
    this.notify(next);
  };
  <template>
    <div
      class='pretui-boxelwrap'
      data-range-state={{this.rangeState}}
      data-test-pretui-number-input
      ...attributes
    >
      <BoxelInput
        @type='number'
        @value={{this.boxelValue}}
        @placeholder={{@placeholder}}
        @min={{@min}}
        @max={{@max}}
        @step={{@step}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        @state={{this.state}}
        @errorMessage={{this.errorMessage}}
        @onInput={{this.handleInput}}
        @onChange={{this.handleChange}}
        id={{@controlId}}
        style={{TYPED_FONT}}
      />
    </div>
    <style scoped>
      /* Same re-skin channel as EmailInput — see that component's note. */
      .pretui-boxelwrap {
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        font-variant-numeric: tabular-nums;
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --muted-foreground: var(--ink-3, var(--boxel-400));
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
    </style>
  </template>
}

// ── PasswordInput — WRAPS boxel-ui ───────────────────────────────────────
// BoxelInput @type='password' plus the reveal toggle boxel-ui doesn't
// ship: an overlay eye button flips the native type to text while pressed
// state holds (aria-pressed carries it). @autocomplete defaults to
// 'current-password'; pass 'new-password' for signup forms, 'off' to opt
// out. @revealable={{false}} removes the toggle.
//
// Strength estimation (added 2026-08-13) is OPT-IN via @strength={{true}} —
// Law 9, weight is opt-in at the package boundary. Without it this component
// is byte-for-byte what it was: the zxcvbn bundle (1.59 MiB / 839 KiB
// gzipped) is not on the static import graph at all, and even with
// @strength on it is fetched by the first estimate rather than by render, so
// the field types and submits from first paint. See password-strength.gts.
//
// @userInputs is the single highest-value knob: hand it the user's own name,
// email and handle and "chris1985" stops reading as strong, because zxcvbn
// scores against them as a dictionary. Pass it on every signup form.
//
// Estimation is ADVICE. Nothing here disables the field, reports invalid, or
// blocks submission on a score — current NIST 800-63B guidance is that
// composition rules are counterproductive and that length and
// not-being-breached are what matter. The password is never announced,
// logged, put in the DOM as text, or sent anywhere; zxcvbn runs entirely
// locally and there is no network call on this path.

const PASSWORD_METRICS = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: 18px; padding-block: 4px; padding-right: 30px;',
);

/** Idle time after the last keystroke before an estimate runs. Long enough
 * that a live region is not narrating mid-word, short enough to feel live. */
const STRENGTH_DELAY = 400;

export interface PasswordInputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    controlId?: string;
    /** autocomplete hint — 'current-password' by default */
    autocomplete?: string;
    /** show the reveal toggle — true by default */
    revealable?: boolean;
    onInput?: (value: string) => void;
    /** render the strength indicator (opt-in; loads the estimator lazily) */
    strength?: boolean;
    /** what you already know about the user — name, email, handle, company.
     * zxcvbn scores against these, so "chris1985" reads as weak instead of
     * strong. The single most valuable thing you can pass. */
    userInputs?: (string | number)[];
    /** idle ms before an estimate runs — 400 by default */
    strengthDelay?: number;
    /** replace the five strength labels (localisation, or a house voice) */
    strengthLabels?: readonly string[];
    /** show the meter row before anything has been typed — false by default,
     * so the field does not open with an empty accusation */
    strengthAlwaysVisible?: boolean;
    /** called with each settled estimate. Advice, not a gate — do not wire
     * this to a submit button's disabled state. */
    onStrength?: (reading: StrengthReading) => void;
  };
  Element: HTMLDivElement;
}

export class PasswordInput extends Component<PasswordInputSignature> {
  @tracked revealed = false;
  /** the value the estimator will see. Lives in memory only: it is never
   * written to an attribute, a title, a test hook, or the console. */
  @tracked pending = this.args.value ?? '';
  @tracked reading: StrengthReading | undefined = undefined;
  @tracked estimating = false;
  /** discards the result of a superseded in-flight estimate */
  private estimateRun = 0;

  get revealable() {
    return this.args.revealable ?? true;
  }
  get type() {
    return this.revealed && this.revealable ? 'text' : 'password';
  }
  get autocomplete() {
    return this.args.autocomplete ?? 'current-password';
  }
  get inputStyle() {
    return this.revealable ? PASSWORD_METRICS : TYPED_FONT;
  }
  get strength() {
    return this.args.strength ?? false;
  }
  get strengthDelay() {
    return this.args.strengthDelay ?? STRENGTH_DELAY;
  }
  get strengthAlwaysVisible() {
    return this.args.strengthAlwaysVisible ?? false;
  }
  get score() {
    return this.reading?.score;
  }
  get warning() {
    return this.reading?.warning;
  }
  get suggestions() {
    return this.reading?.suggestions;
  }
  get crackTime() {
    return this.reading?.crackTime;
  }
  get hideStrengthWhenEmpty() {
    return !this.strengthAlwaysVisible;
  }
  /** A by-VALUE key for @userInputs, so learning the user's email re-scores
   * the password — but an inline `{{array …}}` literal, which is a fresh
   * object every render, does not re-arm the debounce. */
  get userInputsKey() {
    return (this.args.userInputs ?? []).join(', ');
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  handleInput = (value: string) => {
    this.pending = value;
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
  };
  /** Fired by `estimateWhenIdle` once typing has settled. The estimator is
   * fetched here — the first time anyone asks, and never again. */
  runEstimate = (value: string) => {
    if (!this.strength) {
      return;
    }
    if (value === '') {
      this.reading = undefined;
      this.estimating = false;
      return;
    }
    let run = ++this.estimateRun;
    this.estimating = true;
    loadPasswordEstimator()
      .then((estimate) => {
        if (this.isDestroying || run !== this.estimateRun) {
          return;
        }
        let reading = estimate(value, this.args.userInputs ?? []);
        this.reading = reading;
        this.estimating = false;
        this.args.onStrength?.(reading);
      })
      .catch(() => {
        // A meter that fails to load is a missing meter, not a broken field.
        if (this.isDestroying || run !== this.estimateRun) {
          return;
        }
        this.reading = undefined;
        this.estimating = false;
      });
  };
  toggle = (_e: Event) => {
    this.revealed = !this.revealed;
  };
  <template>
    <div
      class='pretui-boxelwrap'
      data-revealed={{if this.revealed 'true'}}
      data-test-pretui-password-input
      ...attributes
    >
      <BoxelInput
        @type={{this.type}}
        @value={{@value}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        @autocomplete={{this.autocomplete}}
        @onInput={{this.handleInput}}
        id={{@controlId}}
        style={{this.inputStyle}}
      />
      {{#if this.revealable}}
        <button
          type='button'
          class='pretui-reveal'
          aria-label={{if this.revealed 'Hide password' 'Show password'}}
          aria-pressed={{if this.revealed 'true' 'false'}}
          disabled={{this.disabled}}
          {{on 'click' this.toggle}}
        >
          {{#if this.revealed}}
            <svg
              width='14'
              height='14'
              viewBox='0 0 16 16'
              aria-hidden='true'
            ><path
                d='M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linejoin='round'
              /><circle
                cx='8'
                cy='8'
                r='2'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
              /><path
                d='M2.5 13.5 13.5 2.5'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linecap='round'
              /></svg>
          {{else}}
            <svg
              width='14'
              height='14'
              viewBox='0 0 16 16'
              aria-hidden='true'
            ><path
                d='M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linejoin='round'
              /><circle
                cx='8'
                cy='8'
                r='2'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
              /></svg>
          {{/if}}
        </button>
      {{/if}}
      {{#if this.strength}}
        {{! The meter lives INSIDE the existing wrapper so the component keeps
            exactly one root element and `...attributes` lands where it always
            did. The modifier owns the debounce timer and cancels it in its
            destructor — it is one-shot and cannot re-arm itself. }}
        <div
          class='pretui-password-strength'
          {{estimateWhenIdle
            this.pending
            this.strengthDelay
            this.runEstimate
            this.userInputsKey
          }}
        >
          <PasswordStrength
            @score={{this.score}}
            @warning={{this.warning}}
            @suggestions={{this.suggestions}}
            @crackTime={{this.crackTime}}
            @labels={{@strengthLabels}}
            @busy={{this.estimating}}
            @hideWhenEmpty={{this.hideStrengthWhenEmpty}}
          />
        </div>
      {{/if}}
    </div>
    <style scoped>
      /* Same re-skin channel as EmailInput — see that component's note. */
      .pretui-boxelwrap {
        position: relative;
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --muted-foreground: var(--ink-3, var(--boxel-400));
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
      .pretui-reveal {
        position: absolute;
        top: calc((var(--control-h, 28px) - 20px) / 2);
        right: 5px;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: 0;
        padding: 0;
        border-radius: 6px;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-reveal:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-reveal:disabled {
        opacity: 0.45;
        cursor: default;
      }
      /* The meter sits under the control inside the same wrapper. It is the
         only thing that changes the wrapper's height, and only when
         @strength is on. */
      .pretui-password-strength {
        margin-block-start: var(--space-2, 6px);
      }
    </style>
  </template>
}

// ── SearchInput — WRAPS boxel-ui ─────────────────────────────────────────
// BoxelInput @type='search' — boxel's search dress (leading magnifier
// icon) re-pointed at the Pretui field tokens via its --boxel-input-
// search-* knobs — plus the clear button boxel-ui doesn't ship: an overlay
// ✕ appears once the field holds text and resets it through @onInput('').
// Wave-0 adaptation (documented): no debounce knob — realm code takes no
// timers; debounce belongs to the consumer's data layer.

const SEARCH_METRICS = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: 18px; padding-block: 4px; border-radius: var(--radius); padding-right: 28px;',
);

export interface SearchInputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    controlId?: string;
    /** show the clear button once the field holds text — true by default */
    clearable?: boolean;
    onInput?: (value: string) => void;
  };
  Element: HTMLDivElement;
}

export class SearchInput extends Component<SearchInputSignature> {
  @tracked internal = this.args.value ?? '';

  get current() {
    return this.args.value ?? this.internal;
  }
  get showClear() {
    return (
      (this.args.clearable ?? true) && this.current !== '' && !this.disabled
    );
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  private notify(value: string) {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
  }
  handleInput = (value: string) => {
    this.internal = value;
    this.notify(value);
  };
  clear = (_e: Event) => {
    this.internal = '';
    this.notify('');
  };
  <template>
    <div
      class='pretui-boxelwrap'
      data-filled={{if this.showClear 'true'}}
      data-test-pretui-search-input
      ...attributes
    >
      <BoxelInput
        @type='search'
        @value={{this.current}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @onInput={{this.handleInput}}
        id={{@controlId}}
        style={{SEARCH_METRICS}}
      />
      {{#if this.showClear}}
        <button
          type='button'
          class='pretui-searchclear'
          aria-label='Clear search'
          {{on 'click' this.clear}}
        >
          <svg width='12' height='12' viewBox='0 0 12 12' aria-hidden='true'><path
              d='M3 3l6 6M9 3l-6 6'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
              stroke-linecap='round'
            /></svg>
        </button>
      {{/if}}
    </div>
    <style scoped>
      /* EmailInput channel + boxel's search-specific knobs: the dark host
         pill re-dresses as the Pretui field face, magnifier in quiet ink. */
      .pretui-boxelwrap {
        position: relative;
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --muted-foreground: var(--ink-3, var(--boxel-400));
        --boxel-input-search-background-color: var(--field, var(--boxel-light));
        --boxel-input-search-color: var(--foreground);
        --boxel-input-search-icon-color: var(--ink-3, var(--boxel-400));
        --boxel-icon-sm: 14px;
        --boxel-sp-xxl: 30px;
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
      .pretui-searchclear {
        position: absolute;
        top: calc((var(--control-h, 28px) - 20px) / 2);
        right: 5px;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: 0;
        padding: 0;
        border-radius: 6px;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-searchclear:hover {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
    </style>
  </template>
}

// ── UrlInput — WRAPS boxel-ui ────────────────────────────────────────────
// boxel-ui has no URL validation engine (email/phone only), so this pairs
// BoxelInput @type='url' with an EmailInput-shaped validation surface:
// blur-gated first error (URL parse + http/https protocol check), live
// revalidation once touched so recovery is instant, valid checkmark on a
// good committed value. @onInput(value) + @onValidation(error | null),
// exactly the EmailInput split.

export interface UrlInputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    controlId?: string;
    onInput?: (value: string) => void;
    onValidation?: (error: string | null) => void;
  };
  Element: HTMLDivElement;
}

export class UrlInput extends Component<UrlInputSignature> {
  @tracked internal = this.args.value ?? '';
  @tracked touched = false;
  @tracked error: string | null = null;

  get current() {
    return this.args.value ?? this.internal;
  }
  get state() {
    if (!this.touched) {
      return 'initial';
    }
    if (this.error) {
      return 'invalid';
    }
    return this.current ? 'valid' : 'initial';
  }
  get errorMessage() {
    return this.error ?? undefined;
  }
  private validate(v: string): string | null {
    if (!v) {
      return this.required ? 'URL is required.' : null;
    }
    let parsed;
    try {
      parsed = new URL(v);
    } catch {
      return 'Not a valid URL — include the protocol (https://…).';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'URL must use http:// or https://.';
    }
    return null;
  }
  private report(error: string | null) {
    this.error = error;
    this.args.onValidation?.(error);
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  handleInput = (value: string) => {
    this.internal = value;
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
    if (this.touched) {
      this.report(this.validate(value));
    }
  };
  handleBlur = (_ev: Event) => {
    this.touched = true;
    this.report(this.validate(this.current));
  };
  <template>
    <div
      class='pretui-boxelwrap'
      data-state={{this.state}}
      data-test-pretui-url-input
      ...attributes
    >
      <BoxelInput
        @type='url'
        @value={{this.current}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        @state={{this.state}}
        @errorMessage={{this.errorMessage}}
        @onInput={{this.handleInput}}
        @onBlur={{this.handleBlur}}
        id={{@controlId}}
        style={{TYPED_FONT}}
      />
    </div>
    <style scoped>
      /* Same re-skin channel as EmailInput — see that component's note. */
      .pretui-boxelwrap {
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --muted-foreground: var(--ink-3, var(--boxel-400));
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-font-size-sm: var(--text-ui-sm, 11.5px);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
    </style>
  </template>
}
