// Pretui — demo-controls-extras: freestyle usage pages for the extras wave
// of the controls territory (Label, CopyButton, Stepper, InputGroup,
// EmailInput, PhoneInput) plus the typed-input split (NumberInput,
// PasswordInput, SearchInput, UrlInput), rendered with the ported
// ember-freestyle machinery. Knob sets ported from the corresponding
// boxel-ui usage.gts files (copy-button, input-group, email-input,
// phone-input; label has no usage page upstream — knobs derived from its
// signature); Stepper and the typed inputs carry type-specific knob sets
// of their own (min/max/step/precision, revealable/autocomplete,
// clearable, required-URL validation).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from '../freestyle';
import {
  CopyButton,
  EmailInput,
  InputGroup,
  Label,
  NumberInput,
  PasswordInput,
  PhoneInput,
  SearchInput,
  Stepper,
  UrlInput,
} from './extras';

// ── Shared option data ───────────────────────────────────────────────────
const LABEL_TAGS = ['label', 'span', 'legend'];
const COPY_VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'];
const INPUT_GROUP_TYPES = ['text', 'email', 'password', 'number', 'search', 'url'];

// ── Label ← label/index.gts (no upstream usage page) ─────────────────────
// Dropped knobs: @size ('small' | 'default' — the Pretui Label is a
// single-size mono eyebrow; sizing rides the token sheet), @ellipsize (no
// truncation variant in wave-0), free @tag (keyof HTMLElementTagNameMap —
// narrowed to the three tags a field label actually takes).
class LabelDemo extends Component {
  tagOptions = LABEL_TAGS;
  @tracked tag = 'label';
  @tracked text = 'Card number';
  setTag = (v: string) => (this.tag = v);
  setText = (v: string) => (this.text = v);
  get tagVal() {
    return this.tag as 'label' | 'span' | 'legend';
  }
  get usage() {
    let tagBit = this.tag === 'label' ? '' : ` @tag='${this.tag}'`;
    return `<Label${tagBit}>${this.text}</Label>`;
  }
  <template>
    <FreestyleUsage
      @name='Label'
      @description='Small-caps mono field label — the eyebrow voice shared by property rows and table headers. Renders as label, span, or legend.'
      @source={{this.usage}}
    >
      <:example>
        <Label @tag={{this.tagVal}}>{{this.text}}</Label>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='tag'
          @defaultValue='label'
          @value={{this.tag}}
          @options={{this.tagOptions}}
          @description="Element to render — boxel-ui's free keyof HTMLElementTagNameMap, narrowed to label / span / legend."
          @onInput={{this.setTag}}
        />
        <Args.String
          @name='for'
          @description='id of the control this label points at (label tag only).'
        />
        <Args.String
          @name='text'
          @value={{this.text}}
          @description='Demo knob for the default block content.'
          @onInput={{this.setText}}
        />
        <Args.Yield @description='Label content as the default block.' />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── CopyButton ← copy-button/usage.gts ───────────────────────────────────
// Dropped knobs: @tooltipText / @placement / @offset (boxel-ui wraps the
// button in an ember-velcro Tooltip — wart list forbids; the confirmation
// is the glyph swap itself), @size / @width / @height (fixed 28px
// IconButton square), @ariaLabel (renamed @label). Adaptation on record:
// the copied state resets on pointerleave/blur, not a 2s setTimeout —
// realm code takes no timers.
class CopyButtonDemo extends Component {
  variantOptions = COPY_VARIANTS;
  @tracked textToCopy = 'Text to copy';
  @tracked labelText = 'Copy to clipboard';
  @tracked variant = 'secondary';
  setText = (v: string) => (this.textToCopy = v);
  setLabel = (v: string) => (this.labelText = v);
  setVariant = (v: string) => (this.variant = v);
  get variantVal() {
    return this.variant as 'primary' | 'secondary' | 'ghost' | 'destructive';
  }
  get usage() {
    let bits = [`@text='${this.textToCopy}'`];
    if (this.variant !== 'secondary') bits.push(`@variant='${this.variant}'`);
    return `<CopyButton ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='CopyButton'
      @description='Button that copies a string to the clipboard on click and surfaces a brief confirmation — common in code blocks, share-link rows, and developer tools. The glyph swaps to a success check until the pointer leaves.'
      @source={{this.usage}}
    >
      <:example>
        <CopyButton
          @text={{this.textToCopy}}
          @label={{this.labelText}}
          @variant={{this.variantVal}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @required={{true}}
          @value={{this.textToCopy}}
          @description="The string written to navigator.clipboard — boxel-ui's @textToCopy."
          @onInput={{this.setText}}
        />
        <Args.String
          @name='label'
          @defaultValue='Copy to clipboard'
          @value={{this.labelText}}
          @description="Accessible name while idle — boxel-ui's @ariaLabel; swaps to 'Copied' while the confirmation holds."
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='variant'
          @defaultValue='secondary'
          @value={{this.variant}}
          @options={{this.variantOptions}}
          @description='IconButton variant sugar over the tone + appearance axes.'
          @onInput={{this.setVariant}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── Stepper — fresh (no boxel-ui counterpart) ────────────────────────────
// The property-panel number control: −/+ buttons flanking a centered
// number field on one hairline. Buttons disable at the bounds; typed
// values clamp on commit (change event — blur / Enter / native spinners).
class StepperDemo extends Component {
  @tracked value = 3;
  @tracked min = 0;
  @tracked max = 10;
  @tracked step = 1;
  @tracked disabled = false;
  setValue = (v: number) => (this.value = v);
  setMin = (v: number | null) => (this.min = v ?? 0);
  setMax = (v: number | null) => (this.max = v ?? 10);
  setStep = (v: number | null) => (this.step = v ?? 1);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = [
      `@value={{${this.value}}}`,
      `@min={{${this.min}}}`,
      `@max={{${this.max}}}`,
    ];
    if (this.step !== 1) bits.push(`@step={{${this.step}}}`);
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onValueChange={{this.setValue}}');
    return `<Stepper ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='Stepper'
      @description='Number input flanked by decrement/increment buttons — the property-panel number control. Values clamp at the bounds and the flanking buttons disable when the value sits on them.'
      @source={{this.usage}}
    >
      <:example>
        <Stepper
          @value={{this.value}}
          @min={{this.min}}
          @max={{this.max}}
          @step={{this.step}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValue}}
        />
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @value={{this.value}}
          @min={{this.min}}
          @max={{this.max}}
          @step={{this.step}}
          @description='Controlled value — omit and seed @defaultValue for uncontrolled use (kit contract: args.value ?? internal).'
          @onInput={{this.setValue}}
        />
        <Args.Number
          @name='min'
          @value={{this.min}}
          @description='Lower bound — the − button disables here.'
          @onInput={{this.setMin}}
        />
        <Args.Number
          @name='max'
          @value={{this.max}}
          @description='Upper bound — the + button disables here.'
          @onInput={{this.setMax}}
        />
        <Args.Number
          @name='step'
          @defaultValue={{1}}
          @value={{this.step}}
          @description='Increment applied by the flanking buttons and native spinners.'
          @onInput={{this.setStep}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Number
          @name='defaultValue'
          @description='Uncontrolled seed for the internal value.'
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the clamped value as a number.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── InputGroup ← input-group/usage.gts ───────────────────────────────────
// Rebuilt as a wrap of boxel-ui's InputGroup — the full contextual surface
// is now live: <:before>/<:after> yield boxel's Accessories (Button /
// IconButton / Select / Text), <:default> yields Controls (Input /
// Textarea) for multi-control groups, and validation graduates to the
// @state enum + @errorMessage/@helperText rows. The plain <:start>/<:end>
// blocks are preserved (auto-wrapped in Accessories.Text). Knobs ported
// from boxel-ui's usage page: state, errorMessage, helperText, placeholder,
// disabled, value. Dropped upstream knobs: @validIcon/@invalidIcon (kit
// keeps the default state icons), @inputmode/@name (splat native attrs),
// boxel-input-group-* css vars (theme tokens own the dress).
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const IG_STATES = ['none', 'initial', 'valid', 'invalid', 'loading'];

function labelOf(item: unknown): string {
  return String(item);
}

class InputGroupDemo extends Component {
  typeOptions = INPUT_GROUP_TYPES;
  stateOptions = IG_STATES;
  currencies = CURRENCIES;
  @tracked value = '';
  @tracked placeholder = 'Amount';
  @tracked type = 'text';
  @tracked state = 'none';
  @tracked errorMessage = 'This amount is invalid.';
  @tracked helperText = 'Please enter an amount';
  @tracked disabled = false;
  @tracked shareUrl = 'https://stack.cards/ctse/pretui';
  @tracked username = '';
  @tracked server = '';
  @tracked currency: string | null = 'USD';
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setType = (v: string) => (this.type = v);
  setState = (v: string) => (this.state = v);
  setErrorMessage = (v: string) => (this.errorMessage = v);
  setHelperText = (v: string) => (this.helperText = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setShareUrl = (v: string) => (this.shareUrl = v);
  setUsername = (v: string) => (this.username = v);
  setServer = (v: string) => (this.server = v);
  setCurrency = (item: unknown) => (this.currency = item as string);
  copyShareUrl = () => {
    navigator.clipboard.writeText(this.shareUrl).catch(() => {});
  };
  get stateVal() {
    return this.state as
      | 'none'
      | 'initial'
      | 'valid'
      | 'invalid'
      | 'loading';
  }
  // Live per-type validation so the type knob visibly bites: with the state
  // knob on 'none', a value that mismatches the chosen type paints the
  // invalid ring immediately (email against digits, url without http, …).
  get typeMismatch(): string | null {
    if (!this.value) return null;
    switch (this.type) {
      case 'email':
        return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.value)
          ? null
          : 'That doesn’t look like an email address.';
      case 'url':
        return /^https?:\/\/\S+\.\S+/.test(this.value)
          ? null
          : 'A URL here needs to start with http(s)://';
      case 'number':
        return Number.isNaN(Number(this.value))
          ? 'Only digits make sense here.'
          : null;
      default:
        return null;
    }
  }
  get liveState() {
    if (this.state !== 'none') return this.stateVal;
    return this.typeMismatch ? ('invalid' as const) : this.stateVal;
  }
  get liveErrorMessage() {
    if (this.state !== 'none') return this.errorMessage;
    return this.typeMismatch ?? this.errorMessage;
  }
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (this.type !== 'text') bits.push(`@type='${this.type}'`);
    if (this.state !== 'none') bits.push(`@state='${this.state}'`);
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onInput={{this.setValue}}');
    return `<InputGroup ${bits.join(' ')}>\n  <:start>$</:start>\n  <:end>.00</:end>\n</InputGroup>`;
  }
  <template>
    <FreestyleUsage
      @name='InputGroup'
      @description="Extend inputs by adding text, buttons, and selects on either side of textual inputs — a wrap of boxel-ui's InputGroup, so accessories share one hairline and one focus ring with the control. Type here and watch the readout track state."
      @source={{this.usage}}
    >
      <:example>
        <InputGroup
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @type={{this.type}}
          @state={{this.liveState}}
          @errorMessage={{this.liveErrorMessage}}
          @helperText={{this.helperText}}
          @disabled={{this.disabled}}
          @onInput={{this.setValue}}
        >
          <:start>$</:start>
          <:end>.00</:end>
        </InputGroup>
        <p class='pretui-demo-readout' data-test-input-group-readout>
          type = {{this.type}} · value = “{{this.value}}”
          {{#if this.typeMismatch}}· mismatch{{/if}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @value={{this.value}}
          @description='The value of the input'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @description='The placeholder text for the input'
          @onInput={{this.setPlaceholder}}
        />
        <Args.String
          @name='type'
          @defaultValue='text'
          @value={{this.type}}
          @options={{this.typeOptions}}
          @description='Native input type — pick number or password to see the control change shape; the readout under the example tracks it.'
          @onInput={{this.setType}}
        />
        <Args.String
          @name='state'
          @defaultValue='none'
          @value={{this.state}}
          @options={{this.stateOptions}}
          @description="boxel-ui's validation-state enum — valid/invalid render state icons, invalid enables the errorMessage row, loading disables the group."
          @onInput={{this.setState}}
        />
        <Args.String
          @name='errorMessage'
          @value={{this.errorMessage}}
          @description="Error row under the group; renders while @state='invalid'."
          @onInput={{this.setErrorMessage}}
        />
        <Args.String
          @name='helperText'
          @value={{this.helperText}}
          @description='Helper row under the group.'
          @onInput={{this.setHelperText}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @description='Whether the input is disabled'
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='invalid'
          @description="Kept as sugar for @state='invalid'; @state wins when both are set."
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId; replaces boxel-ui's @id."
        />
        <Args.Action
          @name='onInput'
          @description='Receives the changed value as a string.'
        />
        <Args.Yield
          @name='start'
          @description="Leading plain-content accessory — auto-wrapped in boxel's Text accessory."
        />
        <Args.Yield
          @name='end'
          @description='Trailing plain-content accessory — auto-wrapped.'
        />
        <Args.Yield
          @name='before'
          @description="Yields boxel's Accessories (Button / IconButton / Select / Text) and {elementId} ahead of the control."
        />
        <Args.Yield
          @name='after'
          @description='Same contextual Accessories, after the control.'
        />
        <Args.Yield
          @name='default'
          @description="Yields Controls (Input / Textarea), Accessories, and {elementId} — supply your own control row; @value/@placeholder/@type are ignored when present."
        />
      </:api>
    </FreestyleUsage>
    <FreestyleUsage
      @name='InputGroup compositions'
      @description="Composite groups through the contextual blocks — a button accessory wired to an action, a select accessory, and a multi-control default block. The select accessory's dropdown portals to boxel's wormhole, so it wears boxel default colors (accepted wart — no @renderInPlace passthrough)."
    >
      <:example>
        <div class='pretui-ig-stack'>
          <InputGroup
            @value={{this.shareUrl}}
            @placeholder='Share link'
            @onInput={{this.setShareUrl}}
          >
            <:after as |Accessories|>
              <Accessories.Button
                {{on 'click' this.copyShareUrl}}
              >Copy</Accessories.Button>
            </:after>
          </InputGroup>
          <InputGroup @placeholder='Amount' @onInput={{this.setValue}}>
            <:before as |Accessories|>
              <Accessories.Text>$</Accessories.Text>
            </:before>
            <:after as |Accessories|>
              <Accessories.Select
                @placeholder='Currency'
                @options={{this.currencies}}
                @selected={{this.currency}}
                @onChange={{this.setCurrency}}
                aria-label='Currency'
                as |item|
              >
                <div>{{labelOf item}}</div>
              </Accessories.Select>
            </:after>
          </InputGroup>
          <InputGroup>
            <:default as |Controls Accessories group|>
              <Controls.Input
                id={{group.elementId}}
                @placeholder='Username'
                @onInput={{this.setUsername}}
              />
              <Accessories.Text>@</Accessories.Text>
              <Controls.Input
                @placeholder='Server'
                @onInput={{this.setServer}}
              />
            </:default>
          </InputGroup>
          <p class='pretui-demo-readout'>
            currency = {{this.currency}} · handle = “{{this.username}}@{{this.server}}”
          </p>
        </div>
      </:example>
    </FreestyleUsage>
    <style scoped>
      .pretui-ig-stack {
        display: grid;
        gap: 12px;
      }
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

// ── EmailInput ← email-input/usage.gts ───────────────────────────────────
// Dropped knobs: none upstream — the full set carries over. Surface
// adaptation on record: boxel-ui's 3-arg @onChange(value, validationError,
// ev) splits into @onInput(value) + @onValidation(errorMessage | null);
// the doc rows below describe the Pretui halves.
class EmailInputDemo extends Component {
  @tracked value = '';
  @tracked lastError: string | null = null;
  @tracked placeholder = '';
  @tracked disabled = false;
  @tracked required = false;
  setValue = (v: string) => (this.value = v);
  setError = (e: string | null) => (this.lastError = e);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.required) bits.push('@required={{true}}');
    bits.push('@onInput={{this.setValue}}', '@onValidation={{this.setError}}');
    return `<EmailInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='EmailInput'
      @description="Wraps boxel-ui's EmailInput — client-side email validation with debounced feedback and blur-gated error surfacing — re-dressed through the Pretui token channel. Committed values arrive via @onInput; the current validation error message (or null) via @onValidation."
      @source={{this.usage}}
    >
      <:example>
        <EmailInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @onInput={{this.setValue}}
          @onValidation={{this.setError}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @optional={{true}}
          @value={{this.value}}
          @description='The current value passed to the input'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @defaultValue='Enter email'
          @value={{this.placeholder}}
          @description='Empty input placeholder'
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @description='Empty input counts as invalid once required.'
          @onInput={{this.setRequired}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description="Receives the committed value as a string — the first arg of boxel-ui's @onChange."
        />
        <Args.Action
          @name='onValidation'
          @description="Receives the current validation error message, or null when valid/empty — boxel-ui's @onChange validation object, collapsed to its message."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── PhoneInput ← phone-input/usage.gts ───────────────────────────────────
// Dropped knobs: none upstream — the full set carries over. Same surface
// adaptation as EmailInput: @onChange(value, NormalizePhoneFormatResult,
// ev) splits into @onInput(value) + @onValidation(errorMessage | null).
// @onInput receives boxel's sanitized value: E.164 when valid, trimmed
// digits otherwise.
class PhoneInputDemo extends Component {
  @tracked value = '';
  @tracked lastError: string | null = null;
  @tracked placeholder = '';
  @tracked disabled = false;
  @tracked required = false;
  setValue = (v: string) => (this.value = v);
  setError = (e: string | null) => (this.lastError = e);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.required) bits.push('@required={{true}}');
    bits.push('@onInput={{this.setValue}}', '@onValidation={{this.setError}}');
    return `<PhoneInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='PhoneInput'
      @description="Wraps boxel-ui's PhoneInput — as-you-type formatting, E.164 normalization, and region validation via awesome-phonenumber — re-dressed through the Pretui token channel. Sanitized values arrive via @onInput; the current validation error message (or null) via @onValidation."
      @source={{this.usage}}
    >
      <:example>
        <PhoneInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @onInput={{this.setValue}}
          @onValidation={{this.setError}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @optional={{true}}
          @value={{this.value}}
          @description='The current value passed to the input'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @defaultValue='Enter phone'
          @value={{this.placeholder}}
          @description='Empty input placeholder'
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @description='Empty input counts as invalid once required.'
          @onInput={{this.setRequired}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description='Receives the sanitized value as a string: E.164 when valid, trimmed digits otherwise.'
        />
        <Args.Action
          @name='onValidation'
          @description="Receives the current validation error message, or null when valid/empty — boxel-ui's NormalizePhoneFormatResult, collapsed to its error message."
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// ── NumberInput — typed-input split, fresh page ──────────────────────────
// Type-specific knobs: min / max / step / precision. Values clamp + round
// on commit (blur / Enter / spinners); the readout shows what @onInput
// received (number | null).
class NumberInputDemo extends Component {
  @tracked emitted: number | null = null;
  @tracked min = 0;
  @tracked max = 100;
  @tracked step = 1;
  @tracked precision = 0;
  @tracked placeholder = '0';
  @tracked disabled = false;
  @tracked required = false;
  setEmitted = (v: number | null) => (this.emitted = v);
  setMin = (v: number | null) => (this.min = v ?? 0);
  setMax = (v: number | null) => (this.max = v ?? 100);
  setStep = (v: number | null) => (this.step = v ?? 1);
  setPrecision = (v: number | null) => (this.precision = v ?? 0);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  get usage() {
    let bits = [
      `@min={{${this.min}}}`,
      `@max={{${this.max}}}`,
      `@step={{${this.step}}}`,
    ];
    if (this.precision) bits.push(`@precision={{${this.precision}}}`);
    bits.push('@onInput={{this.setValue}}');
    return `<NumberInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='NumberInput'
      @description='Numeric entry riding boxel-ui BoxelInput (@type=number): native spinners and keyboard steps via @min/@max/@step, plus clamp-and-round to @precision decimals on commit — clamping never fights mid-keystroke.'
      @source={{this.usage}}
    >
      <:example>
        {{! uncontrolled on purpose: feeding every parsed keystroke back
            into a controlled number @value would fight partial entries
            like '3.' — the readout below proves the @onInput loop instead }}
        <NumberInput
          @min={{this.min}}
          @max={{this.max}}
          @step={{this.step}}
          @precision={{this.precision}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @onInput={{this.setEmitted}}
        />
        <p class='pretui-demo-readout' data-test-number-readout>
          onInput received:
          {{if (isNullVal this.emitted) 'null' this.emitted}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='min'
          @value={{this.min}}
          @description='Lower bound — commits clamp here; native spinners stop here.'
          @onInput={{this.setMin}}
        />
        <Args.Number
          @name='max'
          @value={{this.max}}
          @description='Upper bound.'
          @onInput={{this.setMax}}
        />
        <Args.Number
          @name='step'
          @defaultValue={{1}}
          @value={{this.step}}
          @description='Spinner / arrow-key increment.'
          @onInput={{this.setStep}}
        />
        <Args.Number
          @name='precision'
          @defaultValue={{0}}
          @value={{this.precision}}
          @description='Decimal places applied on commit (0 = integers). Try 2 and type 3.14159.'
          @onInput={{this.setPrecision}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @onInput={{this.setRequired}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description='Receives number | null — null while the field is empty.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

// ── PasswordInput — typed-input split, fresh page ────────────────────────
// Type-specific knobs: revealable (the eye toggle on/off), autocomplete
// (current-password / new-password / off / one-time-code), and strength
// (the opt-in zxcvbn meter — off by default, and the 839 KB estimator is
// not fetched until it is switched on and something is typed).
const AUTOCOMPLETE_OPTIONS = [
  'current-password',
  'new-password',
  'off',
  'one-time-code',
];

// What a signup form would already know about the user. zxcvbn scores
// against these, which is why 'chris1985' reads as weak here.
const DEMO_USER_INPUTS = ['Chris', 'Tse', 'chris@example.com', 'Cardstack'];

class PasswordInputDemo extends Component {
  autocompleteOptions = AUTOCOMPLETE_OPTIONS;
  @tracked value = 'hunter2';
  @tracked placeholder = 'Password';
  @tracked autocomplete = 'current-password';
  @tracked revealable = true;
  @tracked disabled = false;
  @tracked required = false;
  @tracked strength = true;
  @tracked userInputs: string[] = DEMO_USER_INPUTS;
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setAutocomplete = (v: string) => (this.autocomplete = v);
  setRevealable = (v: boolean) => (this.revealable = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  setStrength = (v: boolean) => (this.strength = v);
  setUserInputs = (v: string[]) => (this.userInputs = v);
  /** The demo never echoes the value — a password readout is a password in
   * the DOM as text, which is exactly what the component is careful not to
   * do. Length is enough to show that @onInput fired. */
  get readout() {
    return this.value.length;
  }
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.autocomplete !== 'current-password')
      bits.push(`@autocomplete='${this.autocomplete}'`);
    if (!this.revealable) bits.push('@revealable={{false}}');
    if (this.strength) bits.push('@strength={{true}}');
    if (this.strength && this.userInputs.length)
      bits.push('@userInputs={{this.userInputs}}');
    bits.push('@onInput={{this.setValue}}');
    return `<PasswordInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='PasswordInput'
      @description="Password entry riding boxel-ui BoxelInput (@type=password) plus the reveal toggle boxel-ui doesn't ship — the eye button flips the native type to text while pressed state holds (aria-pressed carries it for assistive tech). Strength estimation is opt-in: switch it on and the zxcvbn estimator is fetched on the first settled keystroke, never before. It is advice — nothing here gates submission, and per NIST 800-63B a long passphrase with no symbols beats a short one that has them. Try 'chris1985' with and without userInputs."
      @source={{this.usage}}
    >
      <:example>
        <PasswordInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @autocomplete={{this.autocomplete}}
          @revealable={{this.revealable}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @strength={{this.strength}}
          @userInputs={{this.userInputs}}
          @onInput={{this.setValue}}
        />
        <p class='pretui-demo-readout' data-test-password-readout>
          onInput fired — {{this.readout}} characters (never echoed)
        </p>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='revealable'
          @defaultValue={{true}}
          @value={{this.revealable}}
          @description='Show the reveal (eye) toggle. Off for high-security contexts.'
          @onInput={{this.setRevealable}}
        />
        <Args.String
          @name='autocomplete'
          @defaultValue='current-password'
          @value={{this.autocomplete}}
          @options={{this.autocompleteOptions}}
          @description='Autocomplete hint — new-password asks the browser to suggest one; off opts out.'
          @onInput={{this.setAutocomplete}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @onInput={{this.setRequired}}
        />
        <Args.Bool
          @name='strength'
          @defaultValue={{false}}
          @value={{this.strength}}
          @description='Render the strength meter. Opt-in (Law 9) — with it off the zxcvbn estimator is not on the import graph at all, and with it on the bundle is fetched by the first estimate rather than by render.'
          @onInput={{this.setStrength}}
        />
        <Args.Array
          @name='userInputs'
          @value={{this.userInputs}}
          @description="What you already know about the user — name, email, handle, company. zxcvbn scores against them, so 'chris1985' stops reading as strong. The single highest-value arg: clear this field and watch the same password score higher."
          @onInput={{this.setUserInputs}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description='Receives the changed value as a string.'
        />
        <Args.Action
          @name='onStrength'
          @description='Receives each settled estimate. Advice, not a gate — do not wire it to a submit button.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

// ── SearchInput — typed-input split, fresh page ──────────────────────────
// Type-specific knob: clearable (the ✕ button). Wave-0 adaptation on
// record: no debounce knob — realm code takes no timers; debounce belongs
// to the consumer's data layer.
class SearchInputDemo extends Component {
  @tracked value = '';
  @tracked placeholder = 'Search components…';
  @tracked clearable = true;
  @tracked disabled = false;
  setValue = (v: string) => (this.value = v);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setClearable = (v: boolean) => (this.clearable = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.placeholder) bits.push(`@placeholder='${this.placeholder}'`);
    if (!this.clearable) bits.push('@clearable={{false}}');
    bits.push('@onInput={{this.setValue}}');
    return `<SearchInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='SearchInput'
      @description="Search field riding boxel-ui BoxelInput (@type=search) — the leading magnifier re-dressed in Pretui field tokens — plus the clear button boxel-ui doesn't ship: a ✕ appears once the field holds text and resets it through @onInput('')."
      @source={{this.usage}}
    >
      <:example>
        <SearchInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @clearable={{this.clearable}}
          @disabled={{this.disabled}}
          @onInput={{this.setValue}}
        />
        <p class='pretui-demo-readout' data-test-search-readout>
          value = “{{this.value}}”
        </p>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='clearable'
          @defaultValue={{true}}
          @value={{this.clearable}}
          @description='Show the ✕ clear button while the field holds text.'
          @onInput={{this.setClearable}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description="Receives the changed value as a string; the clear button sends ''."
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

// ── UrlInput — typed-input split, fresh page ─────────────────────────────
// Type-specific behavior: EmailInput-shaped validation (boxel-ui has no
// URL engine, so the checks are Pretui's own — URL parse + http/https
// protocol, blur-gated, live revalidation once touched).
class UrlInputDemo extends Component {
  @tracked value = '';
  @tracked lastError: string | null = null;
  @tracked placeholder = 'https://example.com';
  @tracked disabled = false;
  @tracked required = false;
  setValue = (v: string) => (this.value = v);
  setError = (e: string | null) => (this.lastError = e);
  setPlaceholder = (v: string) => (this.placeholder = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setRequired = (v: boolean) => (this.required = v);
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.required) bits.push('@required={{true}}');
    bits.push('@onInput={{this.setValue}}', '@onValidation={{this.setError}}');
    return `<UrlInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='UrlInput'
      @description='URL entry riding boxel-ui BoxelInput (@type=url) with an EmailInput-shaped validation surface: blur-gated first error, live revalidation once touched, valid checkmark on a good committed value. Requires an http:// or https:// URL.'
      @source={{this.usage}}
    >
      <:example>
        <UrlInput
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @onInput={{this.setValue}}
          @onValidation={{this.setError}}
        />
        <p class='pretui-demo-readout' data-test-url-readout>
          value = “{{this.value}}” · error =
          {{if this.lastError this.lastError 'null'}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @description='An empty field counts as invalid on blur once required.'
          @onInput={{this.setRequired}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='placeholder'
          @value={{this.placeholder}}
          @onInput={{this.setPlaceholder}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='controlId'
          @description="The input's id for label wiring — supplied by a wrapping Field's yielded controlId."
        />
        <Args.Action
          @name='onInput'
          @description='Receives the changed value as a string.'
        />
        <Args.Action
          @name='onValidation'
          @description='Receives the current validation error message, or null when valid/empty — the EmailInput split.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

function isNullVal(v: number | null): boolean {
  return v === null;
}

export const DEMOS_CONTROLS_EXTRAS: Record<string, unknown> = {
  Label: LabelDemo,
  CopyButton: CopyButtonDemo,
  Stepper: StepperDemo,
  InputGroup: InputGroupDemo,
  EmailInput: EmailInputDemo,
  PhoneInput: PhoneInputDemo,
  NumberInput: NumberInputDemo,
  PasswordInput: PasswordInputDemo,
  SearchInput: SearchInputDemo,
  UrlInput: UrlInputDemo,
};
