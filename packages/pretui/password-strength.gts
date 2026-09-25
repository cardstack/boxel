// Pretui — password strength: the `PasswordStrength` indicator, the pure
// score→label machinery behind it, and the lazily-attached zxcvbn estimator.
//
// Three separations, and they are the whole design:
//
// 1. **The indicator does not estimate.** `PasswordStrength` takes a score and
//    feedback strings and renders them. It never sees a password, never loads
//    a dictionary, and can be rendered — and tested — with nothing behind it.
//    The estimator stays swappable (a breach check, a server-side score, a
//    different library) without touching the UI.
// 2. **The estimator is lazy.** `loadPasswordEstimator()` is the only path to
//    `./zxcvbn/index.js`, which is 1.59 MiB / 839 KiB gzipped — see
//    `zxcvbn/README.md`. Nothing in this module's static import graph touches
//    it, so `PasswordInput` renders and works with no meter at all and pays
//    nothing until someone asks for a score. A password field that cannot
//    render until a dictionary downloads is a worse component than one
//    without a meter.
// 3. **The timer is owned.** `OneShotDebounce` is a plain class with injected
//    schedule/cancel (so it is unit-testable with no real clock), and
//    `estimateWhenIdle` is the `ember-modifier` that owns one instance and
//    cancels it in its destructor. It is one-shot by construction: the
//    scheduled callback clears its own handle and schedules nothing, so there
//    is no path from a fired timer to another timer and it can never hold
//    `await settled()` open.
//
// Guidance correctness — the part of this that is not styling:
//
// - **Strength is advice, never a gate.** Nothing here disables, blocks, or
//   reports validity. Current NIST 800-63B guidance is explicit that
//   composition rules (must contain a symbol, a digit, a capital) are
//   counterproductive and that length plus not-being-breached is what
//   matters. A meter that refuses a long passphrase for lacking a symbol is
//   actively wrong. zxcvbn agrees in its own words — one of its stock
//   suggestions is "You can create strong passwords without using symbols,
//   numbers, or uppercase letters."
// - **Never colour alone.** Every score carries a text label and zxcvbn's own
//   `warning` / `suggestions` prose. A coloured bar with no words fails WCAG
//   1.4.1 and fails the user, who cannot act on a colour. The same reason the
//   bars collapse 0 and 1 to one lit segment: the distinction between them is
//   carried by the label, which is the channel that survives greyscale.
// - **Announce politely, on settled state.** One `role='status'`
//   `aria-live='polite'` region carrying one composed sentence, updated after
//   the debounce settles — never per keystroke, and silent mid-flight, so a
//   screen-reader user hears a result rather than a stream.
// - **The password never leaves memory.** It is not echoed into
//   `aria-valuetext`, a `title`, a `data-` attribute, or any test hook; it is
//   not logged; it is not sent anywhere. The vendored bundle contains no
//   network call and none is added here, and the reduced `estimate()` surface
//   cannot return password substrings at all (`zxcvbn/README.md` explains why
//   the raw zxcvbn result is not exported).
//
// Better than the inspiration: the meters this was measured against (zxcvbn's
// own demo, the shadcn / Web Awesome strength-meter recipes) ship a coloured
// bar and at best a label — the actionable `suggestions` array zxcvbn already
// computed is dropped on the floor, the meter is wired to a submit gate, and
// the announcement is per-keystroke or absent. All four are fixed here.
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';
import { Meter } from './ink';

// ── The pure layer (unit-tested without a dictionary or a clock) ─────────

/** The number of zxcvbn score bands; scores run 0…SCORE_MAX. */
export const SCORE_MAX = 4;

/** Segments the meter draws. Four bands, five scores — see `barLevel`. */
const SEGMENTS = 4;

/** Equal-height bars: this reads as a level track, not the ascending
 * signal-strength staircase `Meter` draws by default. */
const FLAT_BARS: number[] = [10, 10, 10, 10];

/**
 * Default labels, index = score. Deliberately five rather than four: zxcvbn's
 * 0 and 1 are genuinely different ("too guessable" vs "very guessable") and
 * collapsing them throws away a distinction the user can act on.
 */
