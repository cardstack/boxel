import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import UrlField from 'https://cardstack.com/base/url';
import MusicIcon from '@cardstack/boxel-icons/music';
import { Button } from '@cardstack/boxel-ui/components';
import { and } from '@cardstack/boxel-ui/helpers';

export class PlaylistCard extends CardDef {
  static displayName = 'Playlist';
  static icon = MusicIcon;

  @field playlistName = contains(StringField);
  @field description = contains(StringField);
  @field coverImageUrl = contains(UrlField);
  @field songCount = contains(NumberField);
  @field duration = contains(StringField);
  @field curator = contains(StringField);
  @field mood = contains(StringField);

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

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='playlist-card'>
        <div class='playlist-cover'>
          {{#if @model.coverImageUrl}}
            <img
              src={{@model.coverImageUrl}}
              alt='Playlist cover'
              class='cover-image'
            />
          {{else}}
            <div class='cover-placeholder'>
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

          <div class='playlist-overlay'>
            <Button class='play-playlist-button' @variant='primary'>
              <svg viewBox='0 0 24 24' fill='currentColor'>
                <path d='M8 5v14l11-7z' />
              </svg>
            </Button>
          </div>
        </div>

        <div class='playlist-info'>
          <h3 class='playlist-name'>{{if
              @model.playlistName
              @model.playlistName
              'Untitled Playlist'
            }}</h3>

          {{#if @model.description}}
            <p class='playlist-description'>{{@model.description}}</p>
          {{/if}}

          <div class='playlist-meta'>
            {{#if @model.curator}}
              <span class='curator'>by {{@model.curator}}</span>
            {{/if}}

            <div class='playlist-stats'>
              {{#if @model.songCount}}
                <span class='song-count'>{{@model.songCount}} songs</span>
              {{/if}}
              {{#if (and @model.songCount (Number @model.duration))}}
                <span class='separator'>•</span>
              {{/if}}
              {{#if @model.duration}}
                <span class='duration'>{{@model.duration}}</span>
              {{/if}}
            </div>

            {{#if @model.mood}}
              <span class='mood-tag'>{{@model.mood}}</span>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .playlist-card {
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
        }

        .playlist-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        }

        .playlist-cover {
          position: relative;
          width: 100%;
          padding-bottom: 100%;
          overflow: hidden;
        }

        .cover-image {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .cover-placeholder {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .cover-placeholder svg {
          width: 48px;
          height: 48px;
        }

        .playlist-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        .playlist-card:hover .playlist-overlay {
          opacity: 1;
        }

        .play-playlist-button {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #3b82f6;
          border: none;
          color: white;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .play-playlist-button:hover {
          background: #2563eb;
          transform: scale(1.1);
        }

        .play-playlist-button svg {
          width: 24px;
          height: 24px;
          margin-left: 2px;
        }

        .playlist-info {
          padding: 1rem;
        }

        .playlist-name {
          font-size: 1rem;
          font-weight: 700;
          color: #1f2937;
          margin: 0 0 0.5rem 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .playlist-description {
          font-size: 0.75rem;
          color: #6b7280;
          margin: 0 0 0.75rem 0;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .playlist-meta {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .curator {
          font-size: 0.75rem;
          color: #9ca3af;
          font-style: italic;
        }

        .playlist-stats {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.625rem;
          color: #9ca3af;
        }

        .separator {
          margin: 0 0.125rem;
        }

        .mood-tag {
          display: inline-block;
          background: linear-gradient(135deg, #f59e0b, #f97316);
          color: white;
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          align-self: flex-start;
        }
      </style>
    </template>
  };
}
