// Pretui — Calendar usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Calendar } from './calendar';
import { FreestyleUsage } from './freestyle-usage';
import { Token } from './token';

const CAL_MODE_OPTIONS = ['single', 'range'];

// ── Calendar — THE Pretui date surface: the one month-grid implementation
//    both DatePicker and DateRangePicker open in their popovers, exported so
//    cards can also mount it inline. Knob set is native (fresh build). ─────
class CalendarUsage extends GlimmerComponent {
  @tracked mode = 'single';
  @tracked value = '2026-08-12';
  @tracked start: string | null = '2026-08-03';
  @tracked end: string | null = '2026-08-14';
  @tracked months = 1;
  @tracked minDate = '';
  @tracked maxDate = '';
  @tracked disabled = false;
  setMode = (v: string) => (this.mode = v);
  setMonths = (v: number) => (this.months = v);
  setMinDate = (v: string) => (this.minDate = v);
  setMaxDate = (v: string) => (this.maxDate = v);
  toggleDisabled = (v: boolean) => (this.disabled = v);
  onValue = (iso: string) => (this.value = iso);
  onRange = (r: { start: string | null; end: string | null }) => {
    this.start = r.start;
    this.end = r.end;
  };
  get modeVal() {
    return this.mode as 'single' | 'range';
  }
  get isRange() {
    return this.mode === 'range';
  }
  get rangeObj() {
    return { start: this.start, end: this.end };
  }
  get selectionString() {
    return this.isRange
      ? `${this.start ?? '—'} → ${this.end ?? '—'}`
      : this.value;
  }
  get minDateVal() {
    return this.minDate || undefined;
  }
  get maxDateVal() {
    return this.maxDate || undefined;
  }
  get usage() {
    return this.isRange
      ? `<Calendar @mode='range' @range={{this.range}} @months={{2}} @onRangeChange={{this.onRange}} />`
      : `<Calendar @value='${this.value}' @onValueChange={{this.onValue}} />`;
  }
  <template>
    <FreestyleUsage
      @name='Calendar'
      @description='The one Pretui month-grid calendar — the shared date surface DatePicker and DateRangePicker open in their popovers, exported for inline use. Pure date math over ISO yyyy-mm-dd strings; arrow keys rove the day buttons. @mode="single" selects one day; @mode="range" selects start then end (swapped if reversed) and paints the prospective span from hover or keyboard focus. @months lays panels side by side; a narrow container collapses them to the first month. Day state reflects as data-selected / data-range-start / data-range-end / data-in-range / data-today.'
      @source={{this.usage}}
    >
      <:example>
        <div class='cal-col'>
          <Token @value={{this.selectionString}} />
          {{#if this.isRange}}
            <Calendar
              @mode='range'
              @range={{this.rangeObj}}
              @months={{this.months}}
              @minDate={{this.minDateVal}}
              @maxDate={{this.maxDateVal}}
              @disabled={{this.disabled}}
              @onRangeChange={{this.onRange}}
            />
          {{else}}
            <Calendar
              @value={{this.value}}
              @months={{this.months}}
              @minDate={{this.minDateVal}}
              @maxDate={{this.maxDateVal}}
              @disabled={{this.disabled}}
              @onValueChange={{this.onValue}}
            />
          {{/if}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='mode'
          @description="Selection semantics: 'single' (one ISO day via @value/@onValueChange) or 'range' (start/end via @range/@onRangeChange)."
          @options={{CAL_MODE_OPTIONS}}
          @defaultValue='single'
          @value={{this.mode}}
          @onInput={{this.setMode}}
        />
        <Args.String
          @name='value'
          @description='Single mode: selected day as ISO yyyy-mm-dd (controlled — wins over internal state; seed @defaultValue for uncontrolled use).'
          @value={{this.value}}
          @hideControls={{true}}
        />
        <Args.Object
          @name='range'
          @description='Range mode: the selected span as ISO strings ({ start, end }; end is null between the first and second click). Controlled — seed @defaultRange for uncontrolled use.'
          @value={{this.rangeObj}}
        />
        <Args.Number
          @name='months'
          @description='Month panels laid side by side (default 1). Under a narrow container the calendar collapses to the first panel; side-by-side panels hide their outside days.'
          @defaultValue={{1}}
          @value={{this.months}}
          @onInput={{this.setMonths}}
        />
        <Args.String
          @name='minDate'
          @description='Earliest selectable day (ISO yyyy-mm-dd); earlier days render disabled and keyboard roving stops there.'
          @value={{this.minDate}}
          @onInput={{this.setMinDate}}
        />
        <Args.String
          @name='maxDate'
          @description='Latest selectable day (ISO yyyy-mm-dd); later days render disabled.'
          @value={{this.maxDate}}
          @onInput={{this.setMaxDate}}
        />
        <Args.Bool
          @name='disabled'
          @description='Disables every day button (the grid stays visible).'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.toggleDisabled}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Single mode: called with the ISO yyyy-mm-dd string when a day is picked.'
        />
        <Args.Action
          @name='onRangeChange'
          @description='Range mode: called on both clicks with { start, end } ISO strings — end is null after the first click, set (and ordered) after the second.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .cal-col {
        /* items stretch (no justify-items: start): the Calendar root is an
           inline-size container and takes its width from this column */
        display: grid;
        gap: var(--space-3, 8px);
        width: 100%;
      }
      .cal-col > :deep(.pretui-token) {
        justify-self: start;
      }
    </style>
  </template>
}

export const DEMOS_CALENDAR: Record<string, unknown> = {
  Calendar: CalendarUsage,
};