export const SCORE_LABELS: readonly string[] = Object.freeze([
  'Very weak',
  'Weak',
  'Fair',
  'Strong',
  'Very strong',
]);

/** What an estimator has to give this component. `PasswordEstimate` from the
 * vendored bundle satisfies it structurally, which is what keeps the
 * estimator swappable — and declaring it here rather than importing the
 * bundle's type keeps `./zxcvbn/index.js` off the static import graph
 * outright, instead of relying on `import type` erasure to do it. */
export interface StrengthReading {
  /** zxcvbn score, 0 (too guessable) … 4 (very unguessable) */
  score: number;
  /** the headline warning, '' when there is none */
  warning?: string;
  /** actionable suggestions, possibly empty */
  suggestions?: string[];
  /** humanised crack time */
  crackTime?: string;
  /** log10 of the estimated guess count — the continuous signal behind the
   * five bands, for anyone who wants to reason about it rather than show it */
  guessesLog10?: number;
}

/**
 * Coerce anything to a whole score in 0…4. Every consumer of a score in this
 * file goes through this, so a score reaches an attribute or a CSS lookup
 * only after clamping and no caller value is ever interpolated anywhere.
 */
export function clampScore(value: unknown): number {
  let n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(SCORE_MAX, Math.max(0, Math.round(n)));
}

/** The text label for a score. Never returns '' — colour is never alone. */
export function strengthLabel(
  value: unknown,
  labels: readonly string[] = SCORE_LABELS,
): string {
  let i = clampScore(value);
  return labels[i] ?? SCORE_LABELS[i] ?? '';
}

/**
 * Lit segments for a score. Score 0 lights one rather than none, because an
 * empty track is indistinguishable from "not estimated yet" — the difference
 * between 0 and 1 is carried by the label instead.
 */
export function barLevel(value: unknown): number {
  return Math.max(1, clampScore(value));
}

/**
 * The single sentence the live region announces. Composed rather than left as
 * several live nodes, because several nodes changing at once is what turns a
 * screen reader into a stream. `undefined` in means '' out — which is what an
 * unestimated or in-flight field wants to announce.
 */
export function strengthAnnouncement(
  reading: StrengthReading | undefined,
  labels: readonly string[] = SCORE_LABELS,
  prefix = 'Password strength',
): string {
  if (!reading) {
    return '';
  }
  let parts = [prefix + ': ' + strengthLabel(reading.score, labels) + '.'];
  if (reading.warning) {
    parts.push(reading.warning);
  }
  for (let suggestion of reading.suggestions ?? []) {
    parts.push(suggestion);
  }
  return parts.join(' ');
}

// ── The timer (owned, one-shot, self-cancelling) ─────────────────────────

/** The scheduling surface a `OneShotDebounce` needs. Injected so a test can
 * drive it with a fake clock and create no real timer at all. */
