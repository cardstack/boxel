// Pretui — VideoPlayer: MediaPlayer skinned for video, with a reserved aspect ratio and a caption.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { MediaPlayer } from './media-player';
import type { MediaPlayerSignature } from './media-player';

// ── VideoPlayer ──────────────────────────────────────────────────────────
//
// The other skin. It curries `@kind='video'` and defaults the two things a
// video needs and an audio track does not: a reserved aspect ratio and a
// poster. Everything else is MediaPlayer's, forwarded.

export interface VideoPlayerSignature {
  Args: Omit<MediaPlayerSignature['Args'], 'kind'> & {
    /** Caption under the picture. A `<figcaption>`, so the picture and its
     * caption are one figure to assistive technology. */
    caption?: string;
  };
  Blocks: {
    /** Forwarded to MediaPlayer's picture overlay. */
    overlay: [];
    /** Forwarded to MediaPlayer's control-bar slot. */
    controls: [];
    /** Forwarded to MediaPlayer's footer. */
    footer: [];
  };
  Element: HTMLElement;
}

export const VideoPlayer: TemplateOnlyComponent<VideoPlayerSignature> =
  <template>
    <figure class='pretui-video' data-test-pretui-video-player ...attributes>
      <MediaPlayer
        @kind='video'
        @src={{@src}}
        @label={{@label}}
        @poster={{@poster}}
        @placeholder={{@placeholder}}
        @aspectRatio={{@aspectRatio}}
        @tracks={{@tracks}}
        @thumbnails={{@thumbnails}}
        @transcript={{@transcript}}
        @transcriptOpen={{@transcriptOpen}}
        @captionsDefault={{@captionsDefault}}
        @chrome={{@chrome}}
        @seekOffset={{@seekOffset}}
        @autoHide={{@autoHide}}
        @loop={{@loop}}
        @muted={{@muted}}
        @preload={{@preload}}
        @crossOrigin={{@crossOrigin}}
        @quietStatus={{@quietStatus}}
        @onSnapshot={{@onSnapshot}}
      >
        <:overlay>{{yield to='overlay'}}</:overlay>
        <:controls>{{yield to='controls'}}</:controls>
        <:footer>{{yield to='footer'}}</:footer>
      </MediaPlayer>
      {{#if @caption}}
        <figcaption class='pretui-video-caption'>{{@caption}}</figcaption>
      {{/if}}
    </figure>

    <style scoped>
      @layer PretComponent {
        .pretui-video {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 0;
          min-width: 0;
        }
        .pretui-video-caption {
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 1.55;
          color: var(--muted-foreground);
          text-wrap: pretty;
        }
      }
    </style>
  </template>;
