// Pretui — ChannelSlider: a slider for one colour channel, with a sentence for its value.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { cssStyleFrom, cssValue } from '../pretui-css';
import { alphaTrackCss, channelTrackCss, clamp, stepFor } from '../color-engine';
import type { ColorValue, GamutId } from '../color-engine';

// ── ChannelSlider ────────────────────────────────────────────────────────

/**
 * One channel on a track that shows what the channel does.
 *
 * Built on a real `<input type="range">` rather than a div with a thumb,
 * which is the decision that buys the whole accessibility floor from the
 * platform: `role="slider"`, `aria-valuenow`/`min`/`max`, Home/End,
 * PageUp/PageDown, touch, high-contrast mode, and RTL. What is layered on
 * top is only what the platform lacks:
 *
 *  * **Shift = ×10, Alt = ÷10** on the arrow keys (upstream has these on its
 *    number fields but not its sliders; figui3 has Shift only).
 *  * **Hue channels WRAP.** Arrowing up from 359° lands on 0°, not on a dead
 *    stop — a hue slider that clamps is a hue slider with a seam in it.
 *    (Upstream's own hue range maxes at 359 and clamps; only its number field
 *    wraps.)
 *  * A track gradient built from REAL conversions of the current colour, so
 *    an OKLCH chroma track shows where the colour leaves the gamut instead of
 *    a plausible-looking fake.
 */
export interface ChannelSliderSignature {
  Args: {
    label: string;
    /** Spoken text — a sentence, not a number. */
    valueText: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** Whether the value wraps at the ends. */
    wrap?: boolean;
    /** How to paint the track. See `ChannelTrack` — a typed spec, not a CSS
     *  string. */
    track: ChannelTrack;
    /** Show the alpha checkerboard behind the track. */
    checker?: boolean;
    disabled?: boolean;
    onInput: (value: number) => void;
    /** Called once when a gesture ends — where announcements belong. */
    onCommit?: () => void;
  };
  Element: HTMLDivElement;
}

/**
 * How a slider paints its track.
 *
 * This used to be a raw CSS string, which made `@track` a caller-supplied
 * value interpolated straight into an inline style — the sharpest hazard in
 * the whole colour surface, since a slider track is a `background` and a
 * `background` is where `url(…)` wants to live.
 *
 * A guard on the string would have been the obvious fix and is the weaker
 * one. **The value is typed instead, so on the two paths every real caller
 * uses there is no caller text at all** — the component hands numbers to the
 * engine and the engine constructs the gradient. That is the same
 * parse-and-reserialize principle the colour values follow, applied to a
 * whole declaration: emit a canonical string we built, never the caller's.
 *
 * `custom` remains for a caller who genuinely needs their own ramp, and it
 * is the only branch that touches caller text — so it is the only one that
 * needs `cssValue`, and a value that fails validation is DROPPED whole (the
 * stylesheet's own fallback paints instead), never stripped and used.
 */
export type ChannelTrack =
  /** One channel of `color` swept across its range, gamut-clamped. */
  | {
      kind: 'channel';
      color: ColorValue;
      index: number;
      gamut: GamutId;
      /** Sample count. More is smoother and longer. */
      steps?: number;
    }
  /** `color` fading from transparent to opaque, over the checkerboard. */
  | { kind: 'alpha'; color: ColorValue; gamut: GamutId }
  /** A caller's own CSS. Validated by the shared allowlist; dropped if it
   *  fails. NOTE: the allowlist does not currently admit the gradient
   *  functions, so a custom gradient is rejected today — see the report. */
  | { kind: 'custom'; css: string };

export class ChannelSlider extends Component<ChannelSliderSignature> {
  /** The track's CSS. Engine-constructed on the `channel` and `alpha`
   *  branches; guarded by the shared allowlist on `custom`. */
  get trackCss(): string | undefined {
    let track = this.args.track;
    if (track.kind === 'channel') {
      return channelTrackCss(
        track.color,
        track.index,
        track.gamut,
        track.steps,
      );
    }
    if (track.kind === 'alpha') {
      return alphaTrackCss(track.color, track.gamut);
    }
    return cssValue(track.css);
  }

