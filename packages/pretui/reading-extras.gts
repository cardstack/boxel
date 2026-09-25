// Pretui — reading extras: entity + date display components.
// Foundation decisions (per 2026-08-12 standing rules, revised 2026-08-12
// "one calendar" pass):
// - EntityDisplay: FRESH, merging boxel-ui's entity-icon-display and
//   entity-thumbnail-display into one component with @variant='icon'|
//   'thumbnail'; the tag row reuses Pretui Chip.
// - Calendar: FRESH — THE Pretui date surface. One month-grid implementation
//   (pure date math, roving-tabindex arrow keys) shared by every date control
//   in the kit. @mode='single'|'range'; @months panels side by side that
//   collapse to the first month in a narrow container.
// - DatePicker: Pretui Input trigger + Popover around a single-mode Calendar.
// - DateRangePicker: FRESH — rebuilt on Calendar in range mode (previously
//   wrapped boxel-ui's ember-power-calendar DateRangePicker; the wrap is
//   gone so both date controls share the same Pretui calendar). Popover
//   trigger consistent with DatePicker's; two months by default.
// - RelativeTime: FRESH (webawesome relative-time semantics) — computes the
//   phrase ONCE from @date vs @now; @now is caller-supplied (LoadingState
//   precedent). It does NOT auto-tick: the realm forbids timers.
// Visual values flow through theme tokens only; fallbacks declared per root.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { focusWhen, rovingTabindex } from './focus';
import { Chip } from './ink';
import { Input } from './controls';
import { Popover } from './overlay';

// ── shared date math (pure — no deps, no timers) ─────────────────────────
const DISPLAY_FMT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
const MONTH_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
});
const ABS_FMT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function toIso(d: Date): string {
  let mm = String(d.getMonth() + 1).padStart(2, '0');
  let dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function fromIso(iso: string): Date | undefined {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    return undefined;
  }
  let [, y, mo, da] = m;
  return new Date(Number(y), Number(mo) - 1, Number(da));
}

// ── EntityDisplay ────────────────────────────────────────────────────────
// Merges entity-icon-display + entity-thumbnail-display semantics: a visual
// slot (icon or thumbnail dress via @variant) beside a title row with an
// optional Chip tag, then a subtitle line — or the <:meta> block when the
// second row needs real markup (meta wins over @subtitle, mirroring the
// block-beats-arg precedence of the boxel-ui originals).
export interface EntityDisplaySignature {
  Args: {
    title?: string;
    subtitle?: string;
    tag?: string;
    variant?: 'icon' | 'thumbnail';
    center?: boolean;
    underline?: boolean;
  };
  Blocks: { visual?: []; meta?: [] };
  Element: HTMLElement;
}

