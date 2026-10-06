// Pretui — DateRangePicker usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { DateRangePicker } from './date-range-picker';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';

// ── DateRangePicker — the shared Pretui Calendar in range mode behind a
//    popover trigger that matches DatePicker's. ──────────────────────────
class DateRangePickerUsage extends GlimmerComponent {
  @tracked start: string | null = '2026-08-03';
  @tracked end: string | null = '2026-08-14';
  @tracked minDate = '';
  @tracked maxDate = '';
  @tracked months = 2;
  @tracked disabled = false;
  setStart = (v: string) => (this.start = v || null);
  setEnd = (v: string) => (this.end = v || null);
  setMinDate = (v: string) => (this.minDate = v);
  setMaxDate = (v: string) => (this.maxDate = v);
  setMonths = (v: number) => (this.months = v);
  toggleDisabled = (v: boolean) => (this.disabled = v);
  onChange = (r: { start: string | null; end: string | null }) => {
    this.start = r.start;
    this.end = r.end;
  };
  get rangeObj() {
    return { start: this.start, end: this.end };
  }
  get rangeString() {
    return `${this.start ?? '—'} → ${this.end ?? '—'}`;
  }
  get startStr() {
    return this.start ?? '';
  }
  get endStr() {
    return this.end ?? '';
  }
  get minDateVal() {
    return this.minDate || undefined;
  }
  get maxDateVal() {
    return this.maxDate || undefined;
  }
  get usage() {
    return `<DateRangePicker @value={{this.range}} @onValueChange={{this.onChange}} />`;
  }
  <template>
    <FreestyleUsage
      @name='DateRangePicker'
      @description='Range input for filters, reports, booking flows, and any time-window: a readonly Pretui Input trigger opening the shared Pretui Calendar in range mode — two months side by side, collapsing to one in a narrow container. First click sets the start, second completes the range (swapped if reversed) and closes the popover; hover paints the prospective span. Speaks ISO yyyy-mm-dd strings both ways.'
      @source={{this.usage}}
    >
      <:example>
        <div class='range-col'>
          <Token @value={{this.rangeString}} />
          <DateRangePicker
            @value={{this.rangeObj}}
            @minDate={{this.minDateVal}}
            @maxDate={{this.maxDateVal}}
            @months={{this.months}}
            @disabled={{this.disabled}}
            @onValueChange={{this.onChange}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value.start'
          @description='Start of the controlled range (ISO yyyy-mm-dd; empty = unset). Together with value.end this is the { start, end } @value object — seed @defaultValue instead for uncontrolled use.'
          @value={{this.startStr}}
          @onInput={{this.setStart}}
        />
        <Args.String
          @name='value.end'
          @description='End of the controlled range (ISO yyyy-mm-dd; empty = unset — the trigger shows "start – …" while selecting).'
          @value={{this.endStr}}
          @onInput={{this.setEnd}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Called with { start, end } ISO yyyy-mm-dd strings on both clicks — end is null after the first click, set (and ordered) after the second, which also closes the popover.'
          @required={{true}}
        />
        <Args.String
          @name='minDate'
          @description='Earliest selectable day (ISO yyyy-mm-dd); days before it render disabled. Set to today for an Airbnb-style no-past-dates calendar.'
          @value={{this.minDate}}
          @onInput={{this.setMinDate}}
        />
        <Args.String
          @name='maxDate'
          @description='Latest selectable day (ISO yyyy-mm-dd); days after it render disabled (e.g. a booking horizon).'
          @value={{this.maxDate}}
          @onInput={{this.setMaxDate}}
        />
        <Args.Number
          @name='months'
          @description='Side-by-side month panels in the popover calendar (default 2); narrow containers collapse to the first.'
          @defaultValue={{2}}
          @value={{this.months}}
          @onInput={{this.setMonths}}
        />
        <Args.Bool
          @name='disabled'
          @description='Disables the trigger input (the popover cannot open).'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.toggleDisabled}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .range-col {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
      }
    </style>
  </template>
}

export const DEMOS_DATE_RANGE_PICKER: Record<string, unknown> = {
  DateRangePicker: DateRangePickerUsage,
};