  get trackStyle() {
    // `channel` and `alpha` are engine output — numbers and closed-enum
    // keywords concatenated by `color-engine.ts`, with every embedded colour
    // already through `cssFor`. `custom` has been through `cssValue` above.
    return cssStyleFrom(['--pretui-slider-track: ' + (this.trackCss ?? 'none')]);
  }

  handleInput = (event: Event) => {
    let input = event.target as HTMLInputElement;
    this.args.onInput(Number(input.value));
  };

  handleChange = () => {
    this.args.onCommit?.();
  };

  handleKey = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    let direction =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (direction === 0) {
      return;
    }
    let modified = event.shiftKey || event.altKey;
    // Plain arrows on a non-wrapping channel are already correct natively —
    // intercepting them would only risk diverging from the platform.
    if (!modified && !this.args.wrap) {
      return;
    }
    event.preventDefault();
    let step = stepFor(
      { step: this.args.step } as never,
      { shiftKey: event.shiftKey, altKey: event.altKey },
    );
    let next = this.args.value + direction * step;
    let span = this.args.max - this.args.min;
    if (this.args.wrap && span > 0) {
      let offset = (next - this.args.min) % span;
      next = this.args.min + (offset < 0 ? offset + span : offset);
    } else {
      next = clamp(next, this.args.min, this.args.max);
    }
    this.args.onInput(next);
    this.args.onCommit?.();
  };

  <template>
    <div
      class='pretui-chslider'
      data-checker={{if @checker 'true'}}
      style={{this.trackStyle}}
      data-test-pretui-channel-slider={{@label}}
      ...attributes
    >
      <input
        type='range'
        class='pretui-chslider-input'
        aria-label={{@label}}
        aria-valuetext={{@valueText}}
        min={{@min}}
        max={{@max}}
        step={{@step}}
        value={{@value}}
        disabled={{@disabled}}
        {{on 'input' this.handleInput}}
        {{on 'change' this.handleChange}}
        {{on 'keydown' this.handleKey}}
      />
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-chslider {
          position: relative;
          height: var(--pretui-slider-h, 16px);
          border-radius: 999px;
          background-image: var(--pretui-slider-track, none);
          box-shadow: inset 0 0 0 1px
            color-mix(in oklch, var(--foreground) 16%, transparent);
          /* keep the drag from scrolling the page under it */
          touch-action: none;
        }
        .pretui-chslider[data-checker='true'] {
          background-image: var(--pretui-slider-track, none),
            var(
              --pretui-checker,
              repeating-conic-gradient(
                color-mix(in oklch, var(--foreground) 11%, transparent) 0 25%,
                transparent 0 50%
              )
            );
          background-size: auto, 8px 8px;
        }
        .pretui-chslider-input {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          height: 100%;
          margin: 0;
          background: transparent;
          cursor: pointer;
          display: block;
          touch-action: none;
        }
        .pretui-chslider-input:disabled {
          cursor: not-allowed;
        }
        .pretui-chslider-input::-webkit-slider-thumb {
          appearance: none;
          -webkit-appearance: none;
          width: var(--pretui-slider-thumb, 14px);
          height: var(--pretui-slider-thumb, 14px);
          border-radius: 50%;
          background: transparent;
          box-shadow:
            0 0 0 2px #fff,
            0 0 0 3.5px rgb(0 0 0 / 0.45);
        }
        .pretui-chslider-input::-moz-range-thumb {
          width: var(--pretui-slider-thumb, 14px);
          height: var(--pretui-slider-thumb, 14px);
          border: 0;
          border-radius: 50%;
          background: transparent;
          box-shadow:
            0 0 0 2px #fff,
            0 0 0 3.5px rgb(0 0 0 / 0.45);
        }
        .pretui-chslider-input:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: 999px;
        }
        .pretui-chslider:has(.pretui-chslider-input:disabled) {
          opacity: 0.5;
        }
      }
    </style>
  </template>
}
