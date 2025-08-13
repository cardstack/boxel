import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import MusicIcon from '@cardstack/boxel-icons/music';
import { Button } from '@cardstack/boxel-ui/components';

export class SongCard extends CardDef {
  static displayName = 'Song';
  static icon = MusicIcon;

  @field songTitle = contains(StringField);
  @field artist = contains(StringField);
  @field duration = contains(StringField);
  @field albumName = contains(StringField);
  @field genre = contains(StringField);
  @field trackNumber = contains(NumberField);

  @field title = contains(StringField, {
    computeVia: function (this: SongCard) {
      try {
        const song = this.songTitle ?? 'Unknown Song';
        const artist = this.artist ?? 'Unknown Artist';
        return `${song} - ${artist}`;
      } catch (e) {
        console.error('SongCard: Error computing title', e);
        return 'Unknown Song';
      }
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='song-card'>
        <div class='song-info'>
          <div class='song-header'>
            <h4 class='song-title'>{{if
                @model.songTitle
                @model.songTitle
                'Unknown Song'
              }}</h4>
            <span class='song-duration'>{{if
                @model.duration
                @model.duration
                '0:00'
              }}</span>
          </div>
          <p class='song-artist'>{{if
              @model.artist
              @model.artist
              'Unknown Artist'
            }}</p>
          {{#if @model.albumName}}
            <p class='song-album'>from {{@model.albumName}}</p>
          {{/if}}
        </div>

        <div class='song-controls'>
          <Button class='play-button' @variant='ghost'>
            <svg viewBox='0 0 24 24' fill='currentColor'>
              <path d='M8 5v14l11-7z' />
            </svg>
          </Button>
        </div>
      </div>

      <style scoped>
        .song-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem;
          background: white;
          border-radius: 6px;
          border: 1px solid #e5e7eb;
          transition: all 0.2s ease;
        }

        .song-card:hover {
          border-color: #3b82f6;
          box-shadow: 0 2px 4px rgba(59, 130, 246, 0.1);
        }

        .song-info {
          flex: 1;
          min-width: 0;
        }

        .song-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
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
          margin-right: 0.5rem;
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
          margin: 0;
          font-style: italic;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .song-controls {
          margin-left: 0.75rem;
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
        }

        .play-button:hover {
          background: #3b82f6;
          color: white;
        }

        .play-button svg {
          width: 14px;
          height: 14px;
        }
      </style>
    </template>
  };
}