export class EntityDisplay extends Component<EntityDisplaySignature> {
  get variant(): 'icon' | 'thumbnail' {
    return this.args.variant ?? 'icon';
  }
  <template>
    <div
      class='pretui-entity'
      data-variant={{this.variant}}
      data-center={{if @center 'true'}}
      data-test-pretui-entity-display
      ...attributes
    >
      {{#if (has-block 'visual')}}
        <span class='pretui-entity-visual'>{{yield to='visual'}}</span>
      {{/if}}
      <div class='pretui-entity-info'>
        <div class='pretui-entity-titlerow'>
          {{#if @title}}
            <span
              class='pretui-entity-title'
              data-underline={{if @underline 'true'}}
            >{{@title}}</span>
          {{/if}}
          {{#if @tag}}
            <Chip @label={{@tag}} @dot={{false}} />
          {{/if}}
        </div>
        {{#if (has-block 'meta')}}
          <div class='pretui-entity-meta'>{{yield to='meta'}}</div>
        {{else if @subtitle}}
          <div class='pretui-entity-meta'>{{@subtitle}}</div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .pretui-entity {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3, 8px);
        min-width: 0;
      }
      .pretui-entity[data-center] {
        align-items: center;
      }
      .pretui-entity-visual {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
      }
      .pretui-entity[data-variant='icon'] .pretui-entity-visual {
        width: var(--pretui-entity-visual-size, 18px);
        height: var(--pretui-entity-visual-size, 18px);
        color: var(--muted-foreground);
      }
      .pretui-entity[data-variant='icon'] .pretui-entity-visual :deep(svg) {
        width: 100%;
        height: 100%;
      }
      .pretui-entity[data-variant='thumbnail'] .pretui-entity-visual {
        width: var(--pretui-entity-visual-size, 22px);
        height: var(--pretui-entity-visual-size, 22px);
        border-radius: var(--radius-chip, 6px);
        overflow: hidden;
        background: var(--inset, var(--boxel-100));
        box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
      }
      .pretui-entity-info {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .pretui-entity-titlerow {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
      }
      .pretui-entity-title {
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
        color: var(--foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pretui-entity-title[data-underline] {
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .pretui-entity-meta {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

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

// ── DatePicker ───────────────────────────────────────────────────────────
// Single-date input: readonly Pretui Input trigger + Popover around a
// single-mode Calendar (the popover renders its content only while open, so
// the calendar re-derives its view from @value on every open).
export interface DatePickerSignature {
  Args: {
    value?: string; // ISO yyyy-mm-dd (controlled)
    defaultValue?: string; // ISO yyyy-mm-dd (uncontrolled seed)
    disabled?: boolean;
    onValueChange?: (iso: string) => void;
  };
  Element: HTMLSpanElement;
}

export class DatePicker extends Component<DatePickerSignature> {
  @tracked internal: string | undefined = this.args.defaultValue;

  get selectedIso(): string | undefined {
    return this.args.value ?? this.internal;
  }
  get display(): string {
    let iso = this.selectedIso;
    if (!iso) {
      return '';
    }
    let d = fromIso(iso);
    return d ? DISPLAY_FMT.format(d) : iso;
  }
  onTriggerKey = (open: boolean, toggle: () => void, e: Event) => {
    let key = (e as KeyboardEvent).key;
    if (!open && (key === 'Enter' || key === ' ' || key === 'ArrowDown')) {
      e.preventDefault();
      toggle();
    }
  };
  pick = (close: () => void, iso: string) => {
    this.internal = iso;
    this.args.onValueChange?.(iso);
    close();
  };

  <template>
    <span class='pretui-datepicker' data-test-pretui-date-picker ...attributes>
      <Popover @placement='bottom-start' @label='Choose date'>
        <:trigger as |open toggle|>
          <Input
            @value={{this.display}}
            @placeholder='Select date'
            @disabled={{@disabled}}
            class='pretui-datepicker-trigger'
            readonly
            aria-haspopup='dialog'
            aria-expanded={{if open 'true' 'false'}}
            {{on 'click' toggle}}
            {{on 'keydown' (fn this.onTriggerKey open toggle)}}
          />
        </:trigger>
        <:default as |close|>
          <Calendar
            @value={{this.selectedIso}}
            @onValueChange={{fn this.pick close}}
          />
        </:default>
      </Popover>
    </span>
    <style scoped>
      .pretui-datepicker {
        display: inline-block;
      }
      .pretui-datepicker-trigger {
        min-width: 150px;
        cursor: pointer;
      }
      /* the Calendar root is an inline-size container (its width comes from
         the parent), so the panel takes the one-month width explicitly:
         7 × 30px cells + 6 × 2px gaps + panel padding. Sized through
         Popover's own custom-property knobs (they inherit — no :deep()). */
      .pretui-datepicker {
        --pretui-popover-width: calc(222px + 2 * var(--space-4, 11px));
        --pretui-popover-min-width: 0;
      }
    </style>
  </template>
}

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

// ── RelativeTime ─────────────────────────────────────────────────────────
// webawesome relative-time semantics, realm-adapted: the phrase is computed
// ONCE from @date vs @now (Intl.RelativeTimeFormat) and re-derives only when
// the args change. @now is caller-supplied per the LoadingState precedent;
// when omitted it captures the construction instant. It does NOT auto-tick —
// the realm forbids timers, so "2 minutes ago" stays put until the caller
// refreshes @now.
export interface RelativeTimeSignature {
  Args: {
    date: string | Date;
    now?: string | Date;
    format?: 'long' | 'short' | 'narrow';
    numeric?: 'always' | 'auto';
  };
  Element: HTMLTimeElement;
}

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365.25 * 24 * 3600e3 },
  { unit: 'month', ms: 30.44 * 24 * 3600e3 },
  { unit: 'week', ms: 7 * 24 * 3600e3 },
  { unit: 'day', ms: 24 * 3600e3 },
  { unit: 'hour', ms: 3600e3 },
  { unit: 'minute', ms: 60e3 },
];

function asDate(value: string | Date | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  let d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export class RelativeTime extends Component<RelativeTimeSignature> {
  // Captured once — the no-timer stand-in for "now" when @now is omitted.
  private constructedAt = new Date();

  get dateObj(): Date | undefined {
    return asDate(this.args.date);
  }
  get nowObj(): Date {
    return asDate(this.args.now) ?? this.constructedAt;
  }
  get phrase(): string {
    let date = this.dateObj;
    if (!date) {
      return '';
    }
    let diff = date.getTime() - this.nowObj.getTime();
    let match = RELATIVE_UNITS.find((u) => Math.abs(diff) >= u.ms);
    let unit: Intl.RelativeTimeFormatUnit = match?.unit ?? 'second';
    let ms = match?.ms ?? 1e3;
    let fmt = new Intl.RelativeTimeFormat('en-US', {
      style: this.args.format ?? 'long',
      numeric: this.args.numeric ?? 'auto',
    });
    return fmt.format(Math.round(diff / ms), unit);
  }
  get datetimeAttr(): string | undefined {
    return this.dateObj?.toISOString();
  }
  get titleAttr(): string | undefined {
    let d = this.dateObj;
    return d ? ABS_FMT.format(d) : undefined;
  }
  <template>
    <time
      class='pretui-relative-time'
      datetime={{this.datetimeAttr}}
      title={{this.titleAttr}}
      data-test-pretui-relative-time
      ...attributes
    >{{this.phrase}}</time>
    <style scoped>
      .pretui-relative-time {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}
