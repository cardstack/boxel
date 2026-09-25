// Pretui — controls territory, form-composites wave: segmented entry
// (OtpInput, TimeInput), progress structure (StepList), and grouping
// chrome (ButtonGroup, Divider). Semantics transcribed — not copied — from
// Web Awesome's wa-otp-input / wa-time-input / wa-button-group / wa-divider
// (MIT, (c) Fonticons) and React Spectrum's StepList (Apache-2.0, (c)
// Adobe), re-cut on the kit's own bones: Pretui tokens + light fallbacks,
// the value?/defaultValue?/onValueChange? contract, data-test-pretui-* +
// data-* state reflection, and no document-level listeners anywhere.
// Wave-0 adaptations are documented per component.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { guidFor } from '@ember/object/internals';
import type { PretuiAppearance, PretuiSize, PretuiTone } from '../pretui-primitives';

// ── OtpInput ─────────────────────────────────────────────────────────────
// Transcribed from wa-otp-input: one-time passcodes, PINs, and other
// fixed-length codes, one character per segment — auto-advance on entry,
// Backspace splices and steps back, paste distributes across segments,
// masked entry for sensitive codes. WA renders ONE hidden input with a
// synthetic caret over CSS segments; this cut re-bases on N real single-char
// inputs dressed like the Pretui Input (field face, hairline, focus ring),
// which keeps focus handling native and needs no document listeners.
// Kept from WA: dense value model (splices shift, no holes), character-class
// filter (@type numeric/alpha/alphanumeric), overlay paste from the active
// segment, arrow-key movement, autocomplete='one-time-code'.
// Dropped (wave-0, documented): format strings with literal separators,
// form association + autosubmit, case transform, with-mask hint glyphs,
// readonly, and the wa-complete/wa-clear events (watch for
// value.length === @length in @onValueChange instead).
// A11y per Spectrum's segmented-input notes: role='group' with a group
// label, plus a per-digit label ('Digit N of L') on every segment.
// Review pass 2026-08-12 fixed: Backspace on the empty fill-edge segment now
// splices the previous character (it took two presses); Home/End reach the
// first/last segment; the focus ring rides --ring (it hard-coded --primary,
// so the theme's ring knob was ignored) and carries a transparent outline so
// it survives forced-colors; and completion is no longer conveyed by ring
// colour alone — a polite live region says so.

export type OtpInputType = 'numeric' | 'alpha' | 'alphanumeric';

export interface OtpInputSignature {
  Args: {
    /** number of character segments — 6 by default */
    length?: number;
    value?: string;
    defaultValue?: string;
    /** allowed character class — 'numeric' by default (WA semantic) */
    type?: OtpInputType;
    /** render entered characters as password dots */
    masked?: boolean;
    disabled?: boolean;
    /** group label announced by assistive tech — 'One-time code' default */
    label?: string;
    /** receives the joined string (dense — no holes) on every edit */
    onValueChange?: (value: string) => void;
  };
  Element: HTMLDivElement;
}

interface OtpSegment {
  index: number;
  char: string;
  ariaLabel: string;
  first: boolean;
}

export class OtpInput extends Component<OtpInputSignature> {
  @tracked internal = this.args.defaultValue ?? '';

  get length() {
    return this.args.length ?? 6;
  }
  get type(): OtpInputType {
    return this.args.type ?? 'numeric';
  }
  get current() {
    return this.filter(this.args.value ?? this.internal).slice(0, this.length);
  }
  get complete() {
    return this.current.length === this.length;
  }
  get label() {
    return this.args.label ?? 'One-time code';
  }
  get inputType() {
    return this.args.masked ? 'password' : 'text';
  }
  get inputMode() {
    return this.type === 'numeric' ? 'numeric' : 'text';
  }
  // Law 6 / a11y: `data-complete` paints a success-tinted ring, which is
  // information carried by colour alone. The polite live region is the text
  // affordance beside it — it says the word once the last slot lands.
  get statusText() {
    return this.complete ? `${this.label} complete` : '';
  }
  get segments(): OtpSegment[] {
    let value = this.current;
    return Array.from({ length: this.length }, (_v, i) => ({
      index: i,
      char: value[i] ?? '',
      ariaLabel: `Digit ${i + 1} of ${this.length}`,
      first: i === 0,
    }));
  }

  private filter(raw: string): string {
    if (this.type === 'numeric') return raw.replace(/\D/g, '');
    if (this.type === 'alpha') return raw.replace(/[^a-zA-Z]/g, '');
    return raw.replace(/[^a-zA-Z0-9]/g, '');
  }
  // Overlay-write `chars` starting at `pos` (clamped to the fill edge so a
  // click past the value appends instead of leaving a hole) — WA's paste
  // overlay generalized to every write path.
  private writeAt(pos: number, chars: string): { next: string; caret: number } {
    let cur = this.current;
    let p = Math.min(pos, cur.length);
    let slots = cur.split('');
    for (let i = 0; i < chars.length && p + i < this.length; i++) {
      slots[p + i] = chars[i] as string;
    }
    return {
      next: slots.join('').slice(0, this.length),
      caret: Math.min(p + chars.length, this.length - 1),
    };
  }
  private commit(next: string) {
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.args.onValueChange?.(next);
  }
  private focusSegment(from: EventTarget | null, index: number) {
    let root = (from as HTMLElement | null)?.closest('.pretui-otp');
    let seg = root?.querySelectorAll<HTMLInputElement>('.pretui-otp-seg')[index];
    seg?.focus();
  }

