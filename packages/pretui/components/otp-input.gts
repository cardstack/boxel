// Pretui — OtpInput: fixed-length code entry, one character per segment.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

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
