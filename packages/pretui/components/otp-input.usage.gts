// Pretui — OtpInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { OtpInput } from './otp-input';

const OTP_TYPES = ['numeric', 'alpha', 'alphanumeric'];

// ── OtpInput ← wa-otp-input ──────────────────────────────────────────────
// Dropped knobs: @format (literal-separator groups), @case (transform),
// @withMask (hint glyphs), @appearance (segments wear the one Pretui Input
// dress), @size (fixed control-h square), @autosubmit/@required/@readonly
// (no form association in wave-0), @autofocus. The wa-complete event
// collapses into @onValueChange — compare value.length to @length.
class OtpInputUsage extends Component {
  typeOptions = OTP_TYPES;
  @tracked value = '';
  @tracked length = 6;
  @tracked type = 'numeric';
  @tracked masked = false;
  @tracked disabled = false;
  @tracked labelText = 'One-time code';
  setValue = (v: string) => (this.value = v);
  setLength = (v: number | null) => (this.length = v ?? 6);
  setType = (v: string) => (this.type = v);
  setMasked = (v: boolean) => (this.masked = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  setLabel = (v: string) => (this.labelText = v);
  get typeVal() {
    return this.type as 'numeric' | 'alpha' | 'alphanumeric';
  }
  get isComplete() {
    return this.value.length === this.length;
  }
  get usage() {
    let bits: string[] = [];
    if (this.length !== 6) bits.push(`@length={{${this.length}}}`);
    if (this.type !== 'numeric') bits.push(`@type='${this.type}'`);
    if (this.masked) bits.push('@masked={{true}}');
    bits.push(`@value='${this.value}'`, '@onValueChange={{this.setValue}}');
    return `<OtpInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='OtpInput'
      @description='Fixed-length code entry, one character per segment — SMS verification, two-factor codes, PINs, invite codes. Typing auto-advances, Backspace splices and steps back, and a paste distributes across the segments. Transcribed from wa-otp-input, re-based on real single-char inputs in the Pretui Input dress.'
      @source={{this.usage}}
    >
      <:example>
        <OtpInput
          @value={{this.value}}
          @length={{this.length}}
          @type={{this.typeVal}}
          @masked={{this.masked}}
          @disabled={{this.disabled}}
          @label={{this.labelText}}
          @onValueChange={{this.setValue}}
        />
        <p class='pretui-demo-readout' data-test-otp-readout>
          value = “{{this.value}}”
          {{#if this.isComplete}}· complete{{/if}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='length'
          @defaultValue={{6}}
          @value={{this.length}}
          @min={{2}}
          @max={{10}}
          @description='Number of character segments.'
          @onInput={{this.setLength}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @description='Controlled value — the segments joined into one dense string. Omit and seed @defaultValue for uncontrolled use (kit contract: args.value ?? internal).'
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='type'
          @defaultValue='numeric'
          @value={{this.type}}
          @options={{this.typeOptions}}
          @description="Allowed character class — WA's filter semantic; rejected characters never land."
          @onInput={{this.setType}}
        />
        <Args.Bool
          @name='masked'
          @defaultValue={{false}}
          @value={{this.masked}}
          @description='Render entered characters as password dots — for codes that deserve shoulder-surfing cover.'
          @onInput={{this.setMasked}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='label'
          @defaultValue='One-time code'
          @value={{this.labelText}}
          @description="Group label announced by assistive tech; every segment also carries its own 'Digit N of L' label (Spectrum's segmented-input a11y notes)."
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='defaultValue'
          @description='Uncontrolled seed for the internal value.'
        />
        <Args.Action
          @name='onValueChange'
          @description="Receives the joined string on every edit. Completion is value.length === @length — WA's wa-complete event, collapsed."
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

export const DEMOS_OTP_INPUT: Record<string, unknown> = {
  OtpInput: OtpInputUsage,
};