  handleFocus = (ev: Event) => {
    // Select the segment's character so typing replaces it (WA caret model).
    (ev.target as HTMLInputElement).select();
  };
  handleInput = (index: number, ev: Event) => {
    let input = ev.target as HTMLInputElement;
    let filtered = this.filter(input.value);
    if (!filtered) {
      // Rejected character (or native clear) — restore the slot's display.
      input.value = this.current[index] ?? '';
      return;
    }
    // A multi-char burst (browser OTP autofill into the first input)
    // distributes like a paste; a single keystroke writes one slot.
    let chars = filtered.length > 1 ? filtered : filtered.slice(-1);
    let { next, caret } = this.writeAt(index, chars);
    this.commit(next);
    input.value = next[index] ?? '';
    this.focusSegment(input, caret);
  };
  handleKeyDown = (index: number, ev: Event) => {
    let e = ev as KeyboardEvent;
    let cur = this.current;
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (index < cur.length) {
        // filled slot — splice it out, caret walks back
        this.commit(cur.slice(0, index) + cur.slice(index + 1));
        this.focusSegment(e.target, Math.max(index - 1, 0));
      } else if (index > 0) {
        // empty slot at the fill edge — Backspace eats the character
        // BEFORE the caret (one press, not two)
        this.commit(cur.slice(0, index - 1) + cur.slice(index));
        this.focusSegment(e.target, index - 1);
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      if (index < cur.length) {
        this.commit(cur.slice(0, index) + cur.slice(index + 1));
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.focusSegment(e.target, Math.max(index - 1, 0));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.focusSegment(e.target, Math.min(index + 1, this.length - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      this.focusSegment(e.target, 0);
    } else if (e.key === 'End') {
      // the fill edge, not the last slot — where the next character lands
      e.preventDefault();
      this.focusSegment(e.target, Math.min(cur.length, this.length - 1));
    }
  };
  handlePaste = (index: number, ev: Event) => {
    let e = ev as ClipboardEvent;
    e.preventDefault();
    let filtered = this.filter(e.clipboardData?.getData('text/plain') ?? '');
    if (!filtered) return;
    let { next, caret } = this.writeAt(index, filtered);
    this.commit(next);
    let input = e.target as HTMLInputElement;
    input.value = next[index] ?? '';
    this.focusSegment(input, caret);
  };

  <template>
    <div
      class='pretui-otp'
      role='group'
      aria-label={{this.label}}
      data-complete={{if this.complete 'true'}}
      data-masked={{if @masked 'true'}}
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-otp-input
      ...attributes
    >
      {{#each this.segments as |s|}}
        <input
          class='pretui-otp-seg'
          type={{this.inputType}}
          inputmode={{this.inputMode}}
          maxlength='1'
          autocomplete={{if s.first 'one-time-code' 'off'}}
          autocapitalize='none'
          autocorrect='off'
          spellcheck='false'
          aria-label={{s.ariaLabel}}
          value={{s.char}}
          disabled={{@disabled}}
          {{on 'focus' this.handleFocus}}
          {{on 'input' (fn this.handleInput s.index)}}
          {{on 'keydown' (fn this.handleKeyDown s.index)}}
          {{on 'paste' (fn this.handlePaste s.index)}}
        />
      {{/each}}
      <span class='pretui-vh' role='status'>{{this.statusText}}</span>
    </div>
    <style scoped>
      .pretui-otp {
        display: inline-flex;
        gap: var(--pretui-otp-gap, 6px);
      }
      /* each segment wears the Pretui Input dress: field face, hairline on
         box-shadow, r(--radius), primary focus ring */
      .pretui-otp-seg {
        width: var(--pretui-otp-size, var(--control-h, 28px));
        height: var(--pretui-otp-size, var(--control-h, 28px));
        padding: 0;
        border: 0;
        border-radius: var(--radius);
        text-align: center;
        font-family: inherit;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
        background: var(--field, var(--boxel-light));
        box-shadow: 0 0 0 1px var(--input);
        caret-color: transparent;
      }
      /* the ring rides --ring (falling back to --primary) so the theme's own
         focus knob lands; the transparent outline is inert in normal render
         and becomes THE focus indicator under forced-colors, where a
         box-shadow ring is simply dropped */
      .pretui-otp-seg:focus-visible {
        outline: 2px solid transparent;
        outline-offset: 1px;
        box-shadow: 0 0 0 2px var(--ring),
          var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.16));
      }
      .pretui-otp-seg::selection {
        background: color-mix(in oklch, var(--ring) 25%, transparent);
      }
      .pretui-otp-seg:disabled {
        opacity: 0.45;
      }
      .pretui-otp[data-complete] .pretui-otp-seg {
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--success, var(--boxel-success)) 55%, var(--input));
      }
      .pretui-otp[data-complete] .pretui-otp-seg:focus-visible {
        box-shadow: 0 0 0 2px var(--ring),
          var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.16));
      }
      .pretui-vh {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
    </style>
  </template>
}

// ── TimeInput ────────────────────────────────────────────────────────────
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

