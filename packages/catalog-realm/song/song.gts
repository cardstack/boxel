import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import UrlField from 'https://cardstack.com/base/url';
import BooleanField from 'https://cardstack.com/base/boolean';
import { concat } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import { Song } from '../base-entity/song';

class SongIsolated extends Component<typeof SongCard> {
  @tracked isPlaying = false;
  @tracked currentTime = 0;
  @tracked duration = 0;
  @tracked progress = 0;
  @tracked volume = 0.7;
  @tracked isMuted = false;
  @tracked showVolumeSlider = false;

  private audioElement: HTMLAudioElement | null = null;
  private progressInterval: number | null = null;

  @action
  togglePlay(event: Event) {
    event.stopPropagation();
    event.preventDefault();

    if (!this.args.model?.audioUrl) {
      console.log('No audio URL available for this song');
      return;
    }

    if (!this.audioElement) {
      this.audioElement = new Audio(this.args.model.audioUrl);
      this.audioElement.volume = this.volume;

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
    } else {
      this.audioElement
        .play()
        .then(() => {
          this.isPlaying = true;
          this.startProgressTracking();
        })
        .catch((error) => {
          console.error('Audio playback failed:', error);
          this.isPlaying = false;
          this.stopProgressTracking();
        });
    }
  }

  @action
  toggleMute() {
    if (this.audioElement) {
      this.isMuted = !this.isMuted;
      this.audioElement.muted = this.isMuted;
    }
  }

  @action
  updateVolume(event: Event) {
    const target = event.target as HTMLInputElement;
    this.volume = parseFloat(target.value);
    if (this.audioElement) {
      this.audioElement.volume = this.volume;
    }
  }

  @action
  seekTo(event: Event) {
    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    const clickX = (event as MouseEvent).clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * this.duration;

    if (this.audioElement && this.duration > 0) {
      this.audioElement.currentTime = newTime;
      this.currentTime = newTime;
      this.progress = percentage * 100;
    }
  }

