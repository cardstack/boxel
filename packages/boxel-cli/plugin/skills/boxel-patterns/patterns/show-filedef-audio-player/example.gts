import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import FileDef from 'https://cardstack.com/base/file-api';
import ImageDef from 'https://cardstack.com/base/image-file-def';
import MusicIcon from '@cardstack/boxel-icons/music';

// PATTERN: realm audio file -> linksTo(FileDef) -> native audio player.
//
// Instance JSON links to the real file path, including extension:
//   "relationships": {
//     "mp3File": { "links": { "self": "./assets/song.mp3" } },
//     "coverArt": { "links": { "self": "./assets/cover.jpeg" } }
//   }
//
// Do not store blob:, data:, base64, or MP3 bytes in card attributes.

export class AudioTrack extends CardDef {
  static displayName = 'Audio Track';
  static icon = MusicIcon;

  @field title = contains(StringField);
  @field artist = contains(StringField);
  @field durationSeconds = contains(NumberField);
  @field mp3File = linksTo(FileDef);
  @field coverArt = linksTo(ImageDef);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: AudioTrack) {
      return this.title || this.mp3File?.name || 'Untitled audio';
    },
  });

  static isolated = class Isolated extends Component<typeof AudioTrack> {
    get audioUrl() {
      return this.args.model.mp3File?.url;
    }

    get mimeType() {
      return this.args.model.mp3File?.contentType || 'audio/mpeg';
    }

    <template>
      <article class='audio-track'>
        {{#if @model.coverArt}}
          <div class='cover'>
            <@fields.coverArt @format='embedded' />
          </div>
        {{/if}}

        <div class='details'>
          <h1>{{@model.cardTitle}}</h1>
          {{#if @model.artist}}
            <p>{{@model.artist}}</p>
          {{/if}}

          {{#if this.audioUrl}}
            <audio class='player' controls preload='metadata'>
              <source src={{this.audioUrl}} type={{this.mimeType}} />
              <track kind='captions' />
            </audio>
          {{else}}
            <p class='empty'>Link an audio FileDef to enable playback.</p>
          {{/if}}
        </div>
      </article>

      <style scoped>
        .audio-track {
          display: grid;
          grid-template-columns: minmax(140px, 220px) minmax(0, 1fr);
          gap: 1rem;
          align-items: center;
          padding: 1rem;
          background: var(--background, #fff);
          color: var(--foreground, #111827);
        }

        .cover {
          aspect-ratio: 1;
          overflow: hidden;
          border-radius: var(--radius, 8px);
          background: var(--muted, #f3f4f6);
        }

        .details {
          min-width: 0;
          display: grid;
          gap: 0.5rem;
        }

        h1,
        p {
          margin: 0;
        }

        h1 {
          font-size: 1.5rem;
          line-height: 1.15;
        }

        .player {
          width: 100%;
        }

        .empty {
          color: var(--muted-foreground, #6b7280);
        }

        @media (max-width: 560px) {
          .audio-track {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof AudioTrack> {
    get mimeType() {
      return this.args.model.mp3File?.contentType || 'audio/mpeg';
    }

    <template>
      <article class='audio-row'>
        <MusicIcon width='20' height='20' />
        <div>
          <strong>{{@model.cardTitle}}</strong>
          {{#if @model.artist}}<span>{{@model.artist}}</span>{{/if}}
        </div>
        {{#if @model.mp3File}}
          <audio controls preload='metadata'>
            <source src={{@model.mp3File.url}} type={{this.mimeType}} />
            <track kind='captions' />
          </audio>
        {{/if}}
      </article>

      <style scoped>
        .audio-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) minmax(180px, 320px);
          gap: 0.75rem;
          align-items: center;
          padding: 0.75rem;
        }

        .audio-row div {
          min-width: 0;
          display: grid;
          gap: 0.125rem;
        }

        strong,
        span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        span {
          color: var(--muted-foreground, #6b7280);
          font-size: 0.875rem;
        }

        audio {
          width: 100%;
        }
      </style>
    </template>
  };
}
