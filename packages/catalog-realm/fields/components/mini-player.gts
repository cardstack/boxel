import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn, concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { Button, IconButton } from '@cardstack/boxel-ui/components';
import PlayIcon from '@cardstack/boxel-icons/play';
import PauseIcon from '@cardstack/boxel-icons/pause';
import type { BaseAudioPlayer, AudioFieldModel } from './base-audio-player';

interface MiniPlayerSignature {
  Args: {
    model: AudioFieldModel;
    player: BaseAudioPlayer;
  };
}

export class MiniPlayer extends GlimmerComponent<MiniPlayerSignature> {
  <template>
    <div class='mini-player' data-test-mini-player>
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

      <IconButton
        @icon={{if @player.isPlaying PauseIcon PlayIcon}}
        @width='18px'
        @height='18px'
        class='mini-play-btn'
        {{on 'click' @player.togglePlay}}
        aria-label={{if @player.isPlaying 'Pause' 'Play'}}
      />

      <div class='mini-info'>
        <div class='mini-title'>{{@model.displayTitle}}</div>
        {{#if @model.artist}}
          <div class='mini-artist'>{{@model.artist}}</div>
        {{/if}}
      </div>

      <div class='mini-skip-controls'>
        <Button
          @kind='ghost'
          class='skip-btn'
          {{on 'click' (fn @player.skipTime -15)}}
        >
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M11 19l-7-7 7-7M18 19l-7-7 7-7' />
          </svg>
          <span>15</span>
        </Button>
        <Button
          @kind='ghost'
          class='skip-btn'
          {{on 'click' (fn @player.skipTime 15)}}
        >
          <span>15</span>
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M13 5l7 7-7 7M6 5l7 7-7 7' />
          </svg>
        </Button>
      </div>

      <div class='mini-time'>
        {{@player.formatTime @player.displayCurrentTime}}
        <span class='time-separator'>/</span>
        {{@player.formatTime @player.displayDuration}}
      </div>

      {{#if @player.audioDuration}}
        <div class='mini-progress-container'>
          <div
            class='mini-progress-bar'
            style={{htmlSafe (concat 'width: ' @player.progressPercentage '%')}}
          ></div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .mini-player {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        background: var(--boxel-light, #ffffff);
        border: 1px solid var(--boxel-border-color, #e5e7eb);
        border-radius: var(--boxel-border-radius, 0.5rem);
        min-height: 60px;
      }

      .mini-play-btn {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--primary, #3b82f6) !important;
        color: white !important;
        padding: 0;
      }

      .mini-play-btn:hover {
        background: var(--accent, #60a5fa) !important;
      }

      .mini-info {
        flex: 1;
        min-width: 0;
        margin-right: auto;
      }

      .mini-title {
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--foreground, #1f2937);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mini-artist {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        margin-top: 0.125rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mini-skip-controls {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-shrink: 0;
      }

      .skip-btn {
        width: 2rem;
        height: 2rem;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.125rem;
        font-size: 0.625rem;
        font-weight: 600;
        color: var(--muted-foreground, #6b7280);
      }

      .skip-btn svg {
        width: 0.875rem;
        height: 0.875rem;
      }

      .skip-btn:hover {
        color: var(--foreground, #1f2937);
        background: var(--muted, #f3f4f6);
      }

      .mini-time {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .time-separator {
        margin: 0 0.25rem;
      }

      .mini-progress-container {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--muted, #e5e7eb);
        border-radius: 0 0 var(--radius, 0.5rem) var(--radius, 0.5rem);
        overflow: hidden;
      }

      .mini-progress-bar {
        height: 100%;
        background: var(--primary, #3b82f6);
        transition: width 0.1s linear;
      }
    </style>
  </template>
}
