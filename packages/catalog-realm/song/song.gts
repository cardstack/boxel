import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import BooleanField from 'https://cardstack.com/base/boolean';
import MusicIcon from '@cardstack/boxel-icons/music';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

class SongEmbedded extends Component<typeof SongCard> {
  @tracked isPlaying = false;

  @tracked currentTime = 0;
  @tracked duration = 0;
  @tracked progress = 0;
  private audioElement: HTMLAudioElement | null = null;
  private progressInterval: number | null = null;

  @action
  togglePlay(event: Event) {
    // Prevent event bubbling to stop overlay interference
    event.stopPropagation();
    event.preventDefault();

    if (!this.args.model?.audioUrl) {
      console.log('No audio URL available for this song');
      // Show a brief message that audio is not available
      return;
    }

    if (!this.audioElement) {
      this.audioElement = new Audio(this.args.model.audioUrl);
      this.audioElement.volume = 0.7;

      // Add event listeners for better control
      this.audioElement.addEventListener('ended', () => {
        this.isPlaying = false;
        this.currentTime = 0;
        this.progress = 0;
        this.stopProgressTracking();
      });

      this.audioElement.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        this.isPlaying = false;
        this.stopProgressTracking();
      });

      this.audioElement.addEventListener('loadedmetadata', () => {
        this.duration = this.audioElement?.duration || 0;
      });

