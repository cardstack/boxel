// Pretui — TrimBar: a waveform with two draggable handles that pick a trim range.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { formatClock } from '../internal/reading-format';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { Token } from './token';
import { clamp, stepsFor, waveDelta, waveEngine } from '../internal/media-wave';
import type { WaveEngine, WavePhase, WaveRegion, WaveSteps } from '../internal/media-wave';

/**
 * Attach a pointer-drag trio to a handle.
 *
 * Not `{{on 'pointerdown'}}`: realm lint rejects a template binding to a
 * pointer-down event, and it is right to — for a click, `pointerup` is the
 * correct event and binding `down` swallows the gesture. A DRAG genuinely
 * starts on `pointerdown`, so the listener lives in a modifier that owns it
 * and removes all three in its destructor. Pointer capture keeps `move` and
 * `up` on this element, so there is nothing on `window` to leak.
 */
const dragHandle = modifier(
  (
    el: HTMLElement,
    [down, move, up]: [
      (event: Event) => void,
      (event: Event) => void,
      (event: Event) => void,
    ],
  ) => {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  },
);

// ── Keyboard geometry, shared by both components ─────────────────────────

// ── TrimBar ──────────────────────────────────────────────────────────────

/** The in/out pair, in seconds. */
export interface TrimRange {
  start: number;
  end: number;
}

export interface TrimBarSignature {
  Args: {
    /** URL of the audio to trim over. */
    src: string;
    /** Accessible name of the trimmer; each handle derives its own from it. */
    label: string;
    /** In point in seconds. Uncontrolled when omitted. */
    start?: number;
    /** Out point in seconds. Uncontrolled when omitted. */
    end?: number;
    /** Smallest gap the two handles may leave, in seconds. Default 0.1. */
    minGap?: number;
    /** Seconds moved by one arrow press. Default 0.1. */
    step?: number;
    /** Drawing height in px. Default 72. */
    height?: number;
    /** Fires continuously while dragging or on every key press. */
    onChange?: (range: TrimRange) => void;
    /** Fires once when a pointer drag ends. */
    onCommit?: (range: TrimRange) => void;
  };
  Element: HTMLDivElement;
}

export class TrimBar extends Component<TrimBarSignature> {
  @tracked phase: WavePhase = 'idle';
  @tracked message = '';
  @tracked duration = 0;
  @tracked current = 0;
  @tracked playing = false;
  @tracked innerStart = 0;
  @tracked innerEnd = 0;
  /** Which handle a pointer is currently dragging, if any. */
  @tracked dragging: 'start' | 'end' | null = null;

  engine: WaveEngine | null = null;
  region: WaveRegion | null = null;

  // ── the range ──────────────────────────────────────────────────────────

  get minGap(): number {
    const raw = this.args.minGap;
    return typeof raw === 'number' && raw > 0 ? raw : 0.1;
  }
  get start(): number {
    const raw = this.args.start;
    return typeof raw === 'number' ? clamp(raw, 0, this.duration) : this.innerStart;
  }
  get end(): number {
    const raw = this.args.end;
    return typeof raw === 'number' ? clamp(raw, 0, this.duration) : this.innerEnd;
  }
  get selected(): number {
    return Math.max(0, this.end - this.start);
  }
  get startPercent(): number {
    return this.duration > 0 ? (this.start / this.duration) * 100 : 0;
  }
  get endPercent(): number {
    return this.duration > 0 ? (this.end / this.duration) * 100 : 100;
  }
  get rangeStyle() {
    return cssStyleFrom([
      cssDeclaration('--pretui-trim-in', `${this.startPercent}%`),
      cssDeclaration('--pretui-trim-out', `${this.endPercent}%`),
      cssDeclaration('--pretui-wave-height', `${this.height}px`),
    ]);
  }

  // ── engine host ────────────────────────────────────────────────────────