export interface TimerHost {
  schedule(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/** The real one. `setTimeout` is legal here only because the modifier below
 * owns the instance and cancels it in its destructor. */
export const REAL_TIMERS: TimerHost = {
  schedule: (callback: () => void, ms: number) =>
    setTimeout(callback, ms) as unknown,
  cancel: (handle: unknown) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * A debounce holding at most one pending call, which can never re-arm itself:
 * the scheduled callback clears its own handle and schedules nothing, so
 * there is no path from a fired timer to another timer. `arm()` cancels any
 * pending call first and `cancel()` is idempotent, which is what makes it
 * safe to call from a modifier destructor.
 */
export class OneShotDebounce {
  private handle: unknown = undefined;
  private timers: TimerHost;

  constructor(timers: TimerHost = REAL_TIMERS) {
    this.timers = timers;
  }

  /** True while a call is pending. */
  get pending(): boolean {
    return this.handle !== undefined;
  }

  /** Cancel anything pending, then schedule exactly one call. */
  arm(callback: () => void, ms: number): void {
    this.cancel();
    this.handle = this.timers.schedule(() => {
      this.handle = undefined;
      callback();
    }, Math.max(0, ms));
  }

  /** Cancel anything pending. Safe to call any number of times. */
  cancel(): void {
    if (this.handle !== undefined) {
      this.timers.cancel(this.handle);
      this.handle = undefined;
    }
  }
}

/**
 * Runs `run(value)` once `value` has stopped changing for `delay` ms.
 *
 * The function form of `modifier` runs its destructor before re-running on an
 * arg change, so each new value cancels the previous pending call and arms
 * exactly one more; teardown cancels the last. Nothing survives the element.
 *
 * `run` arrives as a positional arg rather than through a captured closure so
 * that identity churn in the caller cannot retrigger this modifier and re-arm
 * the timer every render.
 *
 * The optional fourth positional is a **change key**: anything else that
 * should force a re-estimate, expressed as a primitive. It must be a value,
 * not an object — an inline `@userInputs={{array 'a' 'b'}}` mints a fresh
 * array every render, so passing the array itself would re-arm the timer
 * forever, whereas its joined string compares equal and does not.
 */
export const estimateWhenIdle = modifier(
  (
    _el: HTMLElement,
    [value, delay, run, _key]: [
      string,
      number,
      (value: string) => void,
      (string | number | undefined)?,
    ],
  ) => {
    let debounce = new OneShotDebounce();
    debounce.arm(() => run(value), delay);
    return () => debounce.cancel();
  },
);

// ── The lazy estimator ───────────────────────────────────────────────────

type EstimateFn = (
  password: string,
  userInputs?: (string | number)[],
) => StrengthReading;

let estimatorPromise: Promise<EstimateFn> | undefined;

/**
 * Resolve the zxcvbn estimator, fetching the vendored bundle on first call
 * and reusing the same promise for every later one. This dynamic `import()`
 * is the only reference to `./zxcvbn/index.js` in the kit — keep it that way
 * or the bundle joins the static graph and the laziness evaporates.
 *
 * Estimation is entirely local. The bundle contains no network call and none
 * is added here: a password must never be sent anywhere.
 */
export function loadPasswordEstimator(): Promise<EstimateFn> {
  if (!estimatorPromise) {
    estimatorPromise = import('./zxcvbn/index.js').then((mod) => mod.estimate);
  }
  return estimatorPromise;
}

/** True once the estimator has been requested in this session — exposed so a
 * demo (or a test) can show that nothing loads until it is asked for. */
export function passwordEstimatorRequested(): boolean {
  return estimatorPromise !== undefined;
}

// ── PasswordStrength ─────────────────────────────────────────────────────

export interface PasswordStrengthSignature {
  Args: {
    /** zxcvbn score 0…4. Clamped; anything unusable reads as 0. Leave it
     * undefined for "not estimated yet" — the meter says so rather than
     * lying at the bottom of the scale. */
    score?: number;
    /** the estimator's headline warning, if it produced one */
    warning?: string;
    /** the estimator's actionable suggestions, if it produced any */
    suggestions?: string[];
    /** humanised crack time, shown as a quiet aside when supplied */
    crackTime?: string;
    /** replace the five default labels (localisation, or a house voice) */
    labels?: readonly string[];
    /** what the live region says before the label */
    announcePrefix?: string;
    /** true while an estimate is in flight — the meter greys and the live
     * region stays silent, so nothing is announced mid-flight */
    busy?: boolean;
    /** render nothing until there is something to say (default true); pass
     * false to reserve the row's height from first paint */
    hideWhenEmpty?: boolean;
  };
  Element: HTMLDivElement;
}

export class PasswordStrength extends Component<PasswordStrengthSignature> {
  get scored(): boolean {
    return this.args.score !== undefined && this.args.score !== null;
  }
  get score(): number {
    return clampScore(this.args.score);
  }
  get labels(): readonly string[] {
    return this.args.labels ?? SCORE_LABELS;
  }
  get label(): string {
    return this.scored ? strengthLabel(this.score, this.labels) : '—';
  }
  get level(): number {
    return this.scored ? barLevel(this.score) : 0;
  }
  get suggestions(): string[] {
    return this.args.suggestions ?? [];
  }
  get hidden(): boolean {
    return (this.args.hideWhenEmpty ?? true) && !this.scored && !this.args.busy;
  }
  /** Silent while busy or unscored: a live region carries settled results
   * only. */
  get announcement(): string {
    if (this.args.busy || !this.scored) {
      return '';
    }
    return strengthAnnouncement(
      {
        score: this.score,
        warning: this.args.warning,
        suggestions: this.suggestions,
      },
      this.labels,
      this.args.announcePrefix ?? 'Password strength',
    );
  }
  <template>
    {{#unless this.hidden}}
      <div
        class='pretui-pwstrength'
        data-score={{this.score}}
        data-scored={{if this.scored 'true'}}
        data-busy={{if @busy 'true'}}
        data-test-pretui-password-strength
        ...attributes
      >
        {{! The visible layer is aria-hidden and mirrored sr-only below, so a
            screen reader hears one composed sentence rather than a meter, a
            paragraph and a list all announcing separately. }}
        <div class='pretui-pwstrength-row' aria-hidden='true'>
          <Meter
            class='pretui-pwstrength-meter'
            @level={{this.level}}
            @segments={{SEGMENTS}}
            @label={{this.label}}
            @heights={{FLAT_BARS}}
          />
          {{#if @crackTime}}
            <span class='pretui-pwstrength-time'>{{@crackTime}} to crack</span>
          {{/if}}
        </div>
        {{#if @warning}}
          <p
            class='pretui-pwstrength-warning'
            aria-hidden='true'
          >{{@warning}}</p>
        {{/if}}
        {{#if this.suggestions}}
          <ul class='pretui-pwstrength-tips' aria-hidden='true'>
            {{#each this.suggestions as |suggestion|}}
              <li>{{suggestion}}</li>
            {{/each}}
          </ul>
        {{/if}}
        <p
          class='pretui-pwstrength-sr'
          role='status'
          aria-live='polite'
        >{{this.announcement}}</p>
      </div>
    {{/unless}}
    <style scoped>
      .pretui-pwstrength {
        display: grid;
        gap: var(--space-2, 5px);
        width: 100%;
        font-size: var(--text-ui-sm, 11.5px);
        letter-spacing: var(--track-ui, 0.01em);
        /* Score → hue lives entirely in CSS, keyed off a clamped numeric
           attribute: no string is ever interpolated into a style. The bars
           inherit `--pretui-meter-hue` from here, so `Meter` re-dresses
           itself through the token channel and nothing reaches into its
           markup. Each band is a documented knob, so a season re-tints
           without a fork. */
        --pretui-meter-hue: var(
          --pretui-password-strength-unscored,
          var(--line-strong, var(--boxel-400))
        );
      }
      .pretui-pwstrength[data-scored][data-score='0'],
      .pretui-pwstrength[data-scored][data-score='1'] {
        --pretui-meter-hue: var(
          --pretui-password-strength-weak,
          var(--destructive)
        );
      }
      .pretui-pwstrength[data-scored][data-score='2'] {
        --pretui-meter-hue: var(
          --pretui-password-strength-fair,
          var(--warning, var(--boxel-warning))
        );
      }
      .pretui-pwstrength[data-scored][data-score='3'] {
        --pretui-meter-hue: var(
          --pretui-password-strength-strong,
          color-mix(
            in oklch,
            var(--success, var(--boxel-success)) 70%,
            var(--warning, var(--boxel-warning))
          )
        );
      }
      .pretui-pwstrength[data-scored][data-score='4'] {
        --pretui-meter-hue: var(
          --pretui-password-strength-best,
          var(--success, var(--boxel-success))
        );
      }
      .pretui-pwstrength[data-busy] {
        opacity: 0.55;
      }
      .pretui-pwstrength-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3, 8px);
      }
      /* Law 8: judged in a still frame — the bars carry a label and the
         label carries weight, so the treatment survives greyscale. */
      .pretui-pwstrength-meter {
        font-weight: 500;
      }
      .pretui-pwstrength-time {
        color: var(--ink-3, var(--boxel-400));
        font-variant-numeric: tabular-nums;
      }
      .pretui-pwstrength-warning {
        margin: 0;
        color: var(--foreground);
      }
      .pretui-pwstrength-tips {
        margin: 0;
        padding-inline-start: var(--space-5, 15px);
        display: grid;
        gap: 2px;
        color: var(--muted-foreground);
      }
      /* sr-only: the composed announcement, and the only thing a screen
         reader reads in this component. */
      .pretui-pwstrength-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }
    </style>
  </template>
}