  @action
  toggleVolumeSlider() {
    this.showVolumeSlider = !this.showVolumeSlider;
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
    <div class='song-isolated'>
      <div class='song-hero'>
        <div class='hero-content'>
          <div class='album-art-container'>
            {{#if @model.coverArtUrl}}
              <img
                src={{@model.coverArtUrl}}
                alt='{{@model.songTitle}} cover art'
                class='album-art'
              />
            {{else}}
              <div class='album-art-placeholder'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.5'
                >
                  <circle cx='12' cy='12' r='10' />
                  <circle cx='12' cy='12' r='3' />
                  <path
                    d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z'
                  />
                </svg>
              </div>
            {{/if}}

            <div class='play-overlay'>
              {{#if @model.audioUrl}}
                <button
                  class='hero-play-button {{if this.isPlaying "playing" ""}}'
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
                <div class='hero-unavailable'>
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
                  <span>Audio unavailable</span>
                </div>
              {{/if}}
            </div>
          </div>

          <div class='song-details'>
            <div class='song-header'>
              <h1 class='song-title-large'>{{if
                  @model.songTitle
                  @model.songTitle
                  'Untitled Song'
                }}</h1>
              {{#if @model.isExplicit}}
                <span class='explicit-badge'>EXPLICIT</span>
              {{/if}}
            </div>

            <h2 class='artist-name'>{{if
                @model.artist
                @model.artist
                'Unknown Artist'
              }}</h2>

            <div class='song-meta'>
              {{#if @model.genre}}
                <span class='genre-tag'>{{@model.genre}}</span>
              {{/if}}
              {{#if @model.duration}}
                <span class='duration-display'>{{@model.duration}}</span>
              {{/if}}
            </div>

            {{#if @model.audioUrl}}
              <div class='player-section'>
                <div class='progress-section'>
                  <div class='time-labels'>
                    <span class='current-time'>{{this.formatTime
                        this.currentTime
                      }}</span>
                    <span class='total-time'>{{if
                        this.duration
                        (this.formatTime this.duration)
                        @model.duration
                      }}</span>
                  </div>
                  <button class='progress-bar' {{on 'click' this.seekTo}}>
                    <div class='progress-track'>
                      <div
                        class='progress-fill'
                        style={{htmlSafe (concat 'width: ' this.progress '%')}}
                      ></div>
                      <div
                        class='progress-handle'
                        style={{htmlSafe (concat 'left: ' this.progress '%')}}
                      ></div>
                    </div>
                  </button>
                </div>

                <div class='player-controls'>
                  <button class='control-btn' {{on 'click' this.togglePlay}}>
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

                  <div class='volume-control'>
                    <button
                      class='control-btn volume-btn'
                      {{on 'click' this.toggleVolumeSlider}}
                    >
                      {{#if this.isMuted}}
                        <svg
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
                          <line x1='23' y1='9' x2='17' y2='15' />
                          <line x1='17' y1='9' x2='23' y2='15' />
                        </svg>
                      {{else}}
                        <svg
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          stroke-width='2'
                        >
                          <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
                          <path
                            d='M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07'
                          />
                        </svg>
                      {{/if}}
                    </button>

                    {{#if this.showVolumeSlider}}
                      <div class='volume-slider-container'>
                        <label
                          for='volume-slider'
                          class='sr-only'
                        >Volume</label>
                        <input
                          type='range'
                          min='0'
                          max='1'
                          step='0.1'
                          value={{this.volume}}
                          id='volume-slider'
                          class='volume-slider'
                          {{on 'input' this.updateVolume}}
                        />
                      </div>
                    {{/if}}
                  </div>
                </div>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <div class='song-info-section'>
        <div class='info-content'>
          <div class='info-card'>
            <h3>Song Details</h3>
            <div class='detail-grid'>
              <div class='detail-item'>
                <span class='detail-label'>Title:</span>
                <span class='detail-value'>{{if
                    @model.songTitle
                    @model.songTitle
                    'Unknown'
                  }}</span>
              </div>
              <div class='detail-item'>
                <span class='detail-label'>Artist:</span>
                <span class='detail-value'>{{if
                    @model.artist
                    @model.artist
                    'Unknown Artist'
                  }}</span>
              </div>
              <div class='detail-item'>
                <span class='detail-label'>Genre:</span>
                <span class='detail-value'>{{if
                    @model.genre
                    @model.genre
                    'Unknown'
                  }}</span>
              </div>
              <div class='detail-item'>
                <span class='detail-label'>Duration:</span>
                <span class='detail-value'>{{if
                    @model.duration
                    @model.duration
                    'Unknown'
                  }}</span>
              </div>
              <div class='detail-item'>
                <span class='detail-label'>Explicit:</span>
                <span class='detail-value'>{{if
                    @model.isExplicit
                    'Yes'
                    'No'
                  }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .song-isolated {
        min-height: 100vh;
        background: linear-gradient(
          135deg,
          #1e1b4b 0%,
          #312e81 50%,
          #1e1b4b 100%
        );
        color: white;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
      }

      .song-hero {
        padding: 3rem 2rem;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.1) 0%,
          rgba(147, 51, 234, 0.1) 100%
        );
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .hero-content {
        max-width: 1200px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 300px 1fr;
        gap: 3rem;
        align-items: center;
      }

      .album-art-container {
        position: relative;
        width: 300px;
        height: 300px;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      }

      .album-art {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .album-art-placeholder {
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .album-art-placeholder svg {
        width: 80px;
        height: 80px;
        color: rgba(255, 255, 255, 0.7);
      }

      .play-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .album-art-container:hover .play-overlay {
        opacity: 1;
      }

      .hero-play-button {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.9);
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
      }

      .hero-play-button:hover {
        background: white;
        transform: scale(1.05);
      }

      .hero-play-button.playing {
        background: #3b82f6;
        color: white;
      }

      .hero-play-button svg {
        width: 32px;
        height: 32px;
        color: inherit;
      }

      .hero-unavailable {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        color: rgba(255, 255, 255, 0.6);
      }

      .hero-unavailable svg {
        width: 48px;
        height: 48px;
      }

      .song-details {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .song-header {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .song-title-large {
        font-size: 3rem;
        font-weight: 800;
        margin: 0;
        line-height: 1.1;
        background: linear-gradient(135deg, #ffffff 0%, #e0e7ff 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .explicit-badge {
        background: #ef4444;
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.05em;
      }

      .artist-name {
        font-size: 1.5rem;
        font-weight: 600;
        margin: 0;
        color: rgba(255, 255, 255, 0.8);
      }

      .song-meta {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .genre-tag {
        background: rgba(59, 130, 246, 0.2);
        color: #93c5fd;
        padding: 0.375rem 0.75rem;
        border-radius: 20px;
        font-size: 0.875rem;
        font-weight: 500;
        border: 1px solid rgba(59, 130, 246, 0.3);
      }

      .duration-display {
        color: rgba(255, 255, 255, 0.7);
        font-size: 0.875rem;
        font-weight: 500;
      }

      .player-section {
        background: rgba(255, 255, 255, 0.1);
        padding: 1.5rem;
        border-radius: 12px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .progress-section {
        margin-bottom: 1rem;
      }

      .time-labels {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.5rem;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.7);
        font-weight: 500;
      }

      .progress-bar {
        cursor: pointer;
        padding: 0.5rem 0;
        border: none;
        background: none;
        width: 100%;
        height: 100%;
      }

      .progress-track {
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
        position: relative;
        overflow: visible;
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6, #1d4ed8);
        border-radius: 3px;
        transition: width 0.1s linear;
      }

      .progress-handle {
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 14px;
        height: 14px;
        background: white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        transition: left 0.1s linear;
      }

      .player-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .control-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
      }

      .control-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: scale(1.05);
      }

      .control-btn svg {
        width: 20px;
        height: 20px;
      }

      .volume-control {
        position: relative;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .volume-slider-container {
        position: absolute;
        left: 100%;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0, 0, 0, 0.8);
        padding: 0.5rem 1rem;
        border-radius: 8px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .volume-slider {
        width: 80px;
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
        outline: none;
        -webkit-appearance: none;
      }

      .volume-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        background: #3b82f6;
        border-radius: 50%;
        cursor: pointer;
      }

      .song-info-section {
        padding: 2rem;
        background: rgba(0, 0, 0, 0.2);
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }

      .info-content {
        max-width: 1200px;
        margin: 0 auto;
      }

      .info-card {
        background: rgba(255, 255, 255, 0.1);
        padding: 2rem;
        border-radius: 12px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .info-card h3 {
        font-size: 1.5rem;
        font-weight: 700;
        margin: 0 0 1.5rem 0;
        color: white;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
      }

      .detail-item {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .detail-label {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .detail-value {
        font-size: 1rem;
        color: white;
        font-weight: 500;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .hero-content {
          grid-template-columns: 1fr;
          gap: 2rem;
          text-align: center;
        }

        .album-art-container {
          width: 250px;
          height: 250px;
          margin: 0 auto;
        }

        .song-title-large {
          font-size: 2rem;
        }

        .detail-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

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

export class SongCard extends Song {
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
        return 'Untitled Song';
      }
    },
  });

  static embedded = SongEmbedded;
  static isolated = SongIsolated;
}
