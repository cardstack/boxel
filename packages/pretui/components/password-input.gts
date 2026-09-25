// Pretui — PasswordInput: a password field with a reveal toggle.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlAliasArgs } from '../pretui-primitives';
import { PasswordStrength, estimateWhenIdle, loadPasswordEstimator } from './password-strength';
import type { StrengthReading } from './password-strength';
import { TYPED_FONT } from '../internal/extras';

// BoxelInput @type='password' plus the reveal toggle boxel-ui doesn't
// ship: an overlay eye button flips the native type to text while pressed
// state holds (aria-pressed carries it). @autocomplete defaults to
// 'current-password'; pass 'new-password' for signup forms, 'off' to opt
// out. @revealable={{false}} removes the toggle.
//
// Strength estimation (added 2026-08-13) is OPT-IN via @strength={{true}} —
// Law 9, weight is opt-in at the package boundary. Without it this component
// is byte-for-byte what it was: the zxcvbn bundle (1.59 MiB / 839 KiB
// gzipped) is not on the static import graph at all, and even with
// @strength on it is fetched by the first estimate rather than by render, so
// the field types and submits from first paint. See components/password-strength.gts.
//
// @userInputs is the single highest-value knob: hand it the user's own name,
// email and handle and "chris1985" stops reading as strong, because zxcvbn
// scores against them as a dictionary. Pass it on every signup form.
//
// Estimation is ADVICE. Nothing here disables the field, reports invalid, or
// blocks submission on a score — current NIST 800-63B guidance is that
// composition rules are counterproductive and that length and
// not-being-breached are what matter. The password is never announced,
// logged, put in the DOM as text, or sent anywhere; zxcvbn runs entirely
// locally and there is no network call on this path.

const PASSWORD_METRICS = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: 18px; padding-block: 4px; padding-right: 30px;',
);

/** Idle time after the last keystroke before an estimate runs. Long enough
 * that a live region is not narrating mid-word, short enough to feel live. */
const STRENGTH_DELAY = 400;

export interface PasswordInputSignature {
  Args: ControlAliasArgs & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    controlId?: string;
    /** autocomplete hint — 'current-password' by default */
    autocomplete?: string;
    /** show the reveal toggle — true by default */
    revealable?: boolean;
    onInput?: (value: string) => void;
    /** render the strength indicator (opt-in; loads the estimator lazily) */
    strength?: boolean;
    /** what you already know about the user — name, email, handle, company.
     * zxcvbn scores against these, so "chris1985" reads as weak instead of
     * strong. The single most valuable thing you can pass. */
    userInputs?: (string | number)[];
    /** idle ms before an estimate runs — 400 by default */
    strengthDelay?: number;
    /** replace the five strength labels (localisation, or a house voice) */
    strengthLabels?: readonly string[];
    /** show the meter row before anything has been typed — false by default,
     * so the field does not open with an empty accusation */
    strengthAlwaysVisible?: boolean;
    /** called with each settled estimate. Advice, not a gate — do not wire
     * this to a submit button's disabled state. */
    onStrength?: (reading: StrengthReading) => void;
  };
  Element: HTMLDivElement;
}

export class PasswordInput extends Component<PasswordInputSignature> {
  @tracked revealed = false;
  /** the value the estimator will see. Lives in memory only: it is never
   * written to an attribute, a title, a test hook, or the console. */
  @tracked pending = this.args.value ?? '';
  @tracked reading: StrengthReading | undefined = undefined;
  @tracked estimating = false;
  /** discards the result of a superseded in-flight estimate */
  private estimateRun = 0;

