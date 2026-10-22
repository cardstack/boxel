// Pretui — DatePicker usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { DatePicker } from './date-picker';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';

// ── DatePicker — built fresh (boxel-ui exports no single-date picker; only
//    DateRangePicker) — no boxel usage page to port, so
//    the knob set is native. Popover trigger + shared Pretui Calendar;
//    arrow keys rove the day buttons. ──────────────────────────────────────
class DatePickerUsage extends GlimmerComponent {
  @tracked value = '2026-08-12';
  @tracked disabled = false;
  setValue = (v: string) => (this.value = v);
  toggleDisabled = (v: boolean) => (this.disabled = v);
  onChange = (iso: string) => (this.value = iso);
  get usage() {
    return `<DatePicker @value='${this.value}' @onValueChange={{this.onChange}} />`;
  }
  <template>
    <FreestyleUsage
      @name='DatePicker'
      @description='Single-date input: a readonly Pretui Input trigger opening the shared Pretui Calendar (single mode) in a Popover. Arrow keys move the focused day (roving tabindex), Enter selects, Escape or the backdrop closes. Dates travel as ISO yyyy-mm-dd strings.'
      @source={{this.usage}}
    >
      <:example>
        <DatePicker
          @value={{this.value}}
          @disabled={{this.disabled}}
          @onValueChange={{this.onChange}}
        />
        <Token @value={{this.value}} />
        <DatePicker @defaultValue='2026-08-20' />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @description='Selected date as ISO yyyy-mm-dd (controlled — wins over internal state).'
          @value={{this.value}}
          @onInput={{this.setValue}}
        />
        <Args.String
          @name='defaultValue'
          @description='Uncontrolled seed, ISO yyyy-mm-dd — the second specimen manages itself from this.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='disabled'
          @description='Disables the trigger input.'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.toggleDisabled}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Called with the ISO yyyy-mm-dd string when a day is picked.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_DATE_PICKER: Record<string, unknown> = {
  DatePicker: DatePickerUsage,
};
