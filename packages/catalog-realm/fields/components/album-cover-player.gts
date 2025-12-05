import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { Button } from '@cardstack/boxel-ui/components';
import PlayIcon from '@cardstack/boxel-icons/play';
import PauseIcon from '@cardstack/boxel-icons/pause';
import type { BaseAudioPlayer, AudioFieldModel } from './base-audio-player';

interface AlbumCoverPlayerSignature {
  Args: {
    model: AudioFieldModel;
    player: BaseAudioPlayer;
  };
}

export class AlbumCoverPlayer extends GlimmerComponent<AlbumCoverPlayerSignature> {
  <template>
    <div class='album-player' data-test-album-cover-player>
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

      <div class='album-cover'>
        <div class='cover-gradient'></div>
        <div class='cover-overlay'>
          <Button
            @kind='primary'
            class='album-play-btn'
            {{on 'click' @player.togglePlay}}
            aria-label={{if @player.isPlaying 'Pause album' 'Play album'}}
          >
            {{#if @player.isPlaying}}
              <PauseIcon width='40' height='40' />
            {{else}}
              <PlayIcon width='40' height='40' />
            {{/if}}
          </Button>
        </div>
      </div>

      <div class='album-info'>
        <div class='album-title'>{{@model.displayTitle}}</div>
        {{#if @model.artist}}
          <div class='album-artist'>{{@model.artist}}</div>
        {{/if}}

        {{#if @player.audioDuration}}
          <div class='album-progress'>
            <div class='album-progress-bar'>
              <div
                class='album-progress-fill'
                style={{htmlSafe
                  (concat 'width: ' @player.progressPercentage '%')
                }}
              ></div>
            </div>
            <div class='album-time'>
              {{@player.formatTime @player.displayCurrentTime}}
              <span>/</span>
              {{@player.formatTime @player.displayDuration}}
            </div>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .album-player {
        display: flex;
        flex-direction: column;
        background: var(--boxel-light, #ffffff);
        border: 1px solid var(--boxel-border-color, #e5e7eb);
        border-radius: var(--boxel-border-radius, 0.5rem);
        overflow: hidden;
      }

      .album-cover {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        overflow: hidden;
      }

      .cover-gradient {
        width: 100%;
        height: 100%;
        background: linear-gradient(
          135deg,
          var(--primary, #3b82f6) 0%,
          var(--accent, #60a5fa) 50%,
          var(--primary, #3b82f6) 100%
        );
      }

      .cover-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .album-player:hover .cover-overlay {
        opacity: 1;
      }

      .album-play-btn {
        width: 5rem;
        height: 5rem;
        border-radius: 50%;
        background: white !important;
        color: var(--primary, #3b82f6) !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3) !important;
        transition: all 0.2s;
      }

      .album-play-btn:hover {
        background: rgba(255, 255, 255, 0.95) !important;
        transform: scale(1.05);
      }

      .album-info {
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .album-title {
        font-weight: 700;
        font-size: 1.125rem;
        color: var(--foreground, #1f2937);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .album-artist {
        font-size: 0.875rem;
        color: var(--muted-foreground, #6b7280);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-top: -0.5rem;
      }

      .album-progress {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .album-progress-bar {
        width: 100%;
        height: 0.375rem;
        background: var(--muted, #e5e7eb);
        border-radius: 0.1875rem;
        overflow: hidden;
      }

      .album-progress-fill {
        height: 100%;
        background: var(--primary, #3b82f6);
        transition: width 0.1s linear;
      }

      .album-time {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: var(--muted-foreground, #6b7280);
        font-variant-numeric: tabular-nums;
      }

      .album-time span {
        margin: 0 0.25rem;
      }
    </style>
  </template>
}
