import { eq } from '@cardstack/boxel-ui/helpers';
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn, concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';

interface WaveformVisualizerSignature {
  Element: HTMLDivElement;
  Args: {
    bars: number[]; // Array of heights (0-100)
    currentProgress: number; // Current playback percentage (0-100)
    onBarClick: (index: number) => void; // Callback when bar is clicked
    variant?: 'default' | 'trim'; // Visual style variant
    trimStart?: number; // Trim start percentage (for trim variant)
    trimEnd?: number; // Trim end percentage (for trim variant)
  };
}

export class WaveformVisualizer extends GlimmerComponent<WaveformVisualizerSignature> {
  // ² Component definition
  get isBarPlayed() {
    return (index: number): boolean => {
      if (!this.args.bars.length) return false;
      const barProgress = (index / this.args.bars.length) * 100;
      return barProgress <= (this.args.currentProgress || 0);
    };
  }

  get isBarInTrimRange() {
    return (index: number): boolean => {
      if (this.args.variant !== 'trim' || !this.args.bars.length) return true;
      const barPosition = (index / this.args.bars.length) * 100;
      const start = this.args.trimStart ?? 0;
      const end = this.args.trimEnd ?? 100;
      return barPosition >= start && barPosition <= end;
    };
  }

  <template>
    <div class='waveform-visualizer {{@variant}}'>
      <div class='waveform-bars'>
        {{#each @bars as |height index|}}
          <button
            type='button'
            class='waveform-bar
              {{if (this.isBarPlayed index) "played" "unplayed"}}
              {{if (this.isBarInTrimRange index) "in-range" "out-range"}}'
            style={{htmlSafe (concat 'height: ' height '%')}}
            {{on 'click' (fn @onBarClick index)}}
            aria-label='Seek to position {{index}}'
          ></button>
        {{/each}}
      </div>

      {{#if (eq @variant 'trim')}}
        <div class='trim-markers'>
          <div
            class='start-marker'
            style={{htmlSafe (concat 'left: ' @trimStart '%')}}
          ></div>
          <div
            class='end-marker'
            style={{htmlSafe (concat 'left: ' @trimEnd '%')}}
          ></div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      /* ³ Waveform visualizer styles */
      .waveform-visualizer {
        position: relative;
      }

      .waveform-bars {
        display: flex;
        align-items: center;
        gap: 0.125rem;
        height: 5rem;
      }

      .waveform-bar {
        flex: 1;
        border-radius: 0.125rem;
        cursor: pointer;
        transition: all 0.1s;
        border: none;
        padding: 0;
        background: transparent;
      }

      /* Default variant - waveform player */
      .waveform-visualizer.default .waveform-bar.played {
        background: white;
      }

      .waveform-visualizer.default .waveform-bar.unplayed {
        background: rgba(255, 255, 255, 0.3);
      }

      .waveform-visualizer.default .waveform-bar:hover {
        opacity: 0.8;
      }

      /* Trim variant - trim editor */
      .waveform-visualizer.trim {
        background: var(--muted, #f3f4f6);
        border-radius: 0.5rem;
        padding: 1rem;
      }

      .waveform-visualizer.trim .waveform-bars {
        height: 6rem;
      }

      .waveform-visualizer.trim .waveform-bar.in-range {
        background: var(--primary, #3b82f6);
        opacity: 1;
      }

      .waveform-visualizer.trim .waveform-bar.out-range {
        background: var(--muted-foreground, #9ca3af);
        opacity: 0.2;
      }

      .trim-markers {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
      }

      .start-marker,
      .end-marker {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--primary, #3b82f6);
      }

      .start-marker::before,
      .end-marker::before {
        content: '';
        position: absolute;
        top: -4px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 8px solid var(--primary, #3b82f6);
      }
    </style>
  </template>
}
