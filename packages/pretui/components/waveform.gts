// Pretui — Waveform: an audio waveform on wavesurfer.js with a keyboard-operable playhead.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { formatClock } from '../internal/reading-format';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { Token } from './token';
import { clamp, stepsFor, waveDelta, waveEngine } from '../internal/media-wave';
import type { WaveEngine, WavePhase, WaveSteps } from '../internal/media-wave';

/** "0:03 of 0:06" — what a screen reader should say about a playhead. A bare
 * `aria-valuenow` of `3.417` is technically correct and useless. */
export function waveValueText(current: number, duration: number): string {
  return `${formatClock(current)} of ${formatClock(duration)}`;
}

// ── The lifecycle contract ───────────────────────────────────────────────

// ── Waveform ─────────────────────────────────────────────────────────────

export interface WaveformSignature {
  Args: {
    /** URL of the audio. Passed through untouched — the component never
     * creates or revokes an object URL, so a blob URL stays the caller's. */
    src: string;
    /** Accessible name of the scrubber. Required in practice: "slider" with
     * no name is the single most common failure in this category. */
    label: string;
    /** Drawing height in px. Default 96. Reserved before the audio lands, so
     * nothing reflows when it does. */
    height?: number;
    /** Bar width in px, or 0 for a continuous waveform. Default 3. */
    barWidth?: number;
    /** Gap between bars in px. Default 2. */
    barGap?: number;
    /** Scale peaks to the loudest sample. Default `true`. */
    normalize?: boolean;
    /** Seconds moved by one arrow press. Default 1. */
    step?: number;
    /** Hide the transport row and the readout, leaving only the wave. */
    bare?: boolean;
    onReady?: (duration: number) => void;
    onSeek?: (seconds: number) => void;
    onPlayingChange?: (playing: boolean) => void;
  };
  Element: HTMLDivElement;
}

export class Waveform extends Component<WaveformSignature> {
  @tracked phase: WavePhase = 'idle';
  @tracked message = '';
  @tracked duration = 0;
  @tracked current = 0;
  @tracked playing = false;

  engine: WaveEngine | null = null;

  get height(): number {
    const raw = this.args.height;
    return typeof raw === 'number' && raw >= 24 ? Math.round(raw) : 96;
  }
  get barWidth(): number {
    const raw = this.args.barWidth;
    return typeof raw === 'number' && raw >= 0 ? raw : 3;
  }
  get barGap(): number {
    const raw = this.args.barGap;
    return typeof raw === 'number' && raw >= 0 ? raw : 2;
  }
  get normalize(): boolean {
    return this.args.normalize ?? true;
  }
  get wantsRegions(): boolean {
    return false;
  }
  get interact(): boolean {
    return true;
  }
  get engineKey(): string {
    return [this.height, this.barWidth, this.barGap, this.normalize].join(':');
  }
  get steps(): WaveSteps {
    const fine = typeof this.args.step === 'number' && this.args.step > 0 ? this.args.step : 1;
    return stepsFor(this.duration, fine);
  }
  get valueText(): string {
    return waveValueText(this.current, this.duration);
  }
  get readyMax(): number {
    return this.duration > 0 ? this.duration : 0;
  }
  get boxStyle() {
    return cssStyleFrom([cssDeclaration('--pretui-wave-height', `${this.height}px`)]);
  }
  get statusLabel(): string {
    switch (this.phase) {
      case 'loading':
        return 'Decoding';
      case 'error':
        return 'Failed';
      case 'ready':
        return this.playing ? 'Playing' : 'Ready';
      default:
        return 'Idle';
    }
  }
  get isLoading(): boolean {
    return this.phase === 'loading';
  }
  get isFailed(): boolean {
    return this.phase === 'error';
  }
  /* Glimmer binds a dynamic attribute through the PROPERTY, so a boolean
     attribute must be `true | undefined` — `false` and `''` both land as a
     falsy property assignment that silently does nothing, and `'false'` is a
     truthy string. This is the trap that cost the media territory the most
     time; it is spelled out here rather than repeated at four call sites. */
  get ariaDisabled(): 'true' | undefined {
    return this.phase === 'ready' ? undefined : 'true';
  }
  get transportDisabled(): true | undefined {
    return this.phase === 'ready' ? undefined : true;
  }

  onEngine = (engine: WaveEngine | null): void => {
    this.engine = engine;
  };
  onPhase = (phase: WavePhase, message: string): void => {
    this.phase = phase;
    this.message = message;
  };
  onDuration = (seconds: number): void => {
    this.duration = Number.isFinite(seconds) ? seconds : 0;
    if (this.phase === 'ready') {
      this.args.onReady?.(this.duration);
    }
  };
  onTime = (seconds: number): void => {
    this.current = Number.isFinite(seconds) ? seconds : 0;
  };
  onPlaying = (playing: boolean): void => {
    this.playing = playing;
    this.args.onPlayingChange?.(playing);
  };
  onRegionReady = (): void => undefined;

