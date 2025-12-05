// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import NumberField from '../fields/number'; // ² Import catalog number field
import DateField from '../fields/date'; // ³ Import catalog date field
import AudioField from '../fields/audio'; // ⁴ Import catalog audio field with waveform
import ImageField from '../fields/image'; // ⁵ Import catalog image field for album art
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { formatDuration, gt } from '@cardstack/boxel-ui/helpers';
import { Button, Pill } from '@cardstack/boxel-ui/components';
import MusicIcon from '@cardstack/boxel-icons/music';

class IsolatedTemplate extends Component<typeof SpotifyTrack> {
  // ¹² Isolated format
  @tracked isLiked = false;
  @tracked isInPlaylist = false;

  @action
  toggleLike() {
    this.isLiked = !this.isLiked;
  }

  @action
  addToPlaylist() {
    this.isInPlaylist = true;
    setTimeout(() => {
      this.isInPlaylist = false;
    }, 2000);
  }

  get formattedPlayCount() {
    const count = this.args.model?.playCount ?? 0;
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  }

  <template>
    <div class='spotify-track-isolated'>
      <div class='track-container'>
        <div class='album-art-section'>
          {{#if @model.albumArt}}
            <div class='album-art-wrapper'>
              <@fields.albumArt @format='embedded' />
            </div>
          {{else}}
            <div class='album-art-placeholder'>
              <svg
                class='music-placeholder-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='1.5'
              >
                <circle cx='12' cy='12' r='10' />
                <path d='M9 18V5l12-2v13' />
                <circle cx='6' cy='18' r='3' />
                <circle cx='18' cy='16' r='3' />
              </svg>
            </div>
          {{/if}}

          <div class='quick-actions'>
            <Button
              class='like-btn {{if this.isLiked "liked" ""}}'
              @kind='ghost'
              {{on 'click' this.toggleLike}}
            >
              <svg
                class='heart-icon'
                viewBox='0 0 24 24'
                fill='{{if this.isLiked "currentColor" "none"}}'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'
                />
              </svg>
              {{if this.isLiked 'Liked' 'Like'}}
            </Button>

            <Button
              class='playlist-btn {{if this.isInPlaylist "added" ""}}'
              @kind='ghost'
              {{on 'click' this.addToPlaylist}}
            >
              <svg
                class='plus-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                {{#if this.isInPlaylist}}
                  <polyline points='20 6 9 17 4 12' />
                {{else}}
                  <line x1='12' y1='5' x2='12' y2='19' />
                  <line x1='5' y1='12' x2='19' y2='12' />
                {{/if}}
              </svg>
              {{if this.isInPlaylist 'Added' 'Add to Playlist'}}
            </Button>
          </div>
        </div>

        <div class='track-details'>
          <div class='track-header'>
            <div class='title-section'>
              <h1 class='track-name'>{{if
                  @model.trackName
                  @model.trackName
                  'Untitled Track'
                }}</h1>
              <h2 class='artist-name'>{{if
                  @model.artist
                  @model.artist
                  'Unknown Artist'
                }}</h2>
            </div>

            <div class='metadata-row'>
              {{#if @model.album}}
                <span class='album-badge'>
                  <svg
                    class='album-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                    <circle cx='8.5' cy='8.5' r='1.5' />
                    <polyline points='21 15 16 10 5 21' />
                  </svg>
                  {{@model.album}}
                </span>
              {{/if}}

              {{#if @model.releaseDate}}
                <span class='release-date'>
                  <@fields.releaseDate @format='embedded' />
                </span>
              {{/if}}
            </div>

            {{#if (gt @model.tags.length 0)}}
              <div class='tags-row'>
                {{#each @model.tags as |tag|}}
                  <Pill class='genre-tag'>{{tag}}</Pill>
                {{/each}}
              </div>
            {{/if}}
          </div>

          {{#if @model.audioFile}}
            <div class='audio-player-section'>
              <@fields.audioFile @format='embedded' />
            </div>
          {{/if}}

          <div class='stats-section'>
            <div class='stat-item'>
              <svg
                class='stat-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <polygon points='5 3 19 12 5 21 5 3' fill='currentColor' />
              </svg>
              <div class='stat-content'>
                <span class='stat-value'>{{this.formattedPlayCount}}</span>
                <span class='stat-label'>plays</span>
              </div>
            </div>

            {{#if @model.likes}}
              <div class='stat-item'>
                <svg
                  class='stat-icon'
                  viewBox='0 0 24 24'
                  fill='currentColor'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'
                  />
                </svg>
                <div class='stat-content'>
                  <span class='stat-value'>{{@model.likes}}</span>
                  <span class='stat-label'>likes</span>
                </div>
              </div>
            {{/if}}

            {{#if @model.duration}}
              <div class='stat-item'>
                <svg
                  class='stat-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <polyline points='12 6 12 12 16 14' />
                </svg>
                <div class='stat-content'>
                  <span class='stat-value'>{{formatDuration
                      @model.duration
                      unit='seconds'
                      format='timer'
                    }}</span>
                  <span class='stat-label'>duration</span>
                </div>
              </div>
            {{/if}}
          </div>

          {{#if @model.description}}
            <div class='description'>
              <h3>About this track</h3>
              <p>{{@model.description}}</p>
            </div>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      /* ¹⁶ Themed isolated styles with Spotify aesthetic */
      .spotify-track-isolated {
        font-family: var(
          --font-sans,
          'Circular',
          'Helvetica Neue',
          system-ui,
          sans-serif
        );
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: linear-gradient(
          180deg,
          var(--primary, #1db954) 0%,
          var(--background, #121212) 35%
        );
        container-type: inline-size;
      }

      .track-container {
        max-width: 1400px;
        margin: 0 auto;
        padding: calc(var(--spacing, 0.25rem) * 12)
          calc(var(--spacing, 0.25rem) * 8);
        display: grid;
        grid-template-columns: 1fr;
        gap: calc(var(--spacing, 0.25rem) * 12);
      }

      @container (min-width: 768px) {
        .track-container {
          grid-template-columns: 400px 1fr;
          gap: calc(var(--spacing, 0.25rem) * 16);
        }
      }

      .album-art-section {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 6);
      }

      .album-art-wrapper {
        aspect-ratio: 1;
        border-radius: var(--radius, 8px);
        overflow: hidden;
        box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.5));
      }

      .album-art-placeholder {
        aspect-ratio: 1;
        background: linear-gradient(
          135deg,
          var(--muted, #282828) 0%,
          var(--card, #181818) 100%
        );
        border-radius: var(--radius, 8px);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.5));
      }

      .music-placeholder-icon {
        width: 6rem;
        height: 6rem;
        color: var(--muted-foreground, #535353);
      }

      .quick-actions {
        display: flex;
        gap: calc(var(--spacing, 0.25rem) * 3);
      }

      .like-btn,
      .playlist-btn {
        flex: 1;
        padding: calc(var(--spacing, 0.25rem) * 3)
          calc(var(--spacing, 0.25rem) * 4);
        font-size: 0.875rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid var(--border, rgba(255, 255, 255, 0.2));
        border-radius: 500px;
        color: var(--primary-foreground, white);
        cursor: pointer;
        transition: all 0.2s;
      }

      .like-btn:hover,
      .playlist-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: scale(1.04);
      }

      .like-btn.liked {
        background: var(--primary, #1db954);
        border-color: var(--primary, #1db954);
      }

      .playlist-btn.added {
        background: var(--primary, #1db954);
        border-color: var(--primary, #1db954);
      }

      .heart-icon,
      .plus-icon {
        width: 1rem;
        height: 1rem;
      }

      .track-details {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 8);
      }

      .track-header {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 6);
      }

      .title-section {
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .track-name {
        font-size: 3rem;
        font-weight: 900;
        color: var(--primary-foreground, white);
        margin: 0;
        line-height: 1.1;
        letter-spacing: -0.04em;
      }

      .artist-name {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--muted-foreground, #b3b3b3);
        margin: 0;
      }

      .metadata-row {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 4);
        flex-wrap: wrap;
      }

      .album-badge {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        padding: calc(var(--spacing, 0.25rem) * 2)
          calc(var(--spacing, 0.25rem) * 4);
        background: rgba(255, 255, 255, 0.1);
        border-radius: 500px;
        color: var(--primary-foreground, white);
        font-size: 0.875rem;
        font-weight: 600;
      }

      .album-icon {
        width: 1rem;
        height: 1rem;
      }

      .release-date {
        color: var(--muted-foreground, #b3b3b3);
        font-size: 0.875rem;
        font-weight: 500;
      }

      .tags-row {
        display: flex;
        gap: calc(var(--spacing, 0.25rem) * 2);
        flex-wrap: wrap;
      }

      .genre-tag {
        background: rgba(29, 185, 84, 0.2);
        color: var(--primary, #1db954);
        padding: calc(var(--spacing, 0.25rem) * 1.5)
          calc(var(--spacing, 0.25rem) * 3.5);
        border-radius: 500px;
        font-size: 0.75rem;
        font-weight: 700;
        border: 1px solid rgba(29, 185, 84, 0.3);
      }

      .audio-player-section {
        background: var(--card, rgba(255, 255, 255, 0.05));
        border-radius: var(--radius, 8px);
        padding: calc(var(--spacing, 0.25rem) * 6);
        box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.3));
        width: 100%;
        max-width: 100%;
        overflow: hidden;
      }

      .stats-section {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: calc(var(--spacing, 0.25rem) * 6);
        padding: calc(var(--spacing, 0.25rem) * 6);
        background: rgba(0, 0, 0, 0.2);
        border-radius: var(--radius, 8px);
      }

      .stat-item {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 4);
      }

      .stat-icon {
        width: 2rem;
        height: 2rem;
        color: var(--primary, #1db954);
        flex-shrink: 0;
      }

      .stat-content {
        display: flex;
        flex-direction: column;
      }

      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--primary-foreground, white);
        line-height: 1;
      }

      .stat-label {
        font-size: 0.75rem;
        color: var(--muted-foreground, #b3b3b3);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: calc(var(--spacing, 0.25rem) * 1);
      }

      .description {
        padding: calc(var(--spacing, 0.25rem) * 6);
        background: rgba(0, 0, 0, 0.2);
        border-radius: var(--radius, 8px);
      }

      .description h3 {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--primary-foreground, white);
        margin: 0 0 1rem 0;
      }

      .description p {
        font-size: 0.9375rem;
        color: var(--muted-foreground, #b3b3b3);
        line-height: 1.6;
        margin: 0;
      }

      @container (max-width: 767px) {
        .track-container {
          padding: calc(var(--spacing, 0.25rem) * 8)
            calc(var(--spacing, 0.25rem) * 4);
        }

        .track-name {
          font-size: 2rem;
        }

        .artist-name {
          font-size: 1.125rem;
        }

        .quick-actions {
          flex-direction: column;
        }

        .stats-section {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export class SpotifyTrack extends CardDef {
  // ⁶ Spotify track card definition
  static displayName = 'Spotify Track';
  static prefersWideFormat = true;
  static icon = MusicIcon;

  @field trackName = contains(StringField); // ⁷ Primary identifier
  @field artist = contains(StringField);
  @field album = contains(StringField);
  @field genre = contains(StringField);
  @field releaseDate = contains(DateField);
  @field duration = contains(NumberField); // Duration in seconds
  @field playCount = contains(NumberField);
  @field likes = contains(NumberField);
  @field audioFile = contains(AudioField, {
    // ⁸ Audio with playlist-row player
    configuration: {
      presentation: 'playlist-row',
    },
  });
  @field albumArt = contains(ImageField, {
    // ⁹ Album cover image
    configuration: {
      variant: 'browse',
      presentation: 'card',
    },
  });
  @field tags = containsMany(StringField); // ¹⁰ Genre tags
  @field description = contains(StringField);

  @field title = contains(StringField, {
    // ¹¹ Computed title
    computeVia: function (this: SpotifyTrack) {
      try {
        const track = this.trackName ?? 'Untitled Track';
        const artist = this.artist ? ` - ${this.artist}` : '';
        return `${track}${artist}`;
      } catch (e) {
        console.error('SpotifyTrack: Error computing title', e);
        return 'Untitled Track';
      }
    },
  });

  static isolated = IsolatedTemplate;

  static embedded = class Embedded extends Component<typeof SpotifyTrack> {
    // ¹³ Embedded format
    <template>
      <div class='spotify-track-embedded'>
        {{#if @model.albumArt}}
          <div class='embedded-album-art'>
            <@fields.albumArt @format='embedded' />
          </div>
        {{else}}
          <div class='embedded-album-placeholder'>
            <svg
              class='placeholder-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <path d='M9 18V5l12-2v13' />
              <circle cx='6' cy='18' r='3' />
              <circle cx='18' cy='16' r='3' />
            </svg>
          </div>
        {{/if}}

        <div class='embedded-content'>
          <div class='embedded-header'>
            <h3 class='embedded-track-name'>{{if
                @model.trackName
                @model.trackName
                'Untitled Track'
              }}</h3>
            <div class='embedded-artist'>{{if
                @model.artist
                @model.artist
                'Unknown Artist'
              }}</div>
          </div>

          <div class='embedded-meta'>
            {{#if @model.album}}
              <span class='embedded-album'>{{@model.album}}</span>
            {{/if}}
            {{#if @model.duration}}
              <span class='embedded-duration'>{{formatDuration
                  @model.duration
                  unit='seconds'
                  format='timer'
                }}</span>
            {{/if}}
          </div>
        </div>

        <div class='embedded-play-btn'>
          <svg viewBox='0 0 24 24' fill='currentColor'>
            <polygon points='5 3 19 12 5 21 5 3' />
          </svg>
        </div>
      </div>

      <style scoped>
        /* ¹⁷ Themed embedded styles */
        .spotify-track-embedded {
          display: flex;
          align-items: center;
          gap: calc(var(--spacing, 0.25rem) * 4);
          padding: calc(var(--spacing, 0.25rem) * 3);
          background: var(--card, #181818);
          border-radius: var(--radius, 6px);
          transition: all 0.2s;
          cursor: pointer;
        }

        .spotify-track-embedded:hover {
          background: var(--muted, #282828);
        }

        .embedded-album-art {
          flex-shrink: 0;
          width: 56px;
          height: 56px;
          border-radius: var(--radius, 4px);
          overflow: hidden;
        }

        .embedded-album-placeholder {
          flex-shrink: 0;
          width: 56px;
          height: 56px;
          background: var(--muted, #282828);
          border-radius: var(--radius, 4px);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .placeholder-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: var(--muted-foreground, #535353);
        }

        .embedded-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 1);
        }

        .embedded-track-name {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--foreground, white);
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .embedded-artist {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #b3b3b3);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .embedded-meta {
          display: flex;
          gap: calc(var(--spacing, 0.25rem) * 2);
          font-size: 0.75rem;
          color: var(--muted-foreground, #7f7f7f);
        }

        .embedded-album {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .embedded-play-btn {
          flex-shrink: 0;
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--primary, #1db954);
          border-radius: 50%;
          color: var(--foreground, black);
          opacity: 0;
          transition: opacity 0.2s;
        }

        .spotify-track-embedded:hover .embedded-play-btn {
          opacity: 1;
        }

        .embedded-play-btn svg {
          width: 1rem;
          height: 1rem;
          margin-left: 2px;
        }
      </style>
    </template>
  };
}