// ── StepList ─────────────────────────────────────────────────────────────
// Transcribed from React Spectrum's StepList structure — ordered list,
// numbered markers, aria-current='step' on the active item, visually
// hidden state text per step — re-cut as a PRESENTATIONAL progress rail
// (Spectrum's is selectable navigation; wave-0 drops the link/keyboard
// machinery and renders state only, so there is nothing to mis-click).
// Adds an 'error' state Spectrum doesn't ship (tone: --destructive).
// Per-state treatment flows through one --pretui-step-tone custom prop
// per state.
// Review pass 2026-08-12: the <ol> carries an explicit role='list' because
// `list-style: none` strips list semantics in WebKit; and each state's four
// internals now read a --pretui-step-<state>-* knob first, so a consumer can
// re-tone a state from any ancestor (they were previously literal values on
// the element itself, i.e. unreachable from outside).
//
// Review pass 2026-08-13 — @variant='track' + @summary. The provenance
// panel on the Pretui component pages used to hand-roll its own five-stage
// rail (.wb-pipe/.wb-pstep/.wb-pbar/.wb-pcap) with three defects this
// component now absorbs, rather than a cousin component repeating them:
//   1. it painted the LAST bar with the accent purely because it was last,
//      so the accent read as information and encoded nothing. Here the
//      accent is a state channel only — 'current' speaks --primary,
//      'complete' speaks --success, 'error' speaks --destructive, and a
//      run of five complete stages is five identical bars.
//   2. its steps were div/span with a data-on attribute: no list
//      semantics, no state text, completion by colour alone (WCAG 1.4.1).
//      The track variant inherits the <ol>/<li>, the per-step visually
//      hidden state text, and adds the check glyph as a second, non-colour
//      visual channel.
//   3. its '5 / 5 complete' count was a floating <span> in the panel
//      header with no relationship to the rail. @summary renders that
//      count from the step states and ties it to the list with
//      aria-describedby, so it is announced when the list is entered.
// Also new: the root is now a wrapper div declaring container-type:
// inline-size, which buys the component the responsive behaviour BOTH
// presentations were missing — the steps rail stacked its nowrap labels
// into a column, the track rail folds into a legend list — measured
// against the component's own box, never the viewport. Spectrum's
// orientation prop is viewport-blind and leaves this to the caller.
// Element changed HTMLOListElement -> HTMLDivElement in that pass;
// data-test-pretui-step-list rides the root, the <ol> carries
// data-test-pretui-step-list-items.

// Review pass 2026-08-13 (boxel-catalog E6) — two states and a detail line.
// `complete | current | upcoming | error` describes where you ARE. It cannot
// say that a stage is running right now, and it cannot say that a stage
// cannot proceed and why — the two things a reader of a deploy pipeline, a
// KYC flow, an order or an approval chain actually wants. So:
//   · 'in-progress' — running now. Distinct from 'current' on purpose:
//     'current' is "you are here", 'in-progress' is "the machine is working".
//     A wizard has a current step and no in-progress step; a pipeline has
//     both, and they are usually not the same step.
//   · 'blocked' — cannot proceed. Distinct from 'error': an error happened,
//     a block is a precondition that has not been met.
//   · `detail` — a per-step sub-line ("Re-running lint…", "3 unfixable lint
//     errors"). This is the difference between a list that shows where you
//     are and one that shows why you are stuck.
// Every state keeps a glyph as well as a tone, so the five-way distinction
// survives greyscale, and a polite live region announces the active step's
// state and detail when either changes.
export type StepState =
  | 'complete'
  | 'current'
  | 'in-progress'
  | 'blocked'
  | 'upcoming'
  | 'error';
export type StepListVariant = 'steps' | 'track';

export interface StepItem {
  label: string;
  /** explicit state — wins over the @current-index derivation */
  state?: StepState;
  /**
   * One line of detail under the label — what is happening, or why this
   * stage cannot proceed. Never a substitute for the state: a blocked step
   * is blocked whether or not it explains itself.
   */
  detail?: string;
}

export interface StepListSignature {
  Args: {
    /** the ordered stages — one <li> each, in the order given */
    steps: StepItem[];
    /** index of the current step — derives complete/current/upcoming for
        steps without an explicit state */
    current?: number;
    /** list label announced by assistive tech — 'Steps' default */
    label?: string;
    /**
     * Presentation. 'steps' (default) is the numbered-marker rail with
     * connector lines between items. 'track' is the segmented bar rail —
     * one filled bar per stage with its caption beneath — for a pipeline
     * read at a glance rather than walked through. Same markup, same
     * semantics, same state palette; only the arrangement differs.
     */
    variant?: StepListVariant;
    /**
     * Render the completion summary above the rail ('3 of 5 complete').
     * It is derived from the step states and wired to the list with
     * aria-describedby — never a decorative count the caller has to keep
     * in sync. Off by default.
     */
    summary?: boolean;
    /** wording for that summary — receives (completed, total) */
    summaryFormat?: (done: number, total: number) => string;
    /**
     * Announce the active step's state and detail through a polite live
     * region when either changes. On by default: a rail whose stage flips
     * from running to blocked while nobody is looking at it has told a
     * sighted reader something and told everyone else nothing. Live regions
     * do not announce their initial content, so this is silent on mount.
     */
    announce?: boolean;
  };
  Element: HTMLDivElement;
}