  get revealable() {
    return this.args.revealable ?? true;
  }
  get type() {
    return this.revealed && this.revealable ? 'text' : 'password';
  }
  get autocomplete() {
    return this.args.autocomplete ?? 'current-password';
  }
  get inputStyle() {
    return this.revealable ? PASSWORD_METRICS : TYPED_FONT;
  }
  get strength() {
    return this.args.strength ?? false;
  }
  get strengthDelay() {
    return this.args.strengthDelay ?? STRENGTH_DELAY;
  }
  get strengthAlwaysVisible() {
    return this.args.strengthAlwaysVisible ?? false;
  }
  get score() {
    return this.reading?.score;
  }
  get warning() {
    return this.reading?.warning;
  }
  get suggestions() {
    return this.reading?.suggestions;
  }
  get crackTime() {
    return this.reading?.crackTime;
  }
  get hideStrengthWhenEmpty() {
    return !this.strengthAlwaysVisible;
  }
  /** A by-VALUE key for @userInputs, so learning the user's email re-scores
   * the password — but an inline `{{array …}}` literal, which is a fresh
   * object every render, does not re-arm the debounce. */
  get userInputsKey() {
    return (this.args.userInputs ?? []).join(', ');
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  handleInput = (value: string) => {
    this.pending = value;
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      value,
    );
  };
  /** Fired by `estimateWhenIdle` once typing has settled. The estimator is
   * fetched here — the first time anyone asks, and never again. */
  runEstimate = (value: string) => {
    if (!this.strength) {
      return;
    }
    if (value === '') {
      this.reading = undefined;
      this.estimating = false;
      return;
    }
    let run = ++this.estimateRun;
    this.estimating = true;
    loadPasswordEstimator()
      .then((estimate) => {
        if (this.isDestroying || run !== this.estimateRun) {
          return;
        }
        let reading = estimate(value, this.args.userInputs ?? []);
        this.reading = reading;
        this.estimating = false;
        this.args.onStrength?.(reading);
      })
      .catch(() => {
        // A meter that fails to load is a missing meter, not a broken field.
        if (this.isDestroying || run !== this.estimateRun) {
          return;
        }
        this.reading = undefined;
        this.estimating = false;
      });
  };
  toggle = (_e: Event) => {
    this.revealed = !this.revealed;
  };
  <template>
    <div
      class='pretui-boxelwrap'
      data-revealed={{if this.revealed 'true'}}
      data-test-pretui-password-input
      ...attributes
    >
      <BoxelInput
        @type={{this.type}}
        @value={{@value}}
        @placeholder={{@placeholder}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        @autocomplete={{this.autocomplete}}
        @onInput={{this.handleInput}}
        id={{@controlId}}
        style={{this.inputStyle}}
      />
      {{#if this.revealable}}
        <button
          type='button'
          class='pretui-reveal'
          aria-label={{if this.revealed 'Hide password' 'Show password'}}
          aria-pressed={{if this.revealed 'true' 'false'}}
          disabled={{this.disabled}}
          {{on 'click' this.toggle}}
        >
          {{#if this.revealed}}
            <svg
              width='14'
              height='14'
              viewBox='0 0 16 16'
              aria-hidden='true'
            ><path
                d='M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linejoin='round'
              /><circle
                cx='8'
                cy='8'
                r='2'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
              /><path
                d='M2.5 13.5 13.5 2.5'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linecap='round'
              /></svg>
          {{else}}
            <svg
              width='14'
              height='14'
              viewBox='0 0 16 16'
              aria-hidden='true'
            ><path
                d='M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
                stroke-linejoin='round'
              /><circle
                cx='8'
                cy='8'
                r='2'
                fill='none'
                stroke='currentColor'
                stroke-width='1.3'
              /></svg>
          {{/if}}
        </button>
      {{/if}}
      {{#if this.strength}}
        {{! The meter lives INSIDE the existing wrapper so the component keeps
            exactly one root element and `...attributes` lands where it always
            did. The modifier owns the debounce timer and cancels it in its
            destructor — it is one-shot and cannot re-arm itself. }}
        <div
          class='pretui-password-strength'
          {{estimateWhenIdle
            this.pending
            this.strengthDelay
            this.runEstimate
            this.userInputsKey
          }}
        >
          <PasswordStrength
            @score={{this.score}}
            @warning={{this.warning}}
            @suggestions={{this.suggestions}}
            @crackTime={{this.crackTime}}
            @labels={{@strengthLabels}}
            @busy={{this.estimating}}
            @hideWhenEmpty={{this.hideStrengthWhenEmpty}}
          />
        </div>
      {{/if}}
    </div>
    <style scoped>
      /* Same re-skin channel as EmailInput — see that component's note. */
      .pretui-boxelwrap {
        position: relative;
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --muted-foreground: var(--ink-3, var(--boxel-400));
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
      .pretui-reveal {
        position: absolute;
        top: calc((var(--control-h, 28px) - 20px) / 2);
        right: 5px;
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border: 0;
        padding: 0;
        border-radius: 6px;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-reveal:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-reveal:disabled {
        opacity: 0.45;
        cursor: default;
      }
      /* The meter sits under the control inside the same wrapper. It is the
         only thing that changes the wrapper's height, and only when
         @strength is on. */
      .pretui-password-strength {
        margin-block-start: var(--space-2, 6px);
      }
    </style>
  </template>
}
