// Pretui — DateRangePicker: a trigger opening a range-mode Calendar.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Input } from './input';
import { Popover } from './popover';
import { Calendar } from './calendar';
import type { DateRangeValue } from './calendar';
import { DISPLAY_FMT, fromIso } from '../internal/reading-extras';

// ── DateRangePicker ──────────────────────────────────────────────────────
// FRESH (rebuilt 2026-08-12; previously wrapped boxel-ui's ember-power-
// calendar DateRangePicker): a readonly Pretui Input trigger + Popover
// around a range-mode Calendar — the same month grid DatePicker uses. Two
// months side by side by default; the calendar collapses to one month in a
// narrow container. First click sets the start, second completes the range
// (swapped when reversed) and closes the popover; hover paints the
// prospective span. ISO yyyy-mm-dd strings both ways.
export interface DateRangePickerSignature {
  Args: {
    value?: DateRangeValue; // controlled
    defaultValue?: DateRangeValue; // uncontrolled seed
    minDate?: string; // ISO yyyy-mm-dd
    maxDate?: string; // ISO yyyy-mm-dd
    months?: number; // side-by-side months (default 2)
    disabled?: boolean;
    onValueChange?: (range: { start: string | null; end: string | null }) => void;
  };
  Element: HTMLDivElement;
}

export class DateRangePicker extends Component<DateRangePickerSignature> {
  @tracked internal: DateRangeValue | undefined = this.args.defaultValue;

  get value(): DateRangeValue {
    return this.args.value ?? this.internal ?? {};
  }
  get monthCount(): number {
    return Math.max(1, Math.floor(this.args.months ?? 2));
  }
  get display(): string {
    let start = fromIso(this.value.start ?? '');
    let end = fromIso(this.value.end ?? '');
    if (start && end) {
      return `${DISPLAY_FMT.format(start)} – ${DISPLAY_FMT.format(end)}`;
    }
    if (start) {
      return `${DISPLAY_FMT.format(start)} – …`;
    }
    return '';
  }
  onTriggerKey = (open: boolean, toggle: () => void, e: Event) => {
    let key = (e as KeyboardEvent).key;
    if (!open && (key === 'Enter' || key === ' ' || key === 'ArrowDown')) {
      e.preventDefault();
      toggle();
    }
  };
  handleRange = (
    close: () => void,
    next: { start: string | null; end: string | null },
  ) => {
    this.internal = next;
    this.args.onValueChange?.(next);
    if (next.start && next.end) {
      close();
    }
  };

  <template>
    <div
      class='pretui-daterange'
      data-months={{this.monthCount}}
      data-test-pretui-date-range-picker
      ...attributes
    >
      <Popover @placement='bottom-start' @label='Choose date range'>
        <:trigger as |open toggle|>
          <Input
            @value={{this.display}}
            @placeholder='Select date range'
            @disabled={{@disabled}}
            class='pretui-daterange-trigger'
            readonly
            aria-haspopup='dialog'
            aria-expanded={{if open 'true' 'false'}}
            {{on 'click' toggle}}
            {{on 'keydown' (fn this.onTriggerKey open toggle)}}
          />
        </:trigger>
        <:default as |close|>
          <Calendar
            @mode='range'
            @range={{this.value}}
            @months={{this.monthCount}}
            @minDate={{@minDate}}
            @maxDate={{@maxDate}}
            @onRangeChange={{fn this.handleRange close}}
          />
        </:default>
      </Popover>
    </div>
    <style scoped>
      .pretui-daterange {
        display: inline-block;
      }
      .pretui-daterange-trigger {
        min-width: 230px;
        cursor: pointer;
      }
      /* two one-month panels (222px each) + panel gap + popover padding;
         viewport-capped so the calendar's container query can collapse it
         to a single month on narrow screens. Sized through Popover's own
         custom-property knobs (they inherit — no :deep()). */
      .pretui-daterange {
        --pretui-popover-width: calc(
          444px + var(--space-5, 14px) + 2 * var(--space-4, 11px)
        );
        --pretui-popover-max-width: calc(100vw - 16px);
        --pretui-popover-min-width: 0;
      }
      .pretui-daterange[data-months='1'] {
        --pretui-popover-width: calc(222px + 2 * var(--space-4, 11px));
      }
    </style>
  </template>
}