interface StepView {
  label: string;
  state: StepState;
  detail?: string;
  number: number;
  stateText: string;
  last: boolean;
  connector: boolean;
  isCurrent: boolean;
  isComplete: boolean;
  isError: boolean;
  isBlocked: boolean;
  isRunning: boolean;
  isPending: boolean;
}

const STEP_STATE_TEXT: Record<StepState, string> = {
  complete: 'Completed',
  current: 'Current',
  'in-progress': 'In progress',
  blocked: 'Blocked',
  upcoming: 'Not completed',
  error: 'Error',
};

// Which step the live region speaks for, most urgent first. A blocked or
// failed stage outranks the one that merely happens to be running.
const STEP_ANNOUNCE_ORDER: StepState[] = [
  'error',
  'blocked',
  'in-progress',
  'current',
];

const defaultStepSummary = (done: number, total: number) =>
  `${done} of ${total} complete`;

export class StepList extends Component<StepListSignature> {
  // stable per-instance id so the summary can be referenced by the list
  // without the caller having to invent one
  private summaryId = `${guidFor(this)}-summary`;
  get label() {
    return this.args.label ?? 'Steps';
  }
  get variant(): StepListVariant {
    return this.args.variant ?? 'steps';
  }
  get isTrack() {
    return this.variant === 'track';
  }
  get showSummary() {
    return this.args.summary ?? false;
  }
  get summaryText() {
    let format = this.args.summaryFormat ?? defaultStepSummary;
    let views = this.views;
    return format(views.filter((v) => v.isComplete).length, views.length);
  }
  get views(): StepView[] {
    let current = this.args.current ?? -1;
    let steps = this.args.steps;
    let track = this.isTrack;
    return steps.map((step, i) => {
      let state: StepState =
        step.state ??
        (i < current ? 'complete' : i === current ? 'current' : 'upcoming');
      let last = i === steps.length - 1;
      return {
        label: step.label,
        state,
        detail: step.detail,
        number: i + 1,
        stateText: STEP_STATE_TEXT[state],
        last,
        // the track variant reads its progress off the bars; a connector
        // between them would be a second, redundant progress channel
        connector: !last && !track,
        isCurrent: state === 'current',
        isComplete: state === 'complete',
        isError: state === 'error',
        isBlocked: state === 'blocked',
        isRunning: state === 'in-progress',
        isPending: state === 'upcoming',
      };
    });
  }
  /** Reserve the detail slot on every step as soon as one step declares a
   * detail, so a line arriving late does not re-flow the rail (Appendix O:
   * a value that arrives late reserves its space). */
  get reserveDetail() {
    return this.args.steps.some((s) => s.detail !== undefined);
  }
  get announce() {
    return this.args.announce ?? true;
  }
  get liveText() {
    if (!this.announce) return undefined;
    let views = this.views;
    for (let state of STEP_ANNOUNCE_ORDER) {
      let hit = views.find((v) => v.state === state);
      if (hit) {
        return hit.detail
          ? `${hit.label}: ${hit.stateText}. ${hit.detail}`
          : `${hit.label}: ${hit.stateText}`;
      }
    }
    return undefined;
  }
  <template>
    <div class='pretui-steplist-wrap' data-test-pretui-step-list ...attributes>
      {{#if this.showSummary}}
        <p
          class='pretui-steplist-summary'
          id={{this.summaryId}}
          data-test-pretui-step-list-summary
        >{{this.summaryText}}</p>
      {{/if}}
      <ol
        class='pretui-steplist'
        role='list'
        data-variant={{this.variant}}
        aria-label={{this.label}}
        aria-describedby={{if this.showSummary this.summaryId}}
        data-test-pretui-step-list-items
      >
        {{#each this.views as |step|}}
          <li
            class='pretui-step'
            data-state={{step.state}}
            aria-current={{if step.isCurrent 'step'}}
          >
            {{#if this.isTrack}}
              <span class='pretui-step-bar' aria-hidden='true'></span>
            {{/if}}
            <span class='pretui-step-marker' aria-hidden='true'>
              {{#if step.isComplete}}
                <svg width='9' height='9' viewBox='0 0 10 10'><path
                    d='M1.5 5.5 4 8l4.5-6'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='1.6'
                    stroke-linecap='round'
                    stroke-linejoin='round'
                  /></svg>
              {{else if step.isError}}
                <svg width='9' height='9' viewBox='0 0 10 10'><path
                    d='M5 1.5v4.5M5 8.4v.1'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='1.6'
                    stroke-linecap='round'
                  /></svg>
              {{else if step.isBlocked}}
                {{!-- a bar across the marker — "the way through is shut", and
                    unmistakably not the error exclamation beside it --}}
                <svg width='9' height='9' viewBox='0 0 10 10'><path
                    d='M1.6 5h6.8'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='1.8'
                    stroke-linecap='round'
                  /></svg>
              {{else if step.isRunning}}
                {{!-- a play triangle — "the machine is working on this one".
                    Static on purpose: a spinning marker would be motion that
                    encodes nothing the tone and the state text do not --}}
                <svg width='9' height='9' viewBox='0 0 10 10'><path
                    d='M3.2 2.1 7.6 5 3.2 7.9Z'
                    fill='currentColor'
                  /></svg>
              {{else}}
                {{step.number}}
              {{/if}}
            </span>
            <span class='pretui-step-label'>
              <span class='pretui-step-name'>{{step.label}}</span>
              <span class='pretui-vh'>{{step.stateText}}</span>
              {{#if this.reserveDetail}}
                <span
                  class='pretui-step-detail'
                  data-test-pretui-step-detail
                >{{step.detail}}</span>
              {{/if}}
            </span>
            {{#if step.connector}}
              <span class='pretui-step-connector' aria-hidden='true'></span>
            {{/if}}
          </li>
        {{/each}}
      </ol>
      {{#if this.liveText}}
        <span
          class='pretui-vh'
          role='status'
          data-test-pretui-step-list-live
        >{{this.liveText}}</span>
      {{/if}}
    </div>
    <style scoped>
      /* the root is the query container for both presentations — unnamed,
         so the rules below resolve against THIS box and not the viewport */
      .pretui-steplist-wrap {
        container-type: inline-size;
        display: grid;
        gap: var(--pretui-step-summary-gap, 7px);
        min-width: 0;
      }
      .pretui-steplist-summary {
        justify-self: end;
        margin: 0;
        font-size: var(--text-ui, 12px);
        font-variant-numeric: tabular-nums;
        color: var(--pretui-step-summary-color, var(--muted-foreground));
      }
      .pretui-steplist {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
        min-width: 0;
      }
      .pretui-step {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: var(--text-ui, 12px);
        font-weight: 500;
        letter-spacing: var(--track-ui, 0.01em);
      }
      .pretui-step:not(:last-child) {
        flex: 1;
      }
      /* per-state treatment: each state only re-points the tone props, and
         each of those reads a per-state consumer knob first — set
         --pretui-step-error-marker-bg (etc.) on any ancestor to re-tone one
         state without touching the rest */
      .pretui-step[data-state='upcoming'] {
        --pretui-step-tone: var(--pretui-step-upcoming-tone, var(--muted-foreground));
        --pretui-step-marker-bg: var(--pretui-step-upcoming-marker-bg, var(--inset, var(--boxel-100)));
        --pretui-step-marker-fg: var(--pretui-step-upcoming-marker-fg, var(--muted-foreground));
        --pretui-step-ring: var(--pretui-step-upcoming-ring, var(--border));
        --pretui-step-bar-fill: var(--pretui-step-upcoming-bar, var(--border));
      }
      .pretui-step[data-state='current'] {
        --pretui-step-tone: var(--pretui-step-current-tone, var(--foreground));
        --pretui-step-marker-bg: var(--pretui-step-current-marker-bg, var(--primary));
        --pretui-step-marker-fg: var(--pretui-step-current-marker-fg, var(--primary-foreground));
        --pretui-step-ring: var(--pretui-step-current-ring, color-mix(in oklch, var(--primary) 70%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-current-bar, var(--primary));
      }
      .pretui-step[data-state='complete'] {
        --pretui-step-tone: var(--pretui-step-complete-tone, var(--muted-foreground));
        --pretui-step-marker-bg: var(--pretui-step-complete-marker-bg, color-mix(in oklch, var(--success, var(--boxel-success)) 15%, var(--card)));
        --pretui-step-marker-fg: var(--pretui-step-complete-marker-fg, var(--success, var(--boxel-success)));
        --pretui-step-ring: var(--pretui-step-complete-ring, color-mix(in oklch, var(--success, var(--boxel-success)) 40%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-complete-bar, var(--success, var(--boxel-success)));
      }
      .pretui-step[data-state='error'] {
        --pretui-step-tone: var(--pretui-step-error-tone, var(--destructive));
        --pretui-step-marker-bg: var(--pretui-step-error-marker-bg, color-mix(in oklch, var(--destructive) 12%, var(--card)));
        --pretui-step-marker-fg: var(--pretui-step-error-marker-fg, var(--destructive));
        --pretui-step-ring: var(--pretui-step-error-ring, color-mix(in oklch, var(--destructive) 45%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-error-bar, var(--destructive));
      }
      /* running now: the primary hue filled solid, like 'current', but the
         glyph is a play triangle rather than a number so the two never read
         the same at a glance */
      .pretui-step[data-state='in-progress'] {
        --pretui-step-tone: var(--pretui-step-in-progress-tone, var(--foreground));
        --pretui-step-marker-bg: var(--pretui-step-in-progress-marker-bg, color-mix(in oklch, var(--pretui-info, var(--primary)) 16%, var(--card)));
        --pretui-step-marker-fg: var(--pretui-step-in-progress-marker-fg, var(--pretui-info, var(--primary)));
        --pretui-step-ring: var(--pretui-step-in-progress-ring, color-mix(in oklch, var(--pretui-info, var(--primary)) 55%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-in-progress-bar, var(--pretui-info, var(--primary)));
      }
      /* cannot proceed: warning tone, not destructive — nothing has failed */
      .pretui-step[data-state='blocked'] {
        --pretui-step-tone: var(--pretui-step-blocked-tone, var(--foreground));
        --pretui-step-marker-bg: var(--pretui-step-blocked-marker-bg, color-mix(in oklch, var(--warning, var(--boxel-warning)) 14%, var(--card)));
        --pretui-step-marker-fg: var(--pretui-step-blocked-marker-fg, var(--warning, var(--boxel-warning)));
        --pretui-step-ring: var(--pretui-step-blocked-ring, color-mix(in oklch, var(--warning, var(--boxel-warning)) 50%, var(--border)));
        --pretui-step-bar-fill: var(--pretui-step-blocked-bar, var(--warning, var(--boxel-warning)));
      }
      .pretui-step-marker {
        display: inline-grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        flex: none;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        background: var(--pretui-step-marker-bg);
        color: var(--pretui-step-marker-fg);
        box-shadow: 0 0 0 1px var(--pretui-step-ring);
      }
      .pretui-step-label {
        position: relative; /* containing block for the sr-only state text */
        display: grid;
        min-width: 0;
        color: var(--pretui-step-tone);
      }
      .pretui-step-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The detail slot is rendered on every step as soon as ONE step
         declares a detail, and reserves a line's height, so a message
         arriving mid-run does not shove the whole rail down. */
      .pretui-step-detail {
        min-height: 1.35em;
        font-size: var(--text-ui-xs, 11px);
        font-weight: 400;
        white-space: normal;
        overflow-wrap: break-word;
        color: var(--pretui-step-detail-color, var(--muted-foreground));
      }
      .pretui-step[data-state='blocked'] .pretui-step-detail,
      .pretui-step[data-state='error'] .pretui-step-detail {
        color: var(--pretui-step-marker-fg);
      }
      .pretui-step-connector {
        flex: 1;
        min-width: 12px;
        height: 1px;
        background: var(--border);
      }
      .pretui-step[data-state='complete'] .pretui-step-connector {
        background: color-mix(in oklch, var(--success, var(--boxel-success)) 45%, var(--border));
      }
      /* ── track variant ── equal-width bars, caption beneath each. The
         caption keeps the marker glyph, so 'complete' is carried by shape
         (✓) and by the visually hidden state text, not by the bar fill
         alone. */
      .pretui-steplist[data-variant='track'] {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        align-items: start;
        gap: var(--pretui-step-track-gap, 4px);
      }
      .pretui-steplist[data-variant='track'] .pretui-step {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-areas:
          'bar bar'
          'marker label';
        align-items: center;
        gap: 7px 5px;
      }
      .pretui-steplist[data-variant='track'] .pretui-step-bar {
        grid-area: bar;
        height: var(--pretui-step-bar-height, 3px);
        border-radius: 2px;
        background: var(--pretui-step-bar-fill);
      }
      .pretui-steplist[data-variant='track'] .pretui-step-marker {
        grid-area: marker;
        width: auto;
        height: auto;
        min-width: 9px;
        border-radius: 0;
        background: none;
        box-shadow: none;
        font-size: var(--text-ui-xs, 11px);
      }
      .pretui-steplist[data-variant='track'] .pretui-step-label {
        grid-area: label;
      }
      .pretui-steplist[data-variant='track'] .pretui-step-name {
        white-space: normal;
        overflow: visible;
        overflow-wrap: break-word;
      }
      /* ── narrow container: the steps rail stacks. Its labels are nowrap
         and its connectors want horizontal slack, so below this width the
         row becomes a column rather than clipping. */
      @container (max-width: 26rem) {
        .pretui-steplist[data-variant='steps'] {
          flex-direction: column;
          align-items: stretch;
          gap: 7px;
        }
        .pretui-steplist[data-variant='steps'] .pretui-step {
          flex: none;
        }
        .pretui-steplist[data-variant='steps'] .pretui-step-connector {
          display: none;
        }
        .pretui-steplist[data-variant='steps'] .pretui-step-name {
          white-space: normal;
          overflow: visible;
        }
      }
      /* ── narrow container: five captions no longer sit side by side, so
         the track folds into a legend list — one stage per row, each
         keeping its own bar as a leading dash. */
      @container (max-width: 24rem) {
        .pretui-steplist[data-variant='track'] {
          grid-auto-flow: row;
          grid-auto-columns: auto;
          gap: 6px;
        }
        .pretui-steplist[data-variant='track'] .pretui-step {
          grid-template-columns: 14px auto minmax(0, 1fr);
          grid-template-areas: 'bar marker label';
          gap: 7px;
        }
      }
      .pretui-vh {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
    </style>
  </template>
}

// ── ButtonGroup ──────────────────────────────────────────────────────────
// Transcribed from wa-button-group: related Pretui Buttons fused into one
// visual unit — role='group' with a strongly-recommended label, horizontal
// or vertical orientation, inner corners squared and adjacent hairlines
// collapsed to one (the -1px overlap; hover/focus raise z-index so the
// full ring of the active button always draws on top, WA's stacking rule).
// Children are plain <Button>s and need NO args: the group's @tone rides
// the same custom-prop channel Button's recipes already read (each rule
// re-points --pretui-tone/--pretui-tone-on; the neutral-only vars reset to
// `initial` so recipe fallbacks re-engage), while @appearance restates the
// five recipe declarations at group specificity — appearance recipes are
// attribute-selected in Button, so they cannot travel as inherited props;
// the formulas are copied verbatim from controls.gts and read the same
// tone vars. Dropped (wave-0): WA's slotted radio-button support and its
// focus/hover class relay (CSS handles both here).

export interface ButtonGroupSignature {
  Args: {
    /** group label for assistive tech — strongly recommended (WA note) */
    label?: string;
    orientation?: 'horizontal' | 'vertical';
    /** tone inherited by every child Button via the custom-prop channel */
    tone?: PretuiTone;
    /** appearance recipe applied to every child Button */
    appearance?: PretuiAppearance;
    /** size (font-size scale) applied to every child Button */
    size?: PretuiSize;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export class ButtonGroup extends Component<ButtonGroupSignature> {
  get orientation() {
    return this.args.orientation ?? 'horizontal';
  }
  <template>
    {{! template-lint-disable no-unsupported-role-attributes }}
    <div
      class='pretui-btngroup'
      role='group'
      aria-label={{@label}}
      aria-orientation={{this.orientation}}
      data-orientation={{this.orientation}}
      data-tone={{@tone}}
      data-appearance={{@appearance}}
      data-size={{@size}}
      data-test-pretui-button-group
      ...attributes
    >
      {{yield}}
    </div>
    <style scoped>
      .pretui-btngroup {
        display: inline-flex;
        position: relative;
        isolation: isolate;
      }
      .pretui-btngroup[data-orientation='vertical'] {
        flex-direction: column;
        align-items: stretch;
      }
      .pretui-btngroup :deep(.pretui-btn) {
        position: relative;
      }
      /* hover / focus / active ring draws on top of the shared hairline */
      .pretui-btngroup :deep(.pretui-btn:hover) {
        z-index: 1;
      }
      .pretui-btngroup :deep(.pretui-btn:focus-visible) {
        z-index: 2;
      }
      /* attach: square the inner corners, overlap the hairlines by 1px so
         adjacent rings collapse into one shared line */
      .pretui-btngroup[data-orientation='horizontal'] :deep(.pretui-btn:not(:first-child)) {
        margin-left: -1px;
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
      }
      .pretui-btngroup[data-orientation='horizontal'] :deep(.pretui-btn:not(:last-child)) {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
      }
      .pretui-btngroup[data-orientation='vertical'] :deep(.pretui-btn:not(:first-child)) {
        margin-top: -1px;
        border-top-left-radius: 0;
        border-top-right-radius: 0;
      }
      .pretui-btngroup[data-orientation='vertical'] :deep(.pretui-btn:not(:last-child)) {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
      }
      /* ── tone inheritance: re-point the channel Button's recipes read.
         The neutral-only vars reset to `initial` (guaranteed-invalid) so
         var() fallbacks re-engage for hue tones. ── */
      .pretui-btngroup[data-tone] :deep(.pretui-btn[data-tone]) {
        --pretui-btn-hairline: initial;
        --pretui-btn-shadow: initial;
        --pretui-btn-ink: initial;
        --pretui-btn-ink-quiet: initial;
      }
      .pretui-btngroup[data-tone='neutral'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--foreground);
        --pretui-tone-on: var(--pretui-on-neutral, var(--background));
        --pretui-btn-hairline: var(--border);
        --pretui-btn-shadow: var(--pretui-shadow-control, 0 0 0 1px var(--border));
        --pretui-btn-ink: var(--foreground);
        --pretui-btn-ink-quiet: var(--muted-foreground);
      }
      .pretui-btngroup[data-tone='primary'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--primary);
        --pretui-tone-on: var(--primary-foreground);
      }
      .pretui-btngroup[data-tone='info'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--pretui-info, var(--boxel-blue));
        --pretui-tone-on: var(--pretui-on-info, var(--background));
      }
      .pretui-btngroup[data-tone='success'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--success, var(--boxel-success));
        --pretui-tone-on: var(--pretui-on-success, var(--background));
      }
      .pretui-btngroup[data-tone='warning'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--warning, var(--boxel-warning));
        --pretui-tone-on: var(--pretui-on-warning, var(--background));
      }
      .pretui-btngroup[data-tone='danger'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--destructive);
        --pretui-tone-on: var(--destructive-foreground);
      }
      .pretui-btngroup[data-tone='attention'] :deep(.pretui-btn[data-tone]) {
        --pretui-tone: var(--pretui-attention, var(--boxel-fuschia));
        --pretui-tone-on: var(--pretui-on-attention, var(--background));
      }
      /* ── appearance inheritance: recipes restated at group specificity,
         formulas verbatim from controls.gts (they read the tone vars) ── */
      .pretui-btngroup[data-appearance='accent'] :deep(.pretui-btn[data-appearance]) {
        background: var(--pretui-button-bg, var(--pretui-tone));
        color: var(--pretui-button-fg, var(--pretui-tone-on));
        box-shadow: 0 0 0 1px color-mix(in oklch, var(--pretui-button-bg, var(--pretui-tone)) 70%, var(--border)),
          var(--pretui-edge-highlight, inset 0 1px 0 rgb(255 255 255 / 0.14)),
          0 1px 2px var(--shadow-ink-mid, rgb(0 0 0 / 0.08));
      }
      .pretui-btngroup[data-appearance='accent'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: color-mix(in oklch, var(--foreground) 10%, var(--pretui-button-bg, var(--pretui-tone)));
      }
      .pretui-btngroup[data-appearance='filled'] :deep(.pretui-btn[data-appearance]) {
        background: color-mix(in oklch, var(--pretui-tone) 15%, var(--card));
        color: var(--pretui-btn-ink, color-mix(in oklch, var(--pretui-tone) 60%, var(--foreground)));
        box-shadow: none;
      }
      .pretui-btngroup[data-appearance='filled'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: color-mix(in oklch, var(--pretui-tone) 22%, var(--card));
      }
      .pretui-btngroup[data-appearance='outlined'] :deep(.pretui-btn[data-appearance]) {
        background: var(--pretui-button-secondary-bg, var(--card));
        color: var(--pretui-btn-ink, color-mix(in oklch, var(--pretui-tone) 55%, var(--foreground)));
        box-shadow: var(--pretui-btn-shadow, 0 0 0 1px color-mix(in oklch, var(--pretui-tone) 45%, var(--border)));
      }
      .pretui-btngroup[data-appearance='outlined'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: var(--hover, var(--boxel-100));
      }
      .pretui-btngroup[data-appearance='filled-outlined'] :deep(.pretui-btn[data-appearance]) {
        background: color-mix(in oklch, var(--pretui-tone) 12%, var(--card));
        color: var(--pretui-btn-ink, color-mix(in oklch, var(--pretui-tone) 60%, var(--foreground)));
        box-shadow: 0 0 0 1px var(--pretui-btn-hairline, color-mix(in oklch, var(--pretui-tone) 40%, var(--border)));
      }
      .pretui-btngroup[data-appearance='filled-outlined'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: color-mix(in oklch, var(--pretui-tone) 20%, var(--card));
      }
      .pretui-btngroup[data-appearance='plain'] :deep(.pretui-btn[data-appearance]) {
        background: transparent;
        color: var(--pretui-btn-ink-quiet, color-mix(in oklch, var(--pretui-tone) 40%, var(--muted-foreground)));
        box-shadow: none;
      }
      .pretui-btngroup[data-appearance='plain'] :deep(.pretui-btn[data-appearance]:hover:not(:disabled)) {
        background: var(--hover, var(--boxel-100));
        color: var(--pretui-btn-ink, color-mix(in oklch, var(--pretui-tone) 30%, var(--foreground)));
      }
      /* ── size inheritance: font-size only, Button's own em scale rides ── */
      .pretui-btngroup[data-size='xs'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-xs, var(--text-ui-xs, 0.66rem));
      }
      .pretui-btngroup[data-size='s'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-s, var(--text-ui-sm, 0.72rem));
      }
      .pretui-btngroup[data-size='m'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-m, var(--text-ui-md, 0.78rem));
      }
      .pretui-btngroup[data-size='l'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-l, var(--text-ui-lg, 0.875rem));
      }
      .pretui-btngroup[data-size='xl'] :deep(.pretui-btn[data-size]) {
        font-size: var(--pretui-size-xl, var(--text-ui-xl, 1rem));
      }
    </style>
  </template>
}

// ── Divider ──────────────────────────────────────────────────────────────
// Transcribed from wa-divider: a semantic role='separator' rule for
// grouping adjacent content, horizontal or vertical, one hairline token
// (--border). Adds the centered-label variant WA doesn't ship (the
// 'OR' rule between form alternatives) — horizontal only; a vertical
// divider ignores @label. WA's --color/--width/--spacing knobs collapse
// to --pretui-divider-spacing; the hairline color IS the token.

export interface DividerSignature {
  Args: {
    orientation?: 'horizontal' | 'vertical';
    /** centered label — horizontal orientation only */
    label?: string;
  };
  Element: HTMLDivElement;
}

function orientationOf(o: string | undefined): 'horizontal' | 'vertical' {
  return o === 'vertical' ? 'vertical' : 'horizontal';
}

export const Divider: TemplateOnlyComponent<DividerSignature> = <template>
  <div
    class='pretui-divider'
    role='separator'
    aria-orientation={{orientationOf @orientation}}
    aria-label={{@label}}
    data-orientation={{orientationOf @orientation}}
    data-test-pretui-divider
    ...attributes
  >
    {{#if @label}}
      <span class='pretui-divider-label'>{{@label}}</span>
    {{/if}}
  </div>
  <style scoped>
    .pretui-divider {
      --pretui-divider-spacing: var(--space-4, 11px);
    }
    .pretui-divider[data-orientation='horizontal'] {
      display: flex;
      align-items: center;
      margin: var(--pretui-divider-spacing) 0;
    }
    .pretui-divider[data-orientation='horizontal']::before,
    .pretui-divider[data-orientation='horizontal']::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }
    .pretui-divider-label {
      padding: 0 8px;
      font-size: var(--text-ui-sm, 11.5px);
      letter-spacing: var(--track-ui, 0.01em);
      color: var(--muted-foreground);
      white-space: nowrap;
    }
    .pretui-divider[data-orientation='vertical'] {
      display: inline-block;
      width: 1px;
      align-self: stretch;
      min-height: 1lh;
      background: var(--border);
      margin: 0 var(--pretui-divider-spacing);
    }
    .pretui-divider[data-orientation='vertical'] .pretui-divider-label {
      display: none;
    }
  </style>
</template>;

// The Mantine / Chakra name for OtpInput.
export { OtpInput as PinInput };
