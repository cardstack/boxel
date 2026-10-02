// Pretui — AudioPlayer: MediaPlayer skinned for audio, with cover art, title and artist.
import Component from '@glimmer/component';
import { MediaPlayer } from './media-player';
import type { MediaPlayerSignature } from './media-player';

// ── AudioPlayer ──────────────────────────────────────────────────────────
//
// A skin, in the Tag-wraps-Pill idiom: it curries `@kind='audio'` and adds
// the one thing an audio track needs that a video does not — a face. Cover
// art, title and artist are args with slot escape hatches, per Law 7.

export interface AudioPlayerSignature {
  Args: Omit<MediaPlayerSignature['Args'], 'kind' | 'poster' | 'aspectRatio'> & {
    /** Cover art URL. */
    cover?: string;
    /** Alt text for the cover. Empty (the default) marks it decorative,
     * which is right when the title beside it says the same thing. */
    coverAlt?: string;
    /** Track title. */
    title?: string;
    /** Artist, show, or byline. */
    artist?: string;
  };
  Blocks: {
    /** Replaces the cover art entirely. */
    art: [];
    /** Replaces the title/artist stack. */
    meta: [];
    /** Forwarded to MediaPlayer's control-bar slot. */
    controls: [];
    /** Forwarded to MediaPlayer's footer. */
    footer: [];
  };
  Element: HTMLDivElement;
}

export class AudioPlayer extends Component<AudioPlayerSignature> {
  get label(): string {
    return this.args.label ?? this.args.title ?? 'Audio';
  }
  get coverAlt(): string {
    return this.args.coverAlt ?? '';
  }

  <template>
    <div class='pretui-audio' data-test-pretui-audio-player ...attributes>
      <div class='pretui-audio-head'>
        <div class='pretui-audio-art'>
          {{#if @cover}}
            <img src={{@cover}} alt={{this.coverAlt}} loading='lazy' />
          {{/if}}{{yield to='art'}}
        </div>
        <div class='pretui-audio-meta'>
          {{#if @title}}
            <span class='pretui-audio-title'>{{@title}}</span>
          {{/if}}
          {{#if @artist}}
            <span class='pretui-audio-artist'>{{@artist}}</span>
          {{/if}}{{yield to='meta'}}
        </div>
      </div>
      <MediaPlayer
        @kind='audio'
        @src={{@src}}
        @label={{this.label}}
        @tracks={{@tracks}}
        @transcript={{@transcript}}
        @transcriptOpen={{@transcriptOpen}}
        @captionsDefault={{@captionsDefault}}
        @chrome={{@chrome}}
        @seekOffset={{@seekOffset}}
        @loop={{@loop}}
        @muted={{@muted}}
        @preload={{@preload}}
        @crossOrigin={{@crossOrigin}}
        @quietStatus={{@quietStatus}}
        @onSnapshot={{@onSnapshot}}
      >
        <:controls>{{yield to='controls'}}</:controls>
        <:footer>{{yield to='footer'}}</:footer>
      </MediaPlayer>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-audio {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .pretui-audio-head {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .pretui-audio-art {
          flex: 0 0 auto;
          width: 52px;
          aspect-ratio: 1;
          border-radius: var(--radius-sm, 6px);
          overflow: hidden;
          background: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--card)
          );
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .pretui-audio-art:empty {
          display: none;
        }
        .pretui-audio-art img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .pretui-audio-meta {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .pretui-audio-meta:empty {
          display: none;
        }
        .pretui-audio-title {
          font-size: var(--text-body, 14px);
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-audio-artist {
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    </style>
  </template>
}
