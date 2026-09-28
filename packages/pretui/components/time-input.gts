// Pretui — TimeInput: a segmented HH:MM time field.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

// Transcribed from wa-time-input's segmented field (the Calendar family's
// clock — same segmented spinbutton grammar the date pickers speak, applied
// to hours and minutes): HH:MM segments plus optional seconds and an AM/PM
// segment in 12-hour mode. Kept WA semantics: arrow keys wrap within a
// segment's bounds with NO carry into neighbors (native <input type='time'>
// behavior), digits type through with the two-digit buffer rule (6 in a
// minute segment commits + advances; 1 buffers awaiting a second digit),
// 'a'/'p' set the day period, Backspace/Delete clear a segment. Wire format
// is WA's: 'HH:MM', or 'HH:MM:SS' with @withSeconds — @onValueChange
// receives it when all segments are filled, and '' when the value becomes
// incomplete. Dropped (wave-0, documented): the popup column picker +
// Now button (wa-popup machinery), min/max/step constraints, locale-aware
// segment order (fixed H:M:S + trailing AM/PM), form association.
// Departure from WA, forced by realm law: WA seeds an empty segment from the
// CURRENT TIME on its first arrow step. Realm code may not read the clock
// (no Date.now / new Date), so the seed is a reference time the caller
// supplies — @now, the same argument RelativeTime takes — defaulting to each
// segment's minimum (00 / 00 / 00 / AM) when it is omitted. Seeding is
// therefore deterministic and testable, which the upstream is not.
// Review pass 2026-08-12 also added Home/End (the ARIA spinbutton pattern
// requires them; WA omits them), aria-disabled on the segments, and a
// forced-colors-safe focus outline; the colon separator moved out of a
// template function call into the precomputed segment view.

export type TimeInputHourCycle = '24' | '12';

type TimeField = 'hour' | 'minute' | 'second' | 'dayPeriod';

interface TimeSegs {
  hh: number | null; // wire hour, 0-23
  mm: number | null;
  ss: number | null;
  dp: 0 | 1 | null; // 0 = AM, 1 = PM; display state for 12-hour mode
}

// the reference time an empty segment steps from — every member resolved,
// so stepField never has to reason about holes
interface TimeSeed {
  hh: number;
  mm: number;
  ss: number;
  dp: 0 | 1;
}

interface TimeSegmentView {
  part: TimeField;
  text: string;
  ariaLabel: string;
  min: number;
  max: number;
  now: number | undefined;
  valueText: string;
  empty: boolean;
  /** a ':' literal follows this segment */
  colonAfter: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function parseWire(v: string | undefined): TimeSegs {
  let m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v ?? '');
  if (!m) return { hh: null, mm: null, ss: null, dp: null };
  let hh = Number(m[1]);
  let mm = Number(m[2]);
  let ss = m[3] === undefined ? null : Number(m[3]);
  if (hh > 23 || mm > 59 || (ss ?? 0) > 59) {
    return { hh: null, mm: null, ss: null, dp: null };
  }
  return { hh, mm, ss, dp: hh < 12 ? 0 : 1 };
}

// WA's typeNumericSegment: shared two-digit buffer logic for any [min, max]
// segment. First digit commits immediately (partial display); a digit that
// could never take a second digit advances at once; overflow replaces.
function typeDigit(
  buffer: string,
  digit: string,
  min: number,
  max: number,
): { value: number | null; buffer: string; advance: boolean } {
  let d = Number(digit);
  if (buffer === '') {
    if (d === 0 && min === 0) return { value: 0, buffer: '0', advance: false };
    if (d === 0) return { value: null, buffer: '0', advance: false };
    if (d * 10 > max) {
      return {
        value: Math.min(max, Math.max(min, d)),
        buffer: '',
        advance: true,
      };
    }
    return { value: d, buffer: digit, advance: false };
  }
  let combined = Number(buffer + digit);
  if (combined >= min && combined <= max) {
    return { value: combined, buffer: '', advance: true };
  }
  if (buffer === '0' && d === 0) {
    return { value: min === 0 ? 0 : null, buffer: '0', advance: false };
  }
  return typeDigit('', digit, min, max);
}

