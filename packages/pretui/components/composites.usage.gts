// Pretui — demo-controls-composites: freestyle usage pages for the
// form-composites wave (OtpInput, TimeInput, StepList, ButtonGroup,
// Divider), rendered with the ported ember-freestyle machinery. Knob sets
// derived from the transcribed sources: wa-otp-input / wa-time-input /
// wa-button-group / wa-divider (Web Awesome) and React Spectrum's StepList
// — dropped upstream knobs are documented per component.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import {
  OtpInput,
  TimeInput,
  type StepItem,
} from './composites';

// ── Shared option data ───────────────────────────────────────────────────
const OTP_TYPES = ['numeric', 'alpha', 'alphanumeric'];
const HOUR_CYCLES = ['24', '12'];
export const ORIENTATIONS = ['horizontal', 'vertical'];

// ── OtpInput ← wa-otp-input ──────────────────────────────────────────────
// Dropped knobs: @format (literal-separator groups), @case (transform),
// @withMask (hint glyphs), @appearance (segments wear the one Pretui Input
// dress), @size (fixed control-h square), @autosubmit/@required/@readonly
// (no form association in wave-0), @autofocus. The wa-complete event
// collapses into @onValueChange — compare value.length to @length.
class OtpInputDemo extends Component {
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

// ── TimeInput ← wa-time-input ────────────────────────────────────────────
// Dropped knobs: the popup column picker + @withNow (wa-popup machinery
// stays upstream), @min/@max/@step constraints, @placement, locale-aware
// segment order (fixed hour:minute[:second] then AM/PM), @required/form
// association, @size. Kept: the segmented spinbutton grammar itself —
// arrows wrap with no carry, empty segments seed from now, two-digit
// type-through, a/p keys, Backspace clears a segment.
class TimeInputDemo extends Component {
  cycleOptions = HOUR_CYCLES;
  @tracked value = '09:41';
  @tracked hourCycle = '24';
  @tracked withSeconds = false;
  @tracked disabled = false;
  setValue = (v: string) => (this.value = v);
  setHourCycle = (v: string) => (this.hourCycle = v);
  setWithSeconds = (v: boolean) => (this.withSeconds = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  get cycleVal() {
    return this.hourCycle as '24' | '12';
  }
  get usage() {
    let bits = [`@value='${this.value}'`];
    if (this.hourCycle !== '24') bits.push(`@hourCycle='${this.hourCycle}'`);
    if (this.withSeconds) bits.push('@withSeconds={{true}}');
    bits.push('@onValueChange={{this.setValue}}');
    return `<TimeInput ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='TimeInput'
      @description="The Calendar family's clock: segmented HH:MM entry (optional seconds, AM/PM in 12-hour mode) speaking the same spinbutton grammar as the date pickers. Arrow keys wrap a segment with no carry into its neighbors, digits type through with the two-digit buffer rule, a/p set the day period, Backspace clears. Transcribed from wa-time-input's segmented field; the popup column picker stayed upstream."
      @source={{this.usage}}
    >
      <:example>
        <TimeInput
          @value={{this.value}}
          @hourCycle={{this.cycleVal}}
          @withSeconds={{this.withSeconds}}
          @disabled={{this.disabled}}
          @onValueChange={{this.setValue}}
        />
        <p class='pretui-demo-readout' data-test-time-readout>
          value = “{{this.value}}”
        </p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @value={{this.value}}
          @description="Wire value — 'HH:MM', or 'HH:MM:SS' with @withSeconds (native input[type=time] format). Omit and seed @defaultValue for uncontrolled use."
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='hourCycle'
          @defaultValue='24'
          @value={{this.hourCycle}}
          @options={{this.cycleOptions}}
          @description="'12' adds the AM/PM segment and re-displays hours as 1–12; the wire value stays 24-hour."
          @onInput={{this.setHourCycle}}
        />
        <Args.Bool
          @name='withSeconds'
          @defaultValue={{false}}
          @value={{this.withSeconds}}
          @description='Adds the seconds segment and the :SS wire suffix.'
          @onInput={{this.setWithSeconds}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String
          @name='label'
          @defaultValue='Time'
          @description='Group label announced by assistive tech; each segment carries its own spinbutton label (Hour / Minute / Second / AM-PM).'
        />
        <Args.String
          @name='defaultValue'
          @description='Uncontrolled seed for the internal segments.'
        />
        <Args.Action
          @name='onValueChange'
          @description="Receives the wire string once all segments are filled, and '' when an edit makes the value incomplete."
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

// ── StepList ← @react-spectrum/steplist ──────────────────────────────────
export const DEPLOY_STEPS: StepItem[] = [
  { label: 'Build', state: 'complete', detail: 'Finished in 42s' },
  { label: 'Lint', state: 'in-progress', detail: 'Re-running lint\u2026' },
  {
    label: 'Sign',
    state: 'blocked',
    detail: 'Waiting on a release approval',
  },
  { label: 'Publish', state: 'upcoming', detail: '' },
];

export const DEMOS_CONTROLS_COMPOSITES: Record<string, unknown> = {
  OtpInput: OtpInputDemo,
  TimeInput: TimeInputDemo,
};
