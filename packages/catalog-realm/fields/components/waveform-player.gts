import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { IconButton } from '@cardstack/boxel-ui/components';
import { WaveformVisualizer } from './waveform-visualizer';
import PlayIcon from '@cardstack/boxel-icons/play';
import PauseIcon from '@cardstack/boxel-icons/pause';
import type { BaseAudioPlayer, AudioFieldModel } from './base-audio-player';

interface WaveformPlayerSignature {
  Args: {
    model: AudioFieldModel;
    player: BaseAudioPlayer;
  };
}

export class WaveformPlayer extends GlimmerComponent<WaveformPlayerSignature> {
  <template>
    <div class='waveform-player' data-test-waveform-player>
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

      <div class='waveform-header'>
        <div class='waveform-info'>
          <div class='waveform-title'>{{@model.displayTitle}}</div>
          {{#if @model.artist}}
            <div class='waveform-artist'>{{@model.artist}}</div>
          {{/if}}
        </div>
      </div>

      <div class='waveform-container'>
        <WaveformVisualizer
          @bars={{@player.displayWaveform}}
          @currentProgress={{@player.progressPercentage}}
          @onBarClick={{@player.seekToPosition}}
          @variant='default'
        />
      </div>

      <div class='waveform-controls'>
        <IconButton
          @icon={{if @player.isPlaying PauseIcon PlayIcon}}
          @width='20px'
          @height='20px'
          class='waveform-play-btn'
          {{on 'click' @player.togglePlay}}
          aria-label={{if @player.isPlaying 'Pause' 'Play'}}
        />
        <div class='waveform-time'>
          {{@player.formatTime @player.displayCurrentTime}}
          /
          {{@player.formatTime @player.displayDuration}}
        </div>
      </div>
    </div>

    <style scoped>
      .waveform-player {
        background: linear-gradient(
          135deg,
          var(--primary, #3b82f6),
          var(--accent, #60a5fa)
        );
        border-radius: var(--boxel-border-radius, 0.5rem);
        padding: var(--boxel-sp-lg);
        color: var(--boxel-light, #ffffff);
      }

      .waveform-header {
        margin-bottom: 1rem;
      }

      .waveform-title {
        font-weight: 600;
        font-size: 1rem;
        margin-bottom: 0.25rem;
      }

      .waveform-artist {
        font-size: 0.875rem;
        opacity: 0.9;
      }

      .waveform-container {
        margin: 1.5rem 0;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 0.25rem;
        padding: 0.5rem;
      }

      .waveform-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .waveform-play-btn {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--boxel-light, #ffffff) !important;
        color: var(--boxel-purple-500, #8b5cf6) !important;
      }

      .waveform-play-btn:hover {
        background: var(--boxel-200, #e5e7eb) !important;
      }

      .waveform-time {
        font-size: 0.875rem;
        font-weight: 500;
      }
    </style>
  </template>
}