export interface TimeInputSignature {
  Args: {
    /** wire value — 'HH:MM', or 'HH:MM:SS' when @withSeconds */
    value?: string;
    defaultValue?: string;
    withSeconds?: boolean;
    /** '24' (default) or '12' — 12 adds the AM/PM segment */
    hourCycle?: TimeInputHourCycle;
    disabled?: boolean;
    /** group label announced by assistive tech — 'Time' default */
    label?: string;
    /**
     * Reference time an EMPTY segment steps from on its first arrow press —
     * same wire shape as @value ('HH:MM' or 'HH:MM:SS'). Realm code may not
     * read the clock, so pass the app's own clock here to get
     * wa-time-input's seed-from-now; omitted, each segment seeds from its
     * minimum (00 / 00 / 00 / AM), which keeps stepping deterministic.
     */
    now?: string;
    /** receives the wire string when complete, '' when incomplete */
    onValueChange?: (value: string) => void;
  };
  Element: HTMLDivElement;
}

export class TimeInput extends Component<TimeInputSignature> {
  // internal segment state — hour always stored in wire (24h) form so a
  // mid-session @hourCycle flip stays coherent
  private seedSegs = parseWire(this.args.value ?? this.args.defaultValue);
  @tracked hh: number | null = this.seedSegs.hh;
  @tracked mm: number | null = this.seedSegs.mm;
  @tracked ss: number | null = this.seedSegs.ss;
  @tracked dp: 0 | 1 | null = this.seedSegs.dp;
  // last wire string this component emitted (or accepted at construction) —
  // while @value echoes it, internal partial edits stay on display; a
  // different external @value wins and repaints the segments
  @tracked emitted: string | undefined = this.args.value;

  // two-digit type-through buffer; plain fields — display rides the
  // tracked segment values, the buffer only shapes the next keystroke
  private buffer = '';
  private bufferField: TimeField | null = null;

  get hourCycle(): TimeInputHourCycle {
    return this.args.hourCycle ?? '24';
  }
  get is12() {
    return this.hourCycle === '12';
  }
  get label() {
    return this.args.label ?? 'Time';
  }
  // NO clock read: the seed is whatever @now the caller handed us, and each
  // segment's minimum otherwise.
  private get seed(): TimeSeed {
    let s = parseWire(this.args.now);
    return { hh: s.hh ?? 0, mm: s.mm ?? 0, ss: s.ss ?? 0, dp: s.dp ?? 0 };
  }
  get effective(): TimeSegs {
    let external = this.args.value;
    if (external !== undefined && external !== this.emitted) {
      return parseWire(external);
    }
    return { hh: this.hh, mm: this.mm, ss: this.ss, dp: this.dp };
  }
  private isComplete(s: TimeSegs) {
    return (
      s.hh !== null &&
      s.mm !== null &&
      (!this.args.withSeconds || s.ss !== null) &&
      (!this.is12 || s.dp !== null)
    );
  }
  get complete() {
    return this.isComplete(this.effective);
  }
  private wireOf(s: TimeSegs): string {
    if (!this.isComplete(s)) return '';
    let base = `${pad2(s.hh as number)}:${pad2(s.mm as number)}`;
    return this.args.withSeconds ? `${base}:${pad2(s.ss ?? 0)}` : base;
  }
  // display hour in the active cycle
  private displayHour(s: TimeSegs): number | null {
    if (s.hh === null) return null;
    return this.is12 ? s.hh % 12 || 12 : s.hh;
  }
  get segmentViews(): TimeSegmentView[] {
    let s = this.effective;
    let views: TimeSegmentView[] = [];
    let dh = this.displayHour(s);
    views.push({
      part: 'hour',
      text: dh === null ? '––' : pad2(dh),
      ariaLabel: 'Hour',
      min: this.is12 ? 1 : 0,
      max: this.is12 ? 12 : 23,
      now: dh ?? undefined,
      valueText: dh === null ? 'Empty' : String(dh),
      empty: dh === null,
      colonAfter: true,
    });
    views.push({
      part: 'minute',
      text: s.mm === null ? '––' : pad2(s.mm),
      ariaLabel: 'Minute',
      min: 0,
      max: 59,
      now: s.mm ?? undefined,
      valueText: s.mm === null ? 'Empty' : String(s.mm),
      empty: s.mm === null,
      colonAfter: Boolean(this.args.withSeconds),
    });
    if (this.args.withSeconds) {
      views.push({
        part: 'second',
        text: s.ss === null ? '––' : pad2(s.ss),
        ariaLabel: 'Second',
        min: 0,
        max: 59,
        now: s.ss ?? undefined,
        valueText: s.ss === null ? 'Empty' : String(s.ss),
        empty: s.ss === null,
        colonAfter: false,
      });
    }
    if (this.is12) {
      views.push({
        part: 'dayPeriod',
        text: s.dp === null ? '––' : s.dp === 0 ? 'AM' : 'PM',
        ariaLabel: 'AM/PM',
        min: 0,
        max: 1,
        now: s.dp ?? undefined,
        valueText: s.dp === null ? 'Empty' : s.dp === 0 ? 'AM' : 'PM',
        empty: s.dp === null,
        colonAfter: false,
      });
    }
    return views;
  }

