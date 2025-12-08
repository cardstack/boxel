import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { IconButton } from '@cardstack/boxel-ui/components';
import PlayIcon from '@cardstack/boxel-icons/play';
import PauseIcon from '@cardstack/boxel-icons/pause';
import type { BaseAudioPlayer, AudioFieldModel } from './base-audio-player';

interface PlaylistRowSignature {
  Args: {
    model: AudioFieldModel;
    player: BaseAudioPlayer;
  };
}

export class PlaylistRow extends GlimmerComponent<PlaylistRowSignature> {
  <template>
    <div class='playlist-row' data-test-playlist-row>
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
        @width='16px'
        @height='16px'
        class='playlist-play-btn'
        {{on 'click' @player.togglePlay}}
        aria-label={{if @player.isPlaying 'Pause' 'Play'}}
      />

      <div class='playlist-cover'>
        <svg
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
        >
          <path d='M9 18V5l12-2v13' />
          <circle cx='6' cy='18' r='3' />
          <circle cx='18' cy='16' r='3' />
        </svg>
      </div>

      <div class='playlist-info'>
        <div class='playlist-title {{if @player.isPlaying "playing"}}'>
          {{@model.displayTitle}}
        </div>
        {{#if @model.artist}}
          <div class='playlist-artist'>{{@model.artist}}</div>
        {{/if}}
      </div>

      <div class='playlist-duration'>
        {{@player.formatTime @player.displayDuration}}
      </div>
    </div>

    <style scoped>
      .playlist-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem;
        border-radius: var(--radius, 0.5rem);
        transition: background 0.2s;
        background: var(--boxel-light, #ffffff);
      }

      .playlist-play-btn {
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .playlist-cover {
        width: 3rem;
        height: 3rem;
        background: linear-gradient(
          135deg,
          var(--primary, #3b82f6),
          var(--accent, #60a5fa)
        );
        border-radius: var(--boxel-border-radius-sm, 0.25rem);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        flex-shrink: 0;
      }

      .playlist-cover svg {
        width: 1.5rem;
        height: 1.5rem;
      }

      .playlist-info {
        flex: 1;
        min-width: 0;
      }

      .playlist-title {
        font-weight: 500;
        font-size: 0.875rem;
        color: var(--foreground, #1f2937);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .playlist-title.playing {
        color: var(--primary, #3b82f6);
      }

      .playlist-artist {
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        margin-top: 0.125rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .playlist-duration {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
        flex-shrink: 0;
      }
    </style>
  </template>
}