  seekTo = (seconds: number): void => {
    const next = clamp(seconds, 0, this.duration);
    this.current = next;
    this.engine?.setTime(next);
    this.args.onSeek?.(next);
  };

  togglePlay = (): void => {
    if (!this.engine || this.phase !== 'ready') {
      return;
    }
    if (this.engine.isPlaying()) {
      this.engine.pause();
    } else {
      this.engine.play();
    }
  };

  // `{{on}}` types its handler as `(event: Event) => void`; the narrow type
  // is asserted at the top of each handler rather than in the signature.
  handleKey = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (this.phase !== 'ready') {
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.seekTo(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.seekTo(this.duration);
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.togglePlay();
      return;
    }
    const delta = waveDelta(event, this.steps);
    if (delta !== null) {
      event.preventDefault();
      this.seekTo(this.current + delta);
    }
  };

  <template>
    <div
      class='pretui-wave'
      data-phase={{this.phase}}
      data-playing={{if this.playing 'true' 'false'}}
      data-test-pretui-waveform
      ...attributes
    >
      <div class='pretui-wave-box' style={{this.boxStyle}}>
        <div
          class='pretui-wave-canvas'
          {{waveEngine this @src this.engineKey}}
        ></div>
        {{! The scrubber is an EMPTY overlay, deliberately: `role='slider'`
            takes presentational children only, so the waveform cannot live
            inside it. It is pointer-transparent, so a click still reaches
            wavesurfer's own seek; its job is to be the one tab stop and to
            carry the announced value. }}
        <div
          class='pretui-wave-scrub'
          role='slider'
          tabindex='0'
          aria-label={{@label}}
          aria-valuemin='0'
          aria-valuemax={{this.readyMax}}
          aria-valuenow={{this.current}}
          aria-valuetext={{this.valueText}}
          aria-disabled={{this.ariaDisabled}}
          {{on 'keydown' this.handleKey}}
        ></div>
        {{#if this.isLoading}}
          <p class='pretui-wave-veil'>Decoding audio…</p>
        {{else if this.isFailed}}
          <p class='pretui-wave-veil pretui-wave-veil--bad'>
            <span aria-hidden='true'>⚠</span>
            {{if this.message this.message 'This audio could not be decoded.'}}
          </p>
        {{/if}}
      </div>

      {{#unless @bare}}
        <div class='pretui-wave-bar'>
          <button
            type='button'
            class='pretui-wave-play'
            disabled={{this.transportDisabled}}
            aria-pressed={{if this.playing 'true' 'false'}}
            {{on 'click' this.togglePlay}}
          >
            <span aria-hidden='true'>{{if this.playing '❚❚' '▶'}}</span>
            <span class='pretui-wave-playText'>{{if this.playing 'Pause' 'Play'}}</span>
          </button>
          <span class='pretui-wave-time'>
            <Token @value={{this.valueText}} />
          </span>
          <span class='pretui-wave-status' data-phase={{this.phase}}>
            {{this.statusLabel}}
          </span>
        </div>
      {{/unless}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-wave {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .pretui-wave-box {
          position: relative;
          /* Reserved BEFORE the audio lands, so the decode never reflows the
             page around it — the Law-8 corollary. */
          min-height: var(--pretui-wave-height, 96px);
          padding: 6px;
          border-radius: var(--radius);
          background: color-mix(
            in oklch,
            var(--foreground) 4%,
            var(--card)
          );
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-wave-scrub {
          position: absolute;
          inset: 0;
          border-radius: var(--radius);
          /* Focusable but pointer-transparent: the tab stop is here, the
             pointer seek is wavesurfer's, and neither steals from the other. */
          pointer-events: none;
        }
        .pretui-wave-scrub:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-wave-canvas {
          min-height: var(--pretui-wave-height, 96px);
        }
        .pretui-wave-veil {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin: 0;
          padding: 0 12px;
          text-align: center;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          background: color-mix(
            in oklch,
            var(--card) 82%,
            transparent
          );
          border-radius: var(--radius);
        }
        .pretui-wave-veil--bad {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-wave-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .pretui-wave-play {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border: 0;
          border-radius: 999px;
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 600;
          color: var(--primary-foreground);
          background: var(--primary);
          cursor: pointer;
        }
        .pretui-wave-play:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .pretui-wave-play:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-wave-playText {
          letter-spacing: 0.01em;
        }
        .pretui-wave-time {
          margin-inline-end: auto;
        }
        /* State carries a word, not only a hue — Appendix M.8. */
        .pretui-wave-status {
          font-size: var(--text-ui-xs, 10.5px);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-wave-status[data-phase='error'] {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-wave-status[data-phase='ready'] {
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        }
        .dark .pretui-wave-box {
          background: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--card)
          );
        }
      }
    </style>
  </template>
}