  private commit(next: TimeSegs) {
    this.hh = next.hh;
    this.mm = next.mm;
    this.ss = next.ss;
    this.dp = next.dp;
    let wire = this.wireOf(next);
    if (wire !== (this.emitted ?? '')) {
      this.emitted = wire;
      this.args.onValueChange?.(wire);
    } else {
      this.emitted = wire;
    }
  }
  private clearBufferState() {
    this.buffer = '';
    this.bufferField = null;
  }
  private focusField(from: EventTarget | null, part: TimeField | undefined) {
    if (!part) return;
    let root = (from as HTMLElement | null)?.closest('.pretui-time');
    root
      ?.querySelector<HTMLElement>(`[data-segment='${part}']`)
      ?.focus();
  }
  private neighborField(part: TimeField, dir: -1 | 1): TimeField | undefined {
    let order: TimeField[] = ['hour', 'minute'];
    if (this.args.withSeconds) order.push('second');
    if (this.is12) order.push('dayPeriod');
    let i = order.indexOf(part) + dir;
    return order[i];
  }
  // WA stepTimeSegment: wrap within bounds, no carry. An empty segment lands
  // on the seed (see @now) rather than stepping off it, so the first press
  // is always a legible jump to a known value.
  private stepField(part: TimeField, delta: -1 | 1) {
    let s = { ...this.effective };
    let seed = this.seed;
    if (part === 'dayPeriod') {
      s.dp = s.dp === null ? seed.dp : s.dp === 0 ? 1 : 0;
      if (s.hh !== null) s.hh = (s.hh % 12) + (s.dp === 1 ? 12 : 0);
      this.commit(s);
      return;
    }
    if (part === 'minute') {
      s.mm = s.mm === null ? seed.mm : (s.mm + 60 + delta) % 60;
    } else if (part === 'second') {
      s.ss = s.ss === null ? seed.ss : (s.ss + 60 + delta) % 60;
    } else if (this.is12) {
      let dh = this.displayHour(s);
      let nextDh =
        dh === null ? seed.hh % 12 || 12 : ((dh - 1 + 12 + delta) % 12) + 1;
      let pm = s.dp === 1 || (s.dp === null && s.hh !== null && s.hh >= 12);
      s.hh = (nextDh % 12) + (pm ? 12 : 0);
    } else {
      s.hh = s.hh === null ? seed.hh : (s.hh + 24 + delta) % 24;
    }
    this.commit(s);
  }
  // ARIA spinbutton pattern: Home/End jump to the segment's bounds. WA ships
  // neither — this is the keyboard path its time field is missing.
  private extremeField(part: TimeField, which: 'min' | 'max') {
    let s = { ...this.effective };
    if (part === 'dayPeriod') {
      s.dp = which === 'min' ? 0 : 1;
      if (s.hh !== null) s.hh = (s.hh % 12) + (s.dp === 1 ? 12 : 0);
    } else if (part === 'minute') {
      s.mm = which === 'min' ? 0 : 59;
    } else if (part === 'second') {
      s.ss = which === 'min' ? 0 : 59;
    } else if (this.is12) {
      s = this.setDisplayHour(which === 'min' ? 1 : 12, s);
    } else {
      s.hh = which === 'min' ? 0 : 23;
    }
    this.commit(s);
  }
  private setDisplayHour(dh: number, s: TimeSegs): TimeSegs {
    if (!this.is12) return { ...s, hh: dh };
    let pm = s.dp === 1;
    return { ...s, hh: (dh % 12) + (pm ? 12 : 0) };
  }

