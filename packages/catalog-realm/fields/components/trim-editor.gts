import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';
import { WaveformVisualizer } from './waveform-visualizer';
import PlayIcon from '@cardstack/boxel-icons/play';
import PauseIcon from '@cardstack/boxel-icons/pause';
import CheckIcon from '@cardstack/boxel-icons/check';
import type { BaseAudioPlayer, AudioFieldModel } from './base-audio-player';

interface TrimEditorSignature {
  Args: {
    model: AudioFieldModel;
    player: BaseAudioPlayer;
  };
}

export class TrimEditor extends GlimmerComponent<TrimEditorSignature> {
  <template>
    <div class='trim-editor' data-test-trim-editor>
      <audio
        {{@player.setupAudio}}
        src={{@model.url}}
        {{on 'play' @player.handlePlay}}
        {{on 'pause' @player.handlePause}}
        {{on 'timeupdate' @player.handleTimeUpdateWithTrim}}
        {{on 'loadedmetadata' @player.handleLoadedMetadata}}
      >
        <track kind='captions' />
      </audio>

      <div class='trim-header'>
        <div class='trim-title'>
          <h4>{{@model.displayTitle}}</h4>
          <div class='trim-subtitle'>Clip Editor</div>
        </div>
      </div>

      <div class='trim-info-bar'>
        <div class='trim-stat'>
          <span class='stat-label'>Start</span>
          <span class='stat-value'>{{@player.formatTime
              @player.trimStartSeconds
            }}</span>
        </div>
        <div class='trim-stat'>
          <span class='stat-label'>Duration</span>
          <span class='stat-value'>{{@player.formatTime
              @player.trimDurationSeconds
            }}</span>
        </div>
        <div class='trim-stat'>
          <span class='stat-label'>End</span>
          <span class='stat-value'>{{@player.formatTime
              @player.trimEndSeconds
            }}</span>
        </div>
      </div>

      <WaveformVisualizer
        @bars={{@player.displayWaveform}}
        @currentProgress={{@player.progressPercentage}}
        @onBarClick={{@player.seekToPosition}}
        @variant='trim'
        @trimStart={{@player.trimStart}}
        @trimEnd={{@player.trimEnd}}
      />

      <div class='trim-sliders'>
        <div class='slider-group'>
          <label class='slider-label'>
            <span>Trim Start</span>
            <span class='slider-value'>{{@player.trimStartFormatted}}%</span>
          </label>
          <input
            type='range'
            min='0'
            max={{@player.trimEnd}}
            step='0.1'
            value={{@player.trimStart}}
            {{on 'input' @player.handleTrimStartChange}}
            class='trim-slider start-slider'
            aria-label='Trim start position'
          />
        </div>

        <div class='slider-group'>
          <label class='slider-label'>
            <span>Trim End</span>
            <span class='slider-value'>{{@player.trimEndFormatted}}%</span>
          </label>
          <input
            type='range'
            min={{@player.trimStart}}
            max='100'
            step='0.1'
            value={{@player.trimEnd}}
            {{on 'input' @player.handleTrimEndChange}}
            class='trim-slider end-slider'
            aria-label='Trim end position'
          />
        </div>
      </div>

      <div class='trim-actions'>
        <div class='playback-controls-row'>
          <Button
            @kind='primary'
            class='control-btn'
            {{on 'click' @player.togglePlay}}
          >
            {{#if @player.isPlaying}}
              <PauseIcon width='20' height='20' />
            {{else}}
              <PlayIcon width='20' height='20' />
            {{/if}}
          </Button>

          <span class='time-display-inline'>
            {{@player.formatTime @player.displayCurrentTime}}
            /
            {{@player.formatTime @player.displayDuration}}
          </span>

          <label class='loop-toggle'>
            <input
              type='checkbox'
              checked={{@player.isLooping}}
              {{on 'change' @player.toggleLoop}}
              class='loop-checkbox'
            />
            Loop Clip
          </label>
        </div>

        <Button
          @kind='primary'
          class='trim-apply-btn'
          {{on 'click' @player.applyTrim}}
        >
          <CheckIcon width='16' height='16' />
          Apply Trim
        </Button>
      </div>
    </div>

    <style scoped>
      .trim-editor {
        background: var(--boxel-light, #ffffff);
        border: 1px solid var(--boxel-border-color, #e5e7eb);
        border-radius: var(--boxel-border-radius, 0.5rem);
        padding: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }

      .trim-header {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .trim-title h4 {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        margin: 0;
      }

      .trim-subtitle {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
      }

      .trim-info-bar {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
        padding: 1rem;
        background: var(--muted, #f3f4f6);
        border-radius: var(--radius, 0.5rem);
      }

      .trim-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
      }

      .stat-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground, #6b7280);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .stat-value {
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        font-variant-numeric: tabular-nums;
      }

      .trim-sliders {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 0 0.5rem;
      }

      .slider-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .slider-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1f2937);
      }

      .slider-value {
        font-variant-numeric: tabular-nums;
        color: var(--primary, #3b82f6);
        font-weight: 600;
      }

      .trim-slider {
        width: 100%;
        height: 0.5rem;
        background: var(--muted, #e5e7eb);
        border-radius: 0.25rem;
        appearance: none;
        cursor: pointer;
      }

      .trim-slider::-webkit-slider-thumb {
        appearance: none;
        width: 1.25rem;
        height: 1.25rem;
        background: var(--primary, #3b82f6);
        border-radius: 50%;
        cursor: grab;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        transition: all 0.2s;
      }

      .trim-slider::-webkit-slider-thumb:hover {
        background: var(--accent, #60a5fa);
        transform: scale(1.1);
      }

      .trim-slider::-webkit-slider-thumb:active {
        cursor: grabbing;
        transform: scale(1.15);
      }

      .trim-slider::-moz-range-thumb {
        width: 1.25rem;
        height: 1.25rem;
        background: var(--primary, #3b82f6);
        border-radius: 50%;
        cursor: grab;
        border: none;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        transition: all 0.2s;
      }

      .trim-slider::-moz-range-thumb:hover {
        background: var(--accent, #60a5fa);
        transform: scale(1.1);
      }

      .trim-slider::-moz-range-thumb:active {
        cursor: grabbing;
        transform: scale(1.15);
      }

      .start-slider::-webkit-slider-track {
        background: linear-gradient(
          to right,
          var(--muted, #e5e7eb) 0%,
          var(--primary, #3b82f6) 100%
        );
      }

      .end-slider::-webkit-slider-track {
        background: linear-gradient(
          to right,
          var(--primary, #3b82f6) 0%,
          var(--muted, #e5e7eb) 100%
        );
      }

      .trim-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 1rem;
        border-top: 1px solid var(--border, #e5e7eb);
      }

      .loop-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: var(--foreground, #1f2937);
        cursor: pointer;
        user-select: none;
      }

      .trim-apply-btn {
        padding: 0.625rem 1.25rem;
        background: var(--primary, #3b82f6) !important;
        color: white !important;
      }

      .trim-apply-btn:hover {
        background: var(--accent, #60a5fa) !important;
      }

      .playback-controls-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .control-btn {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--primary, #3b82f6) !important;
        color: white !important;
      }

      .control-btn:hover {
        background: var(--accent, #60a5fa) !important;
      }

      .time-display-inline {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
      }

      .loop-checkbox {
        width: 1rem;
        height: 1rem;
        cursor: pointer;
        accent-color: var(--primary, #3b82f6);
      }
    </style>
  </template>
}
