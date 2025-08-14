import {
  field,
  contains,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import UrlField from 'https://cardstack.com/base/url';
import { and, gt } from '@cardstack/boxel-ui/helpers';

import { SongCard } from '../song/song';
import { MusicAlbumCard as BaseMusicAlbumCard } from '../base-entity/music-album';

export class MusicAlbumCard extends BaseMusicAlbumCard {
  @field artworkUrl = contains(UrlField);
  @field trackCount = contains(NumberField, {
    computeVia: function (this: MusicAlbumCard) {
      try {
        return this.songs?.length ?? 0;
      } catch (e) {
        console.error('MusicAlbumCard: Error computing track count', e);
        return 0;
      }
    },
  });
  @field duration = contains(StringField, {
    computeVia: function (this: MusicAlbumCard) {
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
        console.error('MusicAlbumCard: Error computing duration', e);
        return '0m';
      }
    },
  });
  @field songs = linksToMany(() => SongCard);
  @field totalPlays = contains(NumberField);
  @field rating = contains(NumberField); // Average user rating 1-5

  @field title = contains(StringField, {
    computeVia: function (this: MusicAlbumCard) {
      try {
        const album = this.albumTitle ?? 'Unknown Album';
        const artist = this.artist ?? 'Unknown Artist';
        return `${album} - ${artist}`;
      } catch (e) {
        console.error('AlbumCard: Error computing title', e);
        return 'Unknown Album';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='stage'>
        <div class='album-mat'>
          <div class='album-hero'>
            {{#if @model.artworkUrl}}
              <img
                src={{@model.artworkUrl}}
                alt='Album artwork'
                class='hero-artwork'
              />
            {{else}}
              <div class='hero-artwork-placeholder'>
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

            <div class='album-details'>
              <h1 class='album-title'>{{if
                  @model.albumTitle
                  @model.albumTitle
                  'Unknown Album'
                }}</h1>
              <h2 class='album-artist'>{{if
                  @model.artist
                  @model.artist
                  'Unknown Artist'
                }}</h2>

              <div class='album-metadata'>
                {{#if @model.releaseYear}}
                  <span class='metadata-item'>{{@model.releaseYear}}</span>
                {{/if}}
                {{#if @model.genre}}
                  <span class='metadata-item'>{{@model.genre}}</span>
                {{/if}}
                {{#if @model.trackCount}}
                  <span class='metadata-item'>{{@model.trackCount}}
                    tracks</span>
                {{/if}}
                {{#if @model.duration}}
                  <span class='metadata-item'>{{@model.duration}}</span>
                {{/if}}
              </div>

              {{#if @model.description}}
                <p class='album-description'>{{@model.description}}</p>
              {{/if}}

              {{#if @model.recordLabel}}
                <div class='label-info'>
                  <span class='label'>{{@model.recordLabel}}</span>
                  {{#if @model.producer}}
                    <span class='producer'>Produced by
                      {{@model.producer}}</span>
                  {{/if}}
                </div>
              {{/if}}
            </div>
          </div>

          <div class='track-listing'>
            <h3 class='section-title'>Track Listing</h3>
            {{#if (gt @model.songs.length 0)}}
              <div class='tracks-container'>
                <@fields.songs @format='embedded' />
              </div>
            {{else}}
              <div class='empty-tracks'>
                <svg
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <path
                    d='M9 9h0a3 3 0 0 1 5.12 0 2.44 2.44 0 0 1 0 3A3 3 0 0 0 12 16.5'
                  />
                  <circle cx='12' cy='19.5' r='.5' />
                </svg>
                <p>No tracks added to this album yet. Add some songs to complete
                  the album!</p>
              </div>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .stage {
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          padding: 0.5rem;
        }

        .album-mat {
          max-width: 50rem;
          width: 100%;
          padding: 2rem;
          overflow-y: auto;
          max-height: 100%;
          background: white;
          border-radius: 12px;
        }

        .album-hero {
          display: flex;
          gap: 2rem;
          margin-bottom: 3rem;
          align-items: flex-start;
        }

        .hero-artwork,
        .hero-artwork-placeholder {
          width: 240px;
          height: 240px;
          border-radius: 12px;
          flex-shrink: 0;
        }

        .hero-artwork {
          object-fit: cover;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }

        .hero-artwork-placeholder {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }

        .hero-artwork-placeholder svg {
          width: 80px;
          height: 80px;
        }

        .album-details {
          flex: 1;
          min-width: 0;
        }

        .album-title {
          font-size: 2.5rem;
          font-weight: 800;
          color: #1f2937;
          margin: 0 0 0.5rem 0;
          line-height: 1.1;
        }

        .album-artist {
          font-size: 1.5rem;
          font-weight: 600;
          color: #6b7280;
          margin: 0 0 1.5rem 0;
        }

        .album-metadata {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .metadata-item {
          background: #f3f4f6;
          color: #374151;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .album-description {
          font-size: 1rem;
          color: #4b5563;
          line-height: 1.6;
          margin: 0 0 1.5rem 0;
        }

        .label-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .label {
          font-size: 0.875rem;
          font-weight: 600;
          color: #6b7280;
        }

        .producer {
          font-size: 0.75rem;
          color: #9ca3af;
          font-style: italic;
        }

        .track-listing {
          border-top: 1px solid #e5e7eb;
          padding-top: 2rem;
        }

        .section-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #1f2937;
          margin: 0 0 1.5rem 0;
        }

        .tracks-container > .linksToMany-field {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .empty-tracks {
          text-align: center;
          padding: 3rem;
          color: #6b7280;
        }

        .empty-tracks svg {
          width: 64px;
          height: 64px;
          margin: 0 auto 1rem auto;
          color: #cbd5e1;
        }

        .empty-tracks p {
          font-size: 1rem;
          margin: 0;
          line-height: 1.5;
        }

        @media (max-width: 768px) {
          .album-hero {
            flex-direction: column;
            align-items: center;
            text-align: center;
          }

          .hero-artwork,
          .hero-artwork-placeholder {
            width: 200px;
            height: 200px;
          }

          .album-title {
            font-size: 2rem;
          }

          .album-artist {
            font-size: 1.25rem;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='album-card'>
        {{#if @model.artworkUrl}}
          <img
            src={{@model.artworkUrl}}
            alt='Album artwork'
            class='album-artwork'
          />
        {{else}}
          <div class='album-artwork-placeholder'>
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

        <div class='album-info'>
          <h3 class='album-title'>{{if
              @model.albumTitle
              @model.albumTitle
              'Unknown Album'
            }}</h3>
          <p class='album-artist'>{{if
              @model.artist
              @model.artist
              'Unknown Artist'
            }}</p>
          <div class='album-meta'>
            {{#if @model.releaseYear}}
              <span class='release-year'>{{@model.releaseYear}}</span>
            {{/if}}
            {{#if @model.trackCount}}
              <span class='track-count'>{{@model.trackCount}} tracks</span>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        /* Album card styles */
        .album-card {
          display: flex;
          gap: 0.75rem;
          padding: 0.75rem;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          transition: all 0.2s ease;
        }

        .album-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }

        .album-artwork {
          width: 60px;
          height: 60px;
          border-radius: 4px;
          object-fit: cover;
        }

        .album-artwork-placeholder {
          width: 60px;
          height: 60px;
          border-radius: 4px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .album-artwork-placeholder svg {
          width: 24px;
          height: 24px;
        }

        .album-info {
          flex: 1;
          min-width: 0;
        }

        .album-title {
          font-size: 0.875rem;
          font-weight: 600;
          margin: 0 0 0.25rem 0;
          color: #1f2937;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .album-artist {
          font-size: 0.75rem;
          color: #6b7280;
          margin: 0 0 0.5rem 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .album-meta {
          display: flex;
          gap: 0.5rem;
          font-size: 0.625rem;
          color: #9ca3af;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          {{#if @model.artworkUrl}}
            <img src={{@model.artworkUrl}} alt='Album' class='badge-artwork' />
          {{else}}
            <div class='badge-artwork-placeholder'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
              </svg>
            </div>
          {{/if}}
          <div class='badge-info'>
            <div class='badge-title'>{{if
                @model.albumTitle
                @model.albumTitle
                'Album'
              }}</div>
            <div class='badge-artist'>{{if
                @model.artist
                @model.artist
                'Artist'
              }}</div>
          </div>
        </div>

        <div class='strip-format'>
          {{#if @model.artworkUrl}}
            <img src={{@model.artworkUrl}} alt='Album' class='strip-artwork' />
          {{else}}
            <div class='strip-artwork-placeholder'>
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
              </svg>
            </div>
          {{/if}}
          <div class='strip-info'>
            <div class='strip-title'>{{if
                @model.albumTitle
                @model.albumTitle
                'Unknown Album'
              }}</div>
            <div class='strip-artist'>{{if
                @model.artist
                @model.artist
                'Unknown Artist'
              }}</div>
            <div class='strip-meta'>
              {{#if @model.releaseYear}}{{@model.releaseYear}}{{/if}}
              {{#if (and @model.releaseYear @model.trackCount)}} • {{/if}}
              {{#if @model.trackCount}}{{@model.trackCount}} tracks{{/if}}
            </div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='tile-artwork-container'>
            {{#if @model.artworkUrl}}
              <img src={{@model.artworkUrl}} alt='Album' class='tile-artwork' />
            {{else}}
              <div class='tile-artwork-placeholder'>
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
          </div>
          <div class='tile-info'>
            <h4 class='tile-title'>{{if
                @model.albumTitle
                @model.albumTitle
                'Unknown Album'
              }}</h4>
            <p class='tile-artist'>{{if
                @model.artist
                @model.artist
                'Unknown Artist'
              }}</p>
            <div class='tile-meta'>
              {{#if @model.genre}}
                <span class='genre-tag'>{{@model.genre}}</span>
              {{/if}}
              {{#if @model.releaseYear}}
                <span class='year'>{{@model.releaseYear}}</span>
              {{/if}}
            </div>
          </div>
        </div>

        <div class='card-format'>
          <div class='card-artwork-section'>
            {{#if @model.artworkUrl}}
              <img src={{@model.artworkUrl}} alt='Album' class='card-artwork' />
            {{else}}
              <div class='card-artwork-placeholder'>
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
          </div>
          <div class='card-details'>
            <div class='card-header'>
              <h3 class='card-title'>{{if
                  @model.albumTitle
                  @model.albumTitle
                  'Unknown Album'
                }}</h3>
              <p class='card-artist'>{{if
                  @model.artist
                  @model.artist
                  'Unknown Artist'
                }}</p>
            </div>
            <div class='card-metadata'>
              {{#if @model.genre}}
                <div class='metadata-item'>
                  <span class='metadata-label'>Genre:</span>
                  <span class='metadata-value'>{{@model.genre}}</span>
                </div>
              {{/if}}
              {{#if @model.releaseYear}}
                <div class='metadata-item'>
                  <span class='metadata-label'>Released:</span>
                  <span class='metadata-value'>{{@model.releaseYear}}</span>
                </div>
              {{/if}}
              {{#if @model.trackCount}}
                <div class='metadata-item'>
                  <span class='metadata-label'>Tracks:</span>
                  <span class='metadata-value'>{{@model.trackCount}}</span>
                </div>
              {{/if}}
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        /* Fitted container styles */
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
        }

        /* Hide all formats by default */
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }

        /* Badge format activation */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            align-items: center;
            gap: 0.375rem;
          }
        }

        /* Strip format activation */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
        }

        /* Tile format activation */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        /* Card format activation */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            gap: 1rem;
          }
        }

        /* Badge format styles */
        .badge-artwork,
        .badge-artwork-placeholder {
          width: 24px;
          height: 24px;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .badge-artwork-placeholder {
          background: linear-gradient(135deg, #667eea, #764ba2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .badge-artwork-placeholder svg {
          width: 12px;
          height: 12px;
        }

        .badge-info {
          min-width: 0;
          flex: 1;
        }

        .badge-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: #1f2937;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .badge-artist {
          font-size: 0.625rem;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Strip format styles */
        .strip-artwork,
        .strip-artwork-placeholder {
          width: 40px;
          height: 40px;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .strip-artwork-placeholder {
          background: linear-gradient(135deg, #667eea, #764ba2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .strip-artwork-placeholder svg {
          width: 20px;
          height: 20px;
        }

        .strip-info {
          flex: 1;
          min-width: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .strip-artist {
          font-size: 0.75rem;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-top: 0.125rem;
        }

        .strip-meta {
          font-size: 0.625rem;
          color: #9ca3af;
          margin-top: 0.25rem;
        }

        /* Tile format styles */
        .tile-artwork-container {
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 0.5rem;
        }

        .tile-artwork {
          max-width: 100%;
          max-height: 100%;
          border-radius: 6px;
          object-fit: cover;
        }

        .tile-artwork-placeholder {
          width: 80px;
          height: 80px;
          border-radius: 6px;
          background: linear-gradient(135deg, #667eea, #764ba2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .tile-artwork-placeholder svg {
          width: 32px;
          height: 32px;
        }

        .tile-info {
          text-align: center;
        }

        .tile-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 0.25rem 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tile-artist {
          font-size: 0.75rem;
          color: #6b7280;
          margin: 0 0 0.375rem 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tile-meta {
          display: flex;
          justify-content: center;
          gap: 0.375rem;
          font-size: 0.625rem;
        }

        .genre-tag {
          background: #f3f4f6;
          color: #374151;
          padding: 0.125rem 0.375rem;
          border-radius: 12px;
        }

        .year {
          color: #9ca3af;
        }

        /* Card format styles */
        .card-artwork-section {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .card-artwork {
          max-width: 100%;
          max-height: 100%;
          border-radius: 8px;
          object-fit: cover;
        }

        .card-artwork-placeholder {
          width: 120px;
          height: 120px;
          border-radius: 8px;
          background: linear-gradient(135deg, #667eea, #764ba2);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .card-artwork-placeholder svg {
          width: 48px;
          height: 48px;
        }

        .card-details {
          flex: 1.618;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .card-header .card-title {
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 0.25rem 0;
        }

        .card-header .card-artist {
          font-size: 0.875rem;
          color: #6b7280;
          margin: 0;
        }

        .card-metadata {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .metadata-item {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
        }

        .metadata-label {
          color: #9ca3af;
          font-weight: 500;
        }

        .metadata-value {
          color: #374151;
          font-weight: 600;
        }
      </style>
    </template>
  };
}