  get height(): number {
    const raw = this.args.height;
    return typeof raw === 'number' && raw >= 24 ? Math.round(raw) : 72;
  }
  get barWidth(): number {
    return 3;
  }
  get barGap(): number {
    return 2;
  }
  get normalize(): boolean {
    return true;
  }
  get wantsRegions(): boolean {
    return true;
  }
  /** wavesurfer must NOT seek on pointer: inside a trimmer a press is the
   * start of a handle drag, and two things owning the same gesture is how
   * every trimmer in the wild ends up feeling broken. */
  get interact(): boolean {
    return false;
  }
  get engineKey(): string {
    return [this.height, 'trim'].join(':');
  }
  get steps(): WaveSteps {
    const fine = typeof this.args.step === 'number' && this.args.step > 0 ? this.args.step : 0.1;
    return stepsFor(this.duration, fine);
  }
  get startValueText(): string {
    return `In point ${formatClock(this.start)} of ${formatClock(this.duration)}`;
  }
  get endValueText(): string {
    return `Out point ${formatClock(this.end)} of ${formatClock(this.duration)}`;
  }
  get summary(): string {
    return `${formatClock(this.start)} – ${formatClock(this.end)} · ${formatClock(this.selected)} selected`;
  }
  get startLabel(): string {
    return `${this.args.label} — in point`;
  }
  get endLabel(): string {
    return `${this.args.label} — out point`;
  }
  get startMax(): number {
    return Math.max(0, this.end - this.minGap);
  }
  get endMin(): number {
    return Math.min(this.duration, this.start + this.minGap);
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
  get startDragging(): 'true' | undefined {
    return this.dragging === 'start' ? 'true' : undefined;
  }
  get endDragging(): 'true' | undefined {
    return this.dragging === 'end' ? 'true' : undefined;
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
    if (this.innerEnd === 0 && this.duration > 0) {
      this.innerStart = this.duration * 0.25;
      this.innerEnd = this.duration * 0.75;
    }
  };
  onTime = (seconds: number): void => {
    this.current = Number.isFinite(seconds) ? seconds : 0;
    // Playing a selection means stopping at the out point. wavesurfer has no
    // "play until" — this is the whole of it, and it needs no timer.
    if (this.playing && this.duration > 0 && seconds >= this.end) {
      this.engine?.pause();
      this.engine?.setTime(this.start);
    }
  };
  onPlaying = (playing: boolean): void => {
    this.playing = playing;
  };
  onRegionReady = (region: WaveRegion | null): void => {
    this.region = region;
    if (region) {
      // Adopt whatever the caller already set, rather than the plugin's guess.
      this.pushRegion();
    }
  };

  // ── mutation ───────────────────────────────────────────────────────────

  pushRegion = (): void => {
    this.region?.setOptions({ start: this.start, end: this.end });
  };

  setRange = (start: number, end: number, commit: boolean): void => {
    const lo = clamp(start, 0, Math.max(0, this.duration - this.minGap));
    const hi = clamp(end, Math.min(this.duration, lo + this.minGap), this.duration);
    if (this.args.start === undefined) {
      this.innerStart = lo;
    }
    if (this.args.end === undefined) {
      this.innerEnd = hi;
    }
    this.region?.setOptions({ start: lo, end: hi });
    this.args.onChange?.({ start: lo, end: hi });
    if (commit) {
      this.args.onCommit?.({ start: lo, end: hi });
    }
  };

  moveStart = (seconds: number, commit = false): void => {
    this.setRange(Math.min(seconds, this.end - this.minGap), this.end, commit);
  };
  moveEnd = (seconds: number, commit = false): void => {
    this.setRange(this.start, Math.max(seconds, this.start + this.minGap), commit);
  };

  playSelection = (): void => {
    if (!this.engine || this.phase !== 'ready') {
      return;
    }
    if (this.engine.isPlaying()) {
      this.engine.pause();
      return;
    }
    this.engine.setTime(this.start);
    this.engine.play();
  };

  // ── keyboard ───────────────────────────────────────────────────────────

  keyFor = (which: 'start' | 'end') => {
    return (raw: Event): void => {
      const event = raw as KeyboardEvent;
      if (this.phase !== 'ready') {
        return;
      }
      const move = which === 'start' ? this.moveStart : this.moveEnd;
      if (event.key === 'Home') {
        event.preventDefault();
        move(which === 'start' ? 0 : this.start + this.minGap, true);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        move(which === 'start' ? this.end - this.minGap : this.duration, true);
        return;
      }
      const delta = waveDelta(event, this.steps);
      if (delta !== null) {
        event.preventDefault();
        const from = which === 'start' ? this.start : this.end;
        move(from + delta, true);
      }
    };
  };

  handleStartKey = this.keyFor('start');
  handleEndKey = this.keyFor('end');

  // ── pointer ────────────────────────────────────────────────────────────

  // Pointer capture keeps move/up on the handle itself, so Glimmer's teardown
  // of the element takes the listeners with it. No window listeners, nothing
  // to unregister by hand, and a component destroyed mid-drag leaves nothing
  // behind.
  secondsFromEvent = (event: PointerEvent): number => {
    const rail = (event.currentTarget as HTMLElement).closest('.pretui-trim-rail');
    if (!rail || this.duration <= 0) {
      return 0;
    }
    const box = rail.getBoundingClientRect();
    if (box.width <= 0) {
      return 0;
    }
    return ((event.clientX - box.left) / box.width) * this.duration;
  };

  downFor = (which: 'start' | 'end') => {
    return (raw: Event): void => {
      const event = raw as PointerEvent;
      if (this.phase !== 'ready') {
        return;
      }
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      this.dragging = which;
    };
  };
  moveFor = (which: 'start' | 'end') => {
    return (raw: Event): void => {
      const event = raw as PointerEvent;
      if (this.dragging !== which) {
        return;
      }
      event.preventDefault();
      const seconds = this.secondsFromEvent(event);
      if (which === 'start') {
        this.moveStart(seconds);
      } else {
        this.moveEnd(seconds);
      }
    };
  };
  upFor = (which: 'start' | 'end') => {
    return (raw: Event): void => {
      const event = raw as PointerEvent;
      if (this.dragging !== which) {
        return;
      }
      this.dragging = null;
      const target = event.currentTarget as HTMLElement;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      this.args.onCommit?.({ start: this.start, end: this.end });
    };
  };

  handleStartDown = this.downFor('start');
  handleStartMove = this.moveFor('start');
  handleStartUp = this.upFor('start');
  handleEndDown = this.downFor('end');
  handleEndMove = this.moveFor('end');
  handleEndUp = this.upFor('end');

  <template>
    <div
      class='pretui-trim'
      data-phase={{this.phase}}
      data-test-pretui-trimbar
      ...attributes
    >
      <div class='pretui-trim-rail' style={{this.rangeStyle}}>
        <div
          class='pretui-trim-canvas'
          {{waveEngine this @src this.engineKey}}
        ></div>
        <div class='pretui-trim-shadeStart' aria-hidden='true'></div>
        <div class='pretui-trim-shadeEnd' aria-hidden='true'></div>

        <div
          class='pretui-trim-handle pretui-trim-handle--in'
          role='slider'
          tabindex='0'
          aria-label={{this.startLabel}}
          aria-valuemin='0'
          aria-valuemax={{this.startMax}}
          aria-valuenow={{this.start}}
          aria-valuetext={{this.startValueText}}
          aria-disabled={{this.ariaDisabled}}
          data-dragging={{this.startDragging}}
          {{on 'keydown' this.handleStartKey}}
          {{dragHandle this.handleStartDown this.handleStartMove this.handleStartUp}}
        ><span class='pretui-trim-grip' aria-hidden='true'></span></div>

        <div
          class='pretui-trim-handle pretui-trim-handle--out'
          role='slider'
          tabindex='0'
          aria-label={{this.endLabel}}
          aria-valuemin={{this.endMin}}
          aria-valuemax={{this.duration}}
          aria-valuenow={{this.end}}
          aria-valuetext={{this.endValueText}}
          aria-disabled={{this.ariaDisabled}}
          data-dragging={{this.endDragging}}
          {{on 'keydown' this.handleEndKey}}
          {{dragHandle this.handleEndDown this.handleEndMove this.handleEndUp}}
        ><span class='pretui-trim-grip' aria-hidden='true'></span></div>

        {{#if this.isLoading}}
          <p class='pretui-trim-veil'>Decoding audio…</p>
        {{else if this.isFailed}}
          <p class='pretui-trim-veil pretui-trim-veil--bad'>
            <span aria-hidden='true'>⚠</span>
            {{if this.message this.message 'This audio could not be decoded.'}}
          </p>
        {{/if}}
      </div>

      <div class='pretui-trim-bar'>
        <button
          type='button'
          class='pretui-trim-play'
          disabled={{this.transportDisabled}}
          aria-pressed={{if this.playing 'true' 'false'}}
          {{on 'click' this.playSelection}}
        >
          <span aria-hidden='true'>{{if this.playing '❚❚' '▶'}}</span>
          {{if this.playing 'Stop' 'Play selection'}}
        </button>
        <span class='pretui-trim-summary'>
          <Token @value={{this.summary}} />
        </span>
        <span class='pretui-trim-status' data-phase={{this.phase}}>
          {{this.statusLabel}}
        </span>
      </div>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-trim {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .pretui-trim-rail {
          position: relative;
          min-height: var(--pretui-wave-height, 72px);
          padding: 6px 0;
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
          touch-action: none;
        }
        .pretui-trim-canvas {
          min-height: var(--pretui-wave-height, 72px);
        }
        /* Everything outside the selection is dimmed, so the trim reads at a
           glance and not only from the handle positions. */
        .pretui-trim-shadeStart,
        .pretui-trim-shadeEnd {
          position: absolute;
          inset-block: 0;
          background: color-mix(
            in oklch,
            var(--card) 62%,
            transparent
          );
          pointer-events: none;
        }
        .pretui-trim-shadeStart {
          inset-inline-start: 0;
          width: var(--pretui-trim-in, 0%);
        }
        .pretui-trim-shadeEnd {
          inset-inline-start: var(--pretui-trim-out, 100%);
          inset-inline-end: 0;
        }
        .pretui-trim-handle {
          position: absolute;
          inset-block: 0;
          width: 16px;
          margin-inline-start: -8px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: ew-resize;
          touch-action: none;
        }
        .pretui-trim-handle--in {
          inset-inline-start: var(--pretui-trim-in, 0%);
        }
        .pretui-trim-handle--out {
          inset-inline-start: var(--pretui-trim-out, 100%);
        }
        .pretui-trim-handle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
          border-radius: 4px;
        }
        .pretui-trim-grip {
          display: block;
          width: 4px;
          height: 100%;
          border-radius: 999px;
          background: var(--primary);
          box-shadow: 0 0 0 1px var(--card);
        }
        .pretui-trim-handle[data-dragging='true'] .pretui-trim-grip {
          width: 6px;
        }
        .pretui-trim-veil {
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
          background: color-mix(in oklch, var(--card) 82%, transparent);
          border-radius: var(--radius);
        }
        .pretui-trim-veil--bad {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .pretui-trim-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .pretui-trim-play {
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
        .pretui-trim-play:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .pretui-trim-play:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-trim-summary {
          margin-inline-end: auto;
        }
        .pretui-trim-status {
          font-size: var(--text-ui-xs, 10.5px);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--muted-foreground);
        }
        .pretui-trim-status[data-phase='error'] {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
        }
        .dark .pretui-trim-rail {
          background: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--card)
          );
        }
        .dark .pretui-trim-shadeStart,
        .dark .pretui-trim-shadeEnd {
          background: color-mix(in oklch, var(--card) 62%, transparent);
        }
      }
    </style>
  </template>
}
