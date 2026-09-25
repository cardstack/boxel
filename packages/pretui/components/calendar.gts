// Pretui — Calendar: the month grid every date control in the kit shares.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { focusWhen, rovingTabindex } from '../focus';
import { LABEL_FMT, MONTH_FMT, fromIso, toIso } from '../internal/reading-extras';

// ── Calendar ─────────────────────────────────────────────────────────────
// THE Pretui date surface: one month-grid calendar shared by DatePicker and
// DateRangePicker so the kit has exactly one calendar implementation.
// Focus follows the arrow keys via a roving tabindex: the modifier focuses a
// day button only when it just became the keyboard target (navigating flag —
// never steals focus on plain renders).
// (Both primitives now live in focus.gts, the kit's single focus/keyboard
// foundation — Appendix L named this duplication; it is discharged here.)

interface DayCell {
  iso: string;
  day: number;
  outside: boolean;
  label: string;
}

interface CalendarPanel {
  key: string;
  label: string;
  cells: DayCell[];
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface DateRangeValue {
  start?: string | null;
  end?: string | null;
}

export interface CalendarSignature {
  Args: {
    mode?: 'single' | 'range'; // default 'single'
    value?: string; // single: ISO yyyy-mm-dd (controlled)
    defaultValue?: string; // single: uncontrolled seed
    onValueChange?: (iso: string) => void; // single: day picked
    range?: DateRangeValue; // range: controlled { start, end }
    defaultRange?: DateRangeValue; // range: uncontrolled seed
    onRangeChange?: (range: {
      start: string | null;
      end: string | null;
    }) => void; // range: fires on both clicks (end null after the first)
    months?: number; // panels side by side (default 1); narrow containers collapse to the first
    minDate?: string; // ISO yyyy-mm-dd — earlier days disabled
    maxDate?: string; // ISO yyyy-mm-dd — later days disabled
    disabled?: boolean; // every day disabled
  };
  Element: HTMLDivElement;
}

// Range semantics: first click sets start (end null), second completes —
// swapped when picked in reverse. While the end is unset the prospective
// span paints from the hovered day (or the keyboard focus when arrowing).
// Day state is reflected as data-* attributes: data-selected (single),
// data-range-start / data-range-end / data-in-range (range), data-today,
// data-outside. ISO yyyy-mm-dd strings at every boundary — they compare
// lexicographically, so the range math needs no Date objects.
export class Calendar extends Component<CalendarSignature> {
  private initDate =
    fromIso(
      this.args.value ??
        this.args.defaultValue ??
        this.args.range?.start ??
        this.args.defaultRange?.start ??
        this.args.range?.end ??
        this.args.defaultRange?.end ??
        '',
    ) ?? new Date();
  private todayIso = toIso(new Date());
  @tracked internalValue: string | undefined = this.args.defaultValue;
  @tracked internalRange: DateRangeValue | undefined = this.args.defaultRange;
  @tracked viewYear = this.initDate.getFullYear();
  @tracked viewMonth = this.initDate.getMonth();
  @tracked focusIso = toIso(this.initDate);
  @tracked navigating = false;
  @tracked hoverIso: string | undefined;

  weekdays = WEEKDAYS;

  get mode(): 'single' | 'range' {
    return this.args.mode ?? 'single';
  }
  get monthCount(): number {
    return Math.max(1, Math.floor(this.args.months ?? 1));
  }
  get isMulti(): boolean {
    return this.monthCount > 1;
  }
  get selectedIso(): string | undefined {
    return this.args.value ?? this.internalValue;
  }
  get rangeValue(): DateRangeValue {
    return this.args.range ?? this.internalRange ?? {};
  }
  get firstIso(): string {
    return toIso(new Date(this.viewYear, this.viewMonth, 1));
  }
  get lastIso(): string {
    return toIso(new Date(this.viewYear, this.viewMonth + this.monthCount, 0));
  }
  get panels(): CalendarPanel[] {
    let out: CalendarPanel[] = [];
    for (let p = 0; p < this.monthCount; p++) {
      let first = new Date(this.viewYear, this.viewMonth + p, 1);
      let y = first.getFullYear();
      let m = first.getMonth();
      let startOffset = first.getDay();
      let cells: DayCell[] = [];
      for (let i = 0; i < 42; i++) {
        let d = new Date(y, m, 1 - startOffset + i);
        cells.push({
          iso: toIso(d),
          day: d.getDate(),
          outside: d.getMonth() !== m,
          label: LABEL_FMT.format(d),
        });
      }
      out.push({ key: `${y}-${m}`, label: MONTH_FMT.format(first), cells });
    }
    return out;
  }
  get rovingIso(): string {
    let f = this.focusIso;
    return f >= this.firstIso && f <= this.lastIso ? f : this.firstIso;
  }
  // Committed range, or the prospective span while the end is unset — the
  // probe is the hovered day, falling back to the keyboard focus target.
  get paint(): { start?: string; end?: string } {
    if (this.mode !== 'range') {
      return {};
    }
    let { start, end } = this.rangeValue;
    if (start && end) {
      return { start, end };
    }
    if (start) {
      let probe =
        this.hoverIso ?? (this.navigating ? this.focusIso : undefined);
      if (probe && probe !== start) {
        return probe < start
          ? { start: probe, end: start }
          : { start, end: probe };
      }
      return { start, end: start };
    }
    return {};
  }