  handleSegmentKeyDown = (part: TimeField, ev: Event) => {
    if (this.args.disabled) return;
    let e = ev as KeyboardEvent;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.clearBufferState();
      this.stepField(part, e.key === 'ArrowUp' ? 1 : -1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      this.clearBufferState();
      this.focusField(e.target, this.neighborField(part, e.key === 'ArrowLeft' ? -1 : 1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      this.clearBufferState();
      this.extremeField(part, e.key === 'Home' ? 'min' : 'max');
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      this.clearBufferState();
      let s = { ...this.effective };
      if (part === 'hour') s.hh = null;
      else if (part === 'minute') s.mm = null;
      else if (part === 'second') s.ss = null;
      else s.dp = null;
      this.commit(s);
    } else if (part === 'dayPeriod' && /^[apAP]$/.test(e.key)) {
      e.preventDefault();
      let s = { ...this.effective };
      s.dp = e.key === 'a' || e.key === 'A' ? 0 : 1;
      if (s.hh !== null) s.hh = (s.hh % 12) + (s.dp === 1 ? 12 : 0);
      this.commit(s);
    } else if (/^[0-9]$/.test(e.key) && part !== 'dayPeriod') {
      e.preventDefault();
      if (this.bufferField !== part) this.clearBufferState();
      let s = { ...this.effective };
      let bounds =
        part === 'hour'
          ? this.is12
            ? { min: 1, max: 12 }
            : { min: 0, max: 23 }
          : { min: 0, max: 59 };
      let r = typeDigit(this.buffer, e.key, bounds.min, bounds.max);
      this.buffer = r.buffer;
      this.bufferField = r.buffer ? part : null;
      if (part === 'hour') {
        s = r.value === null ? { ...s, hh: null } : this.setDisplayHour(r.value, s);
      } else if (part === 'minute') {
        s.mm = r.value;
      } else {
        s.ss = r.value;
      }
      this.commit(s);
      if (r.advance) {
        this.focusField(e.target, this.neighborField(part, 1));
      }
    }
  };
  handleSegmentBlur = (_ev: Event) => {
    this.clearBufferState();
  };

  <template>
    <div
      class='pretui-time'
      role='group'
      aria-label={{this.label}}
      data-complete={{if this.complete 'true'}}
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-time-input
      ...attributes
    >
      {{#each this.segmentViews as |seg|}}
        <div
          class='pretui-time-seg'
          role='spinbutton'
          tabindex={{if @disabled '-1' '0'}}
          aria-label={{seg.ariaLabel}}
          aria-valuemin={{seg.min}}
          aria-valuemax={{seg.max}}
          aria-valuenow={{seg.now}}
          aria-valuetext={{seg.valueText}}
          aria-disabled={{if @disabled 'true'}}
          data-segment={{seg.part}}
          data-empty={{if seg.empty 'true'}}
          {{on 'keydown' (fn this.handleSegmentKeyDown seg.part)}}
          {{on 'blur' this.handleSegmentBlur}}
        >{{seg.text}}</div>
        {{#if seg.colonAfter}}
          <span class='pretui-time-literal' aria-hidden='true'>:</span>
        {{/if}}
      {{/each}}
    </div>
    <style scoped>
      /* the whole group wears the Pretui Input dress; segments live inside
         one field face and take the focus treatment individually */
      .pretui-time {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        height: var(--control-h, 28px);
        padding: 0 7px;
        border-radius: var(--radius);
        background: var(--field, var(--boxel-light));
        box-shadow: 0 0 0 1px var(--input);
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
      }
      .pretui-time[data-disabled] {
        opacity: 0.45;
      }
      .pretui-time-seg {
        padding: 1px 3px;
        border-radius: 5px;
        cursor: default;
        user-select: none;
      }
      .pretui-time-seg[data-empty] {
        color: var(--ink-3, var(--boxel-400));
      }
      /* segments take the native date/time-field treatment — the focused
         segment is HIGHLIGHTED rather than ringed, because a ring inside a
         one-field face reads as a second field. The transparent outline is
         inert normally and becomes the visible indicator under
         forced-colors, where a background swap is discarded. */
      .pretui-time-seg:focus-visible {
        outline: 2px solid transparent;
        outline-offset: -1px;
        background: var(--ring);
        color: var(--primary-foreground);
      }
      .pretui-time-seg[data-segment='dayPeriod'] {
        margin-left: 4px;
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
      }
      .pretui-time-literal {
        color: var(--ink-3, var(--boxel-400));
      }
    </style>
  </template>
}