      this.audioElement.addEventListener('timeupdate', () => {
        if (this.audioElement) {
          this.currentTime = this.audioElement.currentTime;
          this.progress =
            this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
        }
      });
    }

    if (this.isPlaying) {
      this.audioElement.pause();
      this.isPlaying = false;
      this.stopProgressTracking();
      console.log(`Paused: ${this.args.model?.songTitle}`);
    } else {
      this.audioElement
        .play()
        .then(() => {
          this.isPlaying = true;
          this.startProgressTracking();
          console.log(`Playing: ${this.args.model?.songTitle}`);
        })
        .catch((error) => {
          console.error('Audio playback failed:', error);
          this.isPlaying = false;
          this.stopProgressTracking();
        });
    }
  }

  startProgressTracking() {
    this.stopProgressTracking();
    this.progressInterval = window.setInterval(() => {
      if (this.audioElement && this.isPlaying) {
        this.currentTime = this.audioElement.currentTime;
        this.progress =
          this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
      }
    }, 100);
  }

  stopProgressTracking() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  willDestroy() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeEventListener('ended', () => {});
      this.audioElement.removeEventListener('error', () => {});
      this.audioElement = null;
    }
    this.stopProgressTracking();
    super.willDestroy();
  }

  <template>
    <div class='song-card'>
      {{#if @model.coverArtUrl}}
        <img src={{@model.coverArtUrl}} alt='Cover art' class='song-cover' />
      {{else}}
        <div class='song-cover-placeholder'>
          <svg
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <circle cx='12' cy='12' r='10' />
            <circle cx='12' cy='12' r='3' />
          </svg>
        </div>
      {{/if}}

      <div class='song-info'>
        <div class='song-header'>
          <h4 class='song-title'>{{@model.songTitle}}</h4>
          {{#if @model.isExplicit}}
            <span class='explicit-tag'>E</span>
          {{/if}}
          {{#if @model.duration}}
            <span class='song-duration'>{{@model.duration}}</span>
          {{/if}}
        </div>

        {{#if @model.artist}}
          <p class='song-artist'>{{@model.artist}}</p>
        {{/if}}

        {{#if @model.genre}}
          <div class='song-metadata'>
            <span class='genre-badge'>{{@model.genre}}</span>
          </div>
        {{/if}}

        <!-- Playback Progress Bar -->
        {{#if this.isPlaying}}
          <div class='playback-progress'>
            <div class='time-display'>
              <span class='current-time'>{{this.formatTime
                  this.currentTime
                }}</span>
              <span class='total-time'>{{@model.duration}}</span>
            </div>
            <div class='progress-track'>
              <div
                class='progress-fill-playback'
                style={{htmlSafe (concat 'width: ' this.progress '%')}}
              ></div>
            </div>
          </div>
        {{/if}}

      </div>

      <div class='song-controls'>
        {{#if @model.audioUrl}}
          <button
            class='play-button {{if this.isPlaying "playing" ""}}'
            type='button'
            {{on 'click' this.togglePlay}}
          >
            {{#if this.isPlaying}}
              <svg viewBox='0 0 24 24' fill='currentColor'>
                <rect x='6' y='4' width='4' height='16' />
                <rect x='14' y='4' width='4' height='16' />
              </svg>
            {{else}}
              <svg viewBox='0 0 24 24' fill='currentColor'>
                <path d='M8 5v14l11-7z' />
              </svg>
            {{/if}}
          </button>
        {{else}}
          <div class='unavailable-button' title='Audio not available'>
            <svg viewBox='0 0 24 24' fill='currentColor'>
              <path d='M8 5v14l11-7z' />
              <line
                x1='1'
                y1='1'
                x2='23'
                y2='23'
                stroke='currentColor'
                stroke-width='2'
              />
            </svg>
          </div>
          <span class='unavailable-text'>Audio unavailable</span>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .song-card {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        background: white;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        transition: all 0.2s ease;
        position: relative;
        z-index: 10; /* Ensure controls are above overlays */
      }

      .song-card:hover {
        border-color: #3b82f6;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
        transform: translateY(-1px);
      }

      .song-cover,
      .song-cover-placeholder {
        width: 48px;
        height: 48px;
        border-radius: 6px;
        flex-shrink: 0;
      }

      .song-cover-placeholder {
        background: linear-gradient(135deg, #667eea, #764ba2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .song-cover-placeholder svg {
        width: 24px;
        height: 24px;
      }

      .song-info {
        flex: 1;
        min-width: 0;
      }

      .song-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.25rem;
      }

      .song-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      .explicit-tag {
        background: #ef4444;
        color: white;
        font-size: 0.625rem;
        font-weight: 700;
        padding: 0.125rem 0.25rem;
        border-radius: 2px;
        line-height: 1;
      }

      .song-duration {
        font-size: 0.75rem;
        color: #9ca3af;
        flex-shrink: 0;
      }

      .song-artist {
        font-size: 0.75rem;
        color: #6b7280;
        margin: 0 0 0.125rem 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .song-album {
        font-size: 0.625rem;
        color: #9ca3af;
        margin: 0 0 0.5rem 0;
        font-style: italic;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .song-metadata {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.25rem;
      }

      .genre-badge {
        background: #f3f4f6;
        color: #374151;
        font-size: 0.625rem;
        font-weight: 500;
        padding: 0.125rem 0.375rem;
        border-radius: 12px;
      }

      .play-count {
        font-size: 0.625rem;
        color: #9ca3af;
      }

      /* Playback Progress */
      .playback-progress {
        margin: 0.5rem 0;
        padding: 0.5rem;
        background: #f8fafc;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }

      .time-display {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.25rem;
        font-size: 0.625rem;
        color: #6b7280;
        font-weight: 600;
      }

      .progress-track {
        width: 100%;
        height: 6px;
        background: #e5e7eb;
        border-radius: 3px;
        overflow: hidden;
        position: relative;
      }

      .progress-fill-playback {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6, #1d4ed8);
        border-radius: 3px;
        transition: width 0.1s linear;
        box-shadow: 0 0 4px rgba(59, 130, 246, 0.4);
      }

      .song-controls {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .play-button {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        z-index: 20; /* Ensure buttons are clickable */
        pointer-events: auto; /* Force pointer events */
      }

      .play-button:focus {
        outline: 2px solid #3b82f6;
        outline-offset: 2px;
      }

      .play-button:hover {
        background: #3b82f6;
        color: white;
      }

      .play-button.playing {
        background: #3b82f6;
        color: white;
      }

      .play-button svg {
        width: 14px;
        height: 14px;
      }

      .unavailable-button {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f3f4f6;
        border: none;
        cursor: not-allowed;
        opacity: 0.5;
        position: relative;
      }

      .unavailable-button svg {
        width: 14px;
        height: 14px;
        color: #9ca3af;
      }

      .unavailable-text {
        font-size: 0.625rem;
        color: #9ca3af;
        font-style: italic;
        margin-left: 0.5rem;
      }
    </style>
  </template>
}

export class SongCard extends CardDef {
  static displayName = 'Song';
  static icon = MusicIcon;

  @field songTitle = contains(StringField);
  @field artist = contains(StringField);
  @field duration = contains(StringField);
  @field genre = contains(StringField);
  @field audioUrl = contains(UrlField);
  @field coverArtUrl = contains(UrlField);
  @field isExplicit = contains(BooleanField);

  @field title = contains(StringField, {
    computeVia: function (this: SongCard) {
      try {
        const song = this.songTitle ?? 'Untitled';
        const artist = this.artist ?? 'Unknown Artist';
        return `${song} - ${artist}`;
      } catch (e) {
        console.error('SongCard: Error computing title', e);
        return 'Untitled Song';
      }
    },
  });

  static embedded = SongEmbedded;
}