  isSelected = (cell: DayCell): boolean =>
    this.mode === 'single' && cell.iso === this.selectedIso;
  isRangeStart = (cell: DayCell): boolean => cell.iso === this.paint.start;
  isRangeEnd = (cell: DayCell): boolean => cell.iso === this.paint.end;
  isInRange = (cell: DayCell): boolean => {
    let { start, end } = this.paint;
    return !!start && !!end && cell.iso > start && cell.iso < end;
  };
  isToday = (cell: DayCell): boolean => cell.iso === this.todayIso;
  isPressed = (cell: DayCell): boolean =>
    this.isSelected(cell) || this.isRangeStart(cell) || this.isRangeEnd(cell);
  isDisabled = (cell: DayCell): boolean =>
    this.args.disabled === true ||
    (this.args.minDate !== undefined && cell.iso < this.args.minDate) ||
    (this.args.maxDate !== undefined && cell.iso > this.args.maxDate);
  isRovingTarget = (cell: DayCell): boolean =>
    this.navigating && !cell.outside && cell.iso === this.focusIso;
  isRoving = (cell: DayCell): boolean =>
    !cell.outside && cell.iso === this.rovingIso;

  setView = (d: Date) => {
    this.viewYear = d.getFullYear();
    this.viewMonth = d.getMonth();
  };
  // Keep d visible: scroll the view back for earlier dates, forward (keeping
  // d in the LAST panel) for later ones.
  setViewToInclude = (d: Date) => {
    let iso = toIso(d);
    if (iso < this.firstIso) {
      this.setView(d);
    } else if (iso > this.lastIso) {
      this.setView(
        new Date(d.getFullYear(), d.getMonth() - (this.monthCount - 1), 1),
      );
    }
  };
  prevMonth = () => {
    this.setView(new Date(this.viewYear, this.viewMonth - 1, 1));
  };
  nextMonth = () => {
    this.setView(new Date(this.viewYear, this.viewMonth + 1, 1));
  };
  onDayKeydown = (e: Event) => {
    let key = (e as KeyboardEvent).key;
    let delta =
      key === 'ArrowLeft'
        ? -1
        : key === 'ArrowRight'
          ? 1
          : key === 'ArrowUp'
            ? -7
            : key === 'ArrowDown'
              ? 7
              : 0;
    if (!delta) {
      return;
    }
    e.preventDefault();
    let d = fromIso(this.focusIso);
    if (!d) {
      return;
    }
    d.setDate(d.getDate() + delta);
    let iso = toIso(d);
    if (this.args.minDate !== undefined && iso < this.args.minDate) {
      return;
    }
    if (this.args.maxDate !== undefined && iso > this.args.maxDate) {
      return;
    }
    this.navigating = true;
    this.focusIso = iso;
    this.setViewToInclude(d);
  };
  hoverDay = (cell: DayCell) => {
    this.hoverIso = cell.iso;
  };
  clearHover = () => {
    this.hoverIso = undefined;
  };
  pick = (cell: DayCell) => {
    this.focusIso = cell.iso;
    let d = fromIso(cell.iso);
    if (d) {
      this.setViewToInclude(d);
    }
    if (this.mode === 'range') {
      let { start, end } = this.rangeValue;
      let next: { start: string | null; end: string | null };
      if (!start || end) {
        next = { start: cell.iso, end: null };
      } else if (cell.iso < start) {
        next = { start: cell.iso, end: start };
      } else {
        next = { start, end: cell.iso };
      }
      this.internalRange = next;
      this.args.onRangeChange?.(next);
    } else {
      this.internalValue = cell.iso;
      this.args.onValueChange?.(cell.iso);
    }
  };

