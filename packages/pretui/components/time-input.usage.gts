// Pretui — TimeInput usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { TimeInput } from './time-input';

const HOUR_CYCLES = ['24', '12'];

// ── TimeInput ← wa-time-input ────────────────────────────────────────────
// Dropped knobs: the popup column picker + @withNow (wa-popup machinery
// stays upstream), @min/@max/@step constraints, @placement, locale-aware
// segment order (fixed hour:minute[:second] then AM/PM), @required/form
// association, @size. Kept: the segmented spinbutton grammar itself —
// arrows wrap with no carry, empty segments seed from now, two-digit
// type-through, a/p keys, Backspace clears a segment.
class TimeInputUsage extends Component {
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

export const DEMOS_TIME_INPUT: Record<string, unknown> = {
  TimeInput: TimeInputUsage,
};
