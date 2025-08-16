import { fn, concat } from '@ember/helper';
import {
  CardDef,
  field,
  contains,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import UrlField from 'https://cardstack.com/base/url';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import TextAreaField from 'https://cardstack.com/base/text-area';
import MusicIcon from '@cardstack/boxel-icons/music';
import { and, gt, eq, add } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { SongCard } from '../song/song';

class PlaylistEmbedded extends Component<typeof PlaylistCard> {
  @tracked isFollowing = false;

  @action
  toggleFollow(event: Event) {
    event.stopPropagation();
    event.preventDefault();

    this.isFollowing = !this.isFollowing;
    console.log(
      `${this.isFollowing ? 'Following' : 'Unfollowed'} playlist: ${
        this.args.model?.playlistName
      }`,
    );
  }

  @action
  sharePlaylist(event: Event) {
    event.stopPropagation();
    event.preventDefault();

    console.log(`Sharing playlist: ${this.args.model?.playlistName}`);
  }

  <template>
    <div class='compact-playlist-card'>
      <div class='compact-cover'>
        {{#if @model.coverImageUrl}}
          <img
            src={{@model.coverImageUrl}}
            alt='Playlist cover'
            class='compact-cover-image'
          />
        {{else}}
          <div class='compact-cover-placeholder'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
              <circle cx='9' cy='9' r='2' />
              <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
            </svg>
          </div>
        {{/if}}

        <div class='compact-overlay'>
          <div class='playlist-info-overlay'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <circle cx='12' cy='12' r='3' />
            </svg>
            <span>Click to view playlist</span>
          </div>
        </div>

        {{#if @model.mood}}
          <span class='compact-mood-badge'>{{@model.mood}}</span>
        {{/if}}
      </div>

      <div class='compact-info'>
        <h4 class='compact-name'>{{if
            @model.playlistName
            @model.playlistName
            'Untitled Playlist'
          }}</h4>

        {{#if @model.description}}
          <p class='compact-description'>{{@model.description}}</p>
        {{/if}}

        <div class='compact-stats'>
          {{#if @model.songCount}}
            <span class='stat-item'>{{@model.songCount}} songs</span>
          {{/if}}
          {{#if (and @model.songCount (Number @model.duration))}}
            <span class='stat-separator'>•</span>
          {{/if}}
          {{#if @model.duration}}
            <span class='stat-item'>{{@model.duration}}</span>
          {{/if}}
        </div>

        {{#if @model.curator}}
          <div class='compact-curator'>by {{@model.curator}}</div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .compact-playlist-card {
        background: white;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: all 0.2s ease;
        height: 180px;
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      .compact-playlist-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
      }

      .compact-cover {
        position: relative;
        width: 100%;
        height: 140px;
        overflow: hidden;
      }

      .compact-cover-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .compact-cover-placeholder {
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .compact-cover-placeholder svg {
        width: 32px;
        height: 32px;
      }

      .compact-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .compact-playlist-card:hover .compact-overlay {
        opacity: 1;
      }

      .playlist-info-overlay {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        color: white;
        text-align: center;
      }

      .playlist-info-overlay svg {
        width: 24px;
        height: 24px;
      }

      .playlist-info-overlay span {
        font-size: 0.75rem;
        font-weight: 500;
      }

      .compact-mood-badge {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 0.625rem;
        font-weight: 600;
        padding: 0.125rem 0.375rem;
        border-radius: 8px;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .compact-info {
        padding: 0.75rem;
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .compact-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0 0 0.375rem 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .compact-description {
        font-size: 0.75rem;
        color: #6b7280;
        margin: 0 0 0.5rem 0;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        flex: 1;
      }

      .compact-stats {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.625rem;
        color: #9ca3af;
        margin-bottom: 0.375rem;
      }

      .stat-separator {
        margin: 0 0.125rem;
      }

      .compact-curator {
        font-size: 0.625rem;
        color: #9ca3af;
        font-style: italic;
        margin-top: auto;
      }
    </style>
  </template>
}

class PlaylistIsolated extends Component<typeof PlaylistCard> {
  @tracked isPlaying = false;
  @tracked isShuffled = false;
  @tracked isRepeat = false;
  @tracked currentSongIndex = 0;
  @tracked currentTime = 0;
  @tracked duration = 0;
  @tracked progress = 0;
  private audioElement: HTMLAudioElement | null = null;
  private progressInterval: number | null = null;

  @action
  togglePlay(event: Event) {
    event.stopPropagation();
    event.preventDefault();

    const songs = this.args.model?.songs;
    if (!songs || songs.length === 0) {
      console.log('No songs in playlist');
      return;
    }

    const currentSong = songs[this.currentSongIndex];
    if (!currentSong?.audioUrl) {
      console.log('No audio URL for current song');
      return;
    }

    if (!this.audioElement || this.audioElement.src !== currentSong.audioUrl) {
      if (this.audioElement) {
        this.audioElement.pause();
      }
      this.audioElement = new Audio(currentSong.audioUrl);
      this.audioElement.volume = 0.7;

      this.audioElement.addEventListener('ended', () => {
        if (this.isRepeat) {
          this.audioElement?.play();
        } else {
          this.playNextSong();
        }
      });

      this.audioElement.addEventListener('error', (e) => {
        console.error('Playlist audio error:', e);
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
      console.log(`Paused playlist: ${this.args.model?.playlistName}`);
    } else {
      this.audioElement
        .play()
        .then(() => {
          this.isPlaying = true;
          this.startProgressTracking();
          console.log(
            `Playing playlist: ${this.args.model?.playlistName} - ${currentSong.songTitle}`,
          );
        })
        .catch((error) => {
          console.error('Playlist playback failed:', error);
          this.isPlaying = false;
          this.stopProgressTracking();
        });
    }
  }

  @action
  playNextSong() {
    const songs = this.args.model?.songs;
    if (!songs || songs.length === 0) return;

    if (this.isShuffled) {
      this.currentSongIndex = Math.floor(Math.random() * songs.length);
    } else {
      this.currentSongIndex = (this.currentSongIndex + 1) % songs.length;
    }

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }

    if (this.isPlaying) {
      setTimeout(() => this.togglePlay(new Event('click')), 100);
    }
  }

  @action
  playPreviousSong() {
    const songs = this.args.model?.songs;
    if (!songs || songs.length === 0) return;

    this.currentSongIndex =
      this.currentSongIndex === 0
        ? songs.length - 1
        : this.currentSongIndex - 1;

    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }

    if (this.isPlaying) {
      setTimeout(() => this.togglePlay(new Event('click')), 100);
    }
  }

  @action
  playSongAtIndex(index: number) {
    this.currentSongIndex = index;
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }
    setTimeout(() => this.togglePlay(new Event('click')), 100);
  }

  @action
  toggleShuffle() {
    this.isShuffled = !this.isShuffled;
  }

  @action
  toggleRepeat() {
    this.isRepeat = !this.isRepeat;
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

  get currentSong() {
    const songs = this.args.model?.songs;
    if (!songs || songs.length === 0) return null;
    return songs[this.currentSongIndex];
  }

  willDestroy() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement = null;
    }
    this.stopProgressTracking();
    super.willDestroy();
  }

  <template>
    <div class='stage'>
      <div class='playlist-mat'>
        <header class='playlist-header'>
          <div class='playlist-cover-section'>
            {{#if @model.coverImageUrl}}
              <img
                src={{@model.coverImageUrl}}
                alt='Playlist cover'
                class='playlist-cover-large'
              />
            {{else}}
              <div class='playlist-cover-large-placeholder'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                  <circle cx='9' cy='9' r='2' />
                  <path d='M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21' />
                </svg>
              </div>
            {{/if}}
          </div>

          <div class='playlist-info-section'>
            <div class='playlist-type'>PLAYLIST</div>
            <h1 class='playlist-title'>{{if
                @model.playlistName
                @model.playlistName
                'Untitled Playlist'
              }}</h1>

            {{#if @model.description}}
              <p class='playlist-description'>{{@model.description}}</p>
            {{/if}}

            <div class='playlist-meta'>
              {{#if @model.curator}}
                <span class='curator'>{{@model.curator}}</span>
              {{/if}}
              {{#if @model.songCount}}
                <span class='song-count'>{{@model.songCount}} songs</span>
              {{/if}}
              {{#if @model.duration}}
                <span class='duration'>{{@model.duration}}</span>
              {{/if}}
            </div>
          </div>
        </header>

        <div class='playback-controls'>
          <button
            class='control-btn play-btn {{if this.isPlaying "playing" ""}}'
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

          <button class='control-btn' {{on 'click' this.playPreviousSong}}>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polygon points='19,20 9,12 19,4' />
              <line x1='5' y1='19' x2='5' y2='5' />
            </svg>
          </button>

          <button class='control-btn' {{on 'click' this.playNextSong}}>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polygon points='5,4 15,12 5,20' />
              <line x1='19' y1='5' x2='19' y2='19' />
            </svg>
          </button>

          <button
            class='control-btn {{if this.isShuffled "active" ""}}'
            {{on 'click' this.toggleShuffle}}
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polyline points='16,3 21,3 21,8' />
              <line x1='4' y1='20' x2='21' y2='3' />
              <polyline points='21,16 21,21 16,21' />
              <line x1='15' y1='15' x2='21' y2='21' />
              <line x1='4' y1='4' x2='9' y2='9' />
            </svg>
          </button>

          <button
            class='control-btn {{if this.isRepeat "active" ""}}'
            {{on 'click' this.toggleRepeat}}
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <polyline points='17,1 21,5 17,9' />
              <path d='M3 11V9a4 4 0 0 1 4-4h14' />
              <polyline points='7,23 3,19 7,15' />
              <path d='M21 13v2a4 4 0 0 1-4 4H3' />
            </svg>
          </button>
        </div>

        {{#if this.currentSong}}
          <div class='current-song-info'>
            <div class='current-song-details'>
              <h3 class='current-song-title'>{{this.currentSong.songTitle}}</h3>
              <p class='current-song-artist'>{{this.currentSong.artist}}</p>
            </div>

            {{#if this.isPlaying}}
              <div class='progress-section'>
                <div class='time-info'>
                  <span class='current-time'>{{this.formatTime
                      this.currentTime
                    }}</span>
                  <span class='total-time'>{{if
                      this.currentSong.duration
                      this.currentSong.duration
                      (this.formatTime this.duration)
                    }}</span>
                </div>
                <div class='progress-bar-container'>
                  <div class='progress-bar-track'>
                    <div
                      class='progress-bar-fill'
                      style={{htmlSafe (concat 'width: ' this.progress '%')}}
                    ></div>
                  </div>
                </div>
              </div>
            {{/if}}
          </div>
        {{/if}}

        {{#if (gt @model.songs.length 0)}}
          <div class='songs-section'>
            <h2 class='songs-header'>Songs</h2>
            <div class='songs-list'>
              {{#each @model.songs as |song index|}}
                <button
                  class='song-item
                    {{if (eq index this.currentSongIndex) "current" ""}}'
                  {{on 'click' (fn this.playSongAtIndex index)}}
                >
                  <div class='song-number'>
                    {{#if (eq index this.currentSongIndex)}}
                      {{#if this.isPlaying}}
                        <svg
                          viewBox='0 0 24 24'
                          fill='currentColor'
                          class='playing-icon'
                        >
                          <rect x='6' y='4' width='4' height='16' />
                          <rect x='14' y='4' width='4' height='16' />
                        </svg>
                      {{else}}
                        <svg
                          viewBox='0 0 24 24'
                          fill='currentColor'
                          class='play-icon'
                        >
                          <path d='M8 5v14l11-7z' />
                        </svg>
                      {{/if}}
                    {{else}}
                      {{add index 1}}
                    {{/if}}
                  </div>
                  <div class='song-info-list'>
                    <div class='song-title-list'>{{song.songTitle}}</div>
                    <div class='song-artist-list'>{{song.artist}}</div>
                  </div>
                  <div class='song-duration-list'>{{song.duration}}</div>
                </button>
              {{/each}}
            </div>
          </div>
        {{else}}
          <div class='empty-playlist'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <line x1='12' y1='8' x2='12' y2='12' />
              <line x1='12' y1='16' x2='12.01' y2='16' />
            </svg>
            <h3>No songs in this playlist</h3>
            <p>Add some songs to get started!</p>
          </div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        padding: 0.5rem;
        background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      }

      @media (max-width: 800px) {
        .stage {
          padding: 0;
        }
      }

      .playlist-mat {
        max-width: 75rem;
        width: 100%;
        background: #f8fafc;
        border-radius: 16px;
        overflow-y: auto;
        max-height: 100%;
        font-family:
          'Inter',
          -apple-system,
          sans-serif;
      }

      @media (max-width: 800px) {
        .playlist-mat {
          max-width: none;
          height: 100%;
          border-radius: 0;
        }
      }

      .playlist-header {
        display: flex;
        align-items: flex-end;
        gap: 2rem;
        padding: 2rem;
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        color: white;
      }

      @media (max-width: 768px) {
        .playlist-header {
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 1.5rem;
        }
      }

      .playlist-cover-large,
      .playlist-cover-large-placeholder {
        width: 200px;
        height: 200px;
        border-radius: 8px;
        flex-shrink: 0;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      }

      .playlist-cover-large-placeholder {
        background: rgba(255, 255, 255, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .playlist-cover-large-placeholder svg {
        width: 64px;
        height: 64px;
      }

      .playlist-type {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 0.5rem;
        opacity: 0.9;
      }

      .playlist-title {
        font-size: 3rem;
        font-weight: 900;
        margin: 0 0 1rem 0;
        line-height: 1.1;
      }

      @media (max-width: 768px) {
        .playlist-title {
          font-size: 2rem;
        }
      }

      .playlist-description {
        font-size: 1rem;
        margin: 0 0 1rem 0;
        opacity: 0.9;
        line-height: 1.5;
      }

      .playlist-meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        opacity: 0.9;
      }

      .playlist-meta > *:not(:last-child)::after {
        content: '•';
        margin-left: 0.5rem;
        opacity: 0.7;
      }

      .playback-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 2rem;
        border-bottom: 1px solid #e2e8f0;
      }

      .control-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f1f5f9;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        color: #475569;
      }

      .control-btn:hover {
        background: #e2e8f0;
        transform: scale(1.05);
      }

      .control-btn.active {
        background: #3b82f6;
        color: white;
      }

      .play-btn {
        width: 56px;
        height: 56px;
        background: #3b82f6;
        color: white;
      }

      .play-btn:hover {
        background: #2563eb;
      }

      .play-btn.playing {
        background: #10b981;
      }

      .control-btn svg {
        width: 20px;
        height: 20px;
      }

      .play-btn svg {
        width: 24px;
        height: 24px;
      }

      .current-song-info {
        padding: 1.5rem 2rem;
        border-bottom: 1px solid #e2e8f0;
        background: #f8fafc;
      }

      .current-song-title {
        font-size: 1.25rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0 0 0.25rem 0;
      }

      .current-song-artist {
        font-size: 1rem;
        color: #6b7280;
        margin: 0 0 1rem 0;
      }

      .progress-section {
        margin-top: 1rem;
      }

      .time-info {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: #6b7280;
        margin-bottom: 0.5rem;
      }

      .progress-bar-container {
        width: 100%;
      }

      .progress-bar-track {
        width: 100%;
        height: 6px;
        background: #e5e7eb;
        border-radius: 3px;
        overflow: hidden;
      }

      .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #3b82f6, #1d4ed8);
        border-radius: 3px;
        transition: width 0.1s linear;
      }

      .songs-section {
        padding: 2rem;
      }

      .songs-header {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1f2937;
        margin: 0 0 1.5rem 0;
      }

      .song-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.75rem;
        border-radius: 8px;
        cursor: pointer;
        border: none;
        background: none;
      }

      .song-item:hover {
        background: #f1f5f9;
      }

      .song-item.current {
        background: #eff6ff;
        color: #3b82f6;
      }

      .song-number {
        width: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.875rem;
        font-weight: 500;
        color: #6b7280;
      }

      .song-item.current .song-number {
        color: #3b82f6;
      }

      .playing-icon,
      .play-icon {
        width: 14px;
        height: 14px;
      }

      .song-info-list {
        flex: 1;
        min-width: 0;
      }

      .song-title-list {
        font-size: 0.875rem;
        font-weight: 500;
        color: #1f2937;
        margin-bottom: 0.25rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .song-item.current .song-title-list {
        color: #3b82f6;
      }

      .song-artist-list {
        font-size: 0.75rem;
        color: #6b7280;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .song-duration-list {
        font-size: 0.75rem;
        color: #9ca3af;
        flex-shrink: 0;
      }

      .empty-playlist {
        text-align: center;
        padding: 4rem 2rem;
        color: #6b7280;
      }

      .empty-playlist svg {
        width: 64px;
        height: 64px;
        margin: 0 auto 1rem auto;
        color: #cbd5e1;
      }

      .empty-playlist h3 {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0 0 0.5rem 0;
      }

      .empty-playlist p {
        font-size: 1rem;
        margin: 0;
      }
    </style>
  </template>
}

export class PlaylistCard extends CardDef {
  static displayName = 'Playlist';
  static icon = MusicIcon;

  @field playlistName = contains(StringField);
  @field description = contains(TextAreaField);
  @field coverImageUrl = contains(UrlField);
  @field songCount = contains(NumberField, {
    computeVia: function (this: PlaylistCard) {
      try {
        return this.songs?.length ?? 0;
      } catch (e) {
        console.error('PlaylistCard: Error computing song count', e);
        return 0;
      }
    },
  });
  @field duration = contains(StringField, {
    computeVia: function (this: PlaylistCard) {
      try {
        const songs = this.songs;
        if (!songs || songs.length === 0) return '0m';

        // For now return estimated duration based on song count
        // In a real app, you'd sum actual song durations
        const avgSongDuration = 3.5; // minutes
        const totalMinutes = Math.round(songs.length * avgSongDuration);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        if (hours > 0) {
          return `${hours}h ${minutes}m`;
        } else {
          return `${minutes}m`;
        }
      } catch (e) {
        console.error('PlaylistCard: Error computing duration', e);
        return '0m';
      }
    },
  });
  @field curator = contains(StringField);
  @field mood = contains(StringField);
  @field isPublic = contains(BooleanField);
  @field isCollaborative = contains(BooleanField);
  @field createdDate = contains(DateField);
  @field lastUpdated = contains(DateField);
  @field followers = contains(NumberField);
  @field totalPlays = contains(NumberField);
  @field songs = linksToMany(() => SongCard);
  @field tags = contains(StringField); // Comma-separated tags
  @field averageEnergy = contains(NumberField); // Computed from songs
  @field averageDanceability = contains(NumberField); // Computed from songs

  @field title = contains(StringField, {
    computeVia: function (this: PlaylistCard) {
      try {
        return this.playlistName ?? 'Untitled Playlist';
      } catch (e) {
        console.error('PlaylistCard: Error computing title', e);
        return 'Untitled Playlist';
      }
    },
  });

  static isolated = PlaylistIsolated;
  static embedded = PlaylistEmbedded;
}