  <template>
    <div
      class='pretui-calendar'
      data-mode={{this.mode}}
      data-multi={{if this.isMulti 'true'}}
      data-test-pretui-calendar
      ...attributes
    >
      <div class='pretui-cal-panels' {{on 'pointerleave' this.clearHover}}>
        {{#each this.panels key='key' as |panel|}}
          <div class='pretui-cal-panel'>
            <div class='pretui-cal-head'>
              <button
                type='button'
                class='pretui-cal-nav'
                data-dir='prev'
                aria-label='Previous month'
                {{on 'click' this.prevMonth}}
              >‹</button>
              <span class='pretui-cal-month'>{{panel.label}}</span>
              <button
                type='button'
                class='pretui-cal-nav'
                data-dir='next'
                aria-label='Next month'
                {{on 'click' this.nextMonth}}
              >›</button>
            </div>
            <div class='pretui-cal-weekdays'>
              {{#each this.weekdays as |w|}}
                <span class='pretui-cal-weekday'>{{w}}</span>
              {{/each}}
            </div>
            <div class='pretui-cal-grid'>
              {{#each panel.cells key='iso' as |cell|}}
                <button
                  type='button'
                  class='pretui-cal-day'
                  disabled={{if (this.isDisabled cell) true}}
                  data-outside={{if cell.outside 'true'}}
                  data-selected={{if (this.isSelected cell) 'true'}}
                  data-range-start={{if (this.isRangeStart cell) 'true'}}
                  data-range-end={{if (this.isRangeEnd cell) 'true'}}
                  data-in-range={{if (this.isInRange cell) 'true'}}
                  data-today={{if (this.isToday cell) 'true'}}
                  aria-label={{cell.label}}
                  aria-pressed={{if (this.isPressed cell) 'true' 'false'}}
                  {{rovingTabindex (this.isRoving cell)}}
                  {{focusWhen (this.isRovingTarget cell)}}
                  {{on 'click' (fn this.pick cell)}}
                  {{on 'pointerenter' (fn this.hoverDay cell)}}
                  {{on 'keydown' this.onDayKeydown}}
                >{{cell.day}}</button>
              {{/each}}
            </div>
          </div>
        {{/each}}
      </div>
    </div>
    <style scoped>
      .pretui-calendar {
        /* inline-size container so panels can collapse under narrow hosts;
           containment means width comes from the parent, not the grid —
           hosts (or popover panels) give the calendar an explicit width */
        container-type: inline-size;
        width: 100%;
      }
      .pretui-cal-panels {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-5, 14px);
      }
      .pretui-cal-panel {
        display: grid;
        gap: var(--space-3, 8px);
      }
      .pretui-cal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3, 8px);
      }
      .pretui-cal-month {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--foreground);
      }
      .pretui-cal-nav {
        width: 24px;
        height: 24px;
        border: 0;
        padding: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--muted-foreground);
        font-size: 14px;
        line-height: 1;
        display: inline-grid;
        place-content: center;
        cursor: pointer;
      }
      .pretui-cal-nav:hover {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      /* multi-month: prev lives on the first panel, next on the last */
      .pretui-cal-panel:not(:first-child) .pretui-cal-nav[data-dir='prev'],
      .pretui-cal-panel:not(:last-child) .pretui-cal-nav[data-dir='next'] {
        visibility: hidden;
      }
      .pretui-cal-weekdays,
      .pretui-cal-grid {
        display: grid;
        grid-template-columns: repeat(7, 30px);
        gap: 2px;
      }
      .pretui-cal-weekday {
        display: inline-grid;
        place-content: center;
        height: 18px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-cal-day {
        height: 28px;
        border: 0;
        padding: 0;
        border-radius: 7px;
        background: transparent;
        font-size: var(--text-ui-md, 12.5px);
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
        cursor: pointer;
      }
      .pretui-cal-day:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-cal-day:disabled {
        color: var(--ink-3, var(--boxel-400));
        opacity: 0.55;
        cursor: default;
      }
      .pretui-cal-day[data-outside] {
        color: var(--ink-3, var(--boxel-400));
      }
      /* side-by-side months: outside days would duplicate their neighbor's
         in-month days, so they hide (still occupying their grid slot) */
      .pretui-calendar[data-multi] .pretui-cal-day[data-outside] {
        visibility: hidden;
      }
      .pretui-cal-day[data-today] {
        box-shadow: inset 0 0 0 1px var(--line-strong, var(--boxel-400));
      }
      .pretui-cal-day[data-in-range] {
        background: color-mix(in oklch, var(--primary) 14%, var(--card));
        color: color-mix(in oklch, var(--foreground) 30%, var(--primary));
        border-radius: 0;
      }
      .pretui-cal-day[data-selected],
      .pretui-cal-day[data-range-start],
      .pretui-cal-day[data-range-end] {
        background: var(--primary);
        color: var(--primary-foreground);
        font-weight: 600;
      }
      .pretui-cal-day[data-range-start] {
        border-radius: 7px 0 0 7px;
      }
      .pretui-cal-day[data-range-end] {
        border-radius: 0 7px 7px 0;
      }
      .pretui-cal-day[data-range-start][data-range-end] {
        border-radius: 7px;
      }
      .pretui-cal-day:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      @container (max-width: 455px) {
        .pretui-cal-panel:not(:first-child) {
          display: none;
        }
        .pretui-cal-panel:first-child .pretui-cal-nav[data-dir='next'] {
          visibility: visible;
        }
      }
    </style>
  </template>
}
