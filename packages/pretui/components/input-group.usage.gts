// Pretui — InputGroup usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from '../freestyle';
import { InputGroup } from './input-group';

const INPUT_GROUP_TYPES = ['text', 'email', 'password', 'number', 'search', 'url'];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];

const IG_STATES = ['none', 'initial', 'valid', 'invalid', 'loading'];

function labelOf(item: unknown): string {
  return String(item);
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
class InputGroupUsage extends Component {
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

export const DEMOS_INPUT_GROUP: Record<string, unknown> = {
  InputGroup: InputGroupUsage,
};
