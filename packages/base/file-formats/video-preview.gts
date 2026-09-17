// The video family's renderer, projected into the four format shells by
// `FilePreviewStage` — and the content-only component an embedding author
// imports from the `file-formats/index` barrel to render a video player without
// any shell chrome. The browser is the decoder, so the reading formats mount
// one native `<video controls>` through the `FileVideo` primitive, which loads
// protected realm bytes for Safari-safe playback and keeps its transport events
// from bubbling into an enclosing card. The player is letterboxed on a matte so
// an ultrawide or tall source keeps its own shape rather than being cropped.
//
// A fitted cell does not mount a player: a grid of live video elements is a page
// full of independent transport chrome, and the fitted shell prefers the
// captured poster thumbnail anyway. When no poster exists the cell falls back to
// the family glyph and the running time, never a broken frame.
import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import VideoIcon from '@cardstack/boxel-icons/file-video';

import { formatClock } from './file-presentation';
import type { ContentPreviewSignature } from './file-preview-stage';
import { FileVideo } from './file-resources';
import {
  ensureFileViewModel,
  type FileFormat,
  type FileViewModel,
} from './file-view-model';

export class VideoPreview extends GlimmerComponent<ContentPreviewSignature> {
  get format(): FileFormat {
    return this.args.format ?? 'embedded';
  }

  get isFitted(): boolean {
    return this.format === 'fitted';
  }

  // `@model` is the FileDef instance in the content-only case and a prebuilt
  // view model when a shell is rendering; either way the reads below see the
  // shared projection.
  @cached
  get model(): FileViewModel {
    return ensureFileViewModel(this.args.model, this.format);
  }

  // The shared projection routes the file's own URL to the player for the video
  // family, and a linked poster image (when the file carries one) to `posterUrl`.
  get mediaUrl(): string | undefined {
    return this.model.mediaUrl;
  }

  get posterUrl(): string | undefined {
    return this.model.posterUrl || undefined;
  }

  // The extracted running time. The native player reports its own once metadata
  // loads, but that never happens in a headless prerender and may lag a slow
  // range fetch, so the extracted figure is shown regardless.
  get duration(): string {
    return formatClock(this.model.durationSeconds);
  }

  <template>
    {{#if this.isFitted}}
      <div class='video-fitted' ...attributes data-test-video-fitted>
        <VideoIcon
          class='video-glyph'
          width='26'
          height='26'
          aria-hidden='true'
        />
        {{#if this.duration}}
          <span
            class='video-clock'
            data-test-video-duration
          >{{this.duration}}</span>
        {{/if}}
      </div>
    {{else}}
      <div
        class='video'
        data-mode={{this.format}}
        ...attributes
        data-test-video-preview
      >
        {{#if this.mediaUrl}}
          <FileVideo
            class='video-player'
            @src={{this.mediaUrl}}
            @poster={{this.posterUrl}}
            @preload='metadata'
            @loadAsBlob={{true}}
            data-test-video-player
          />
        {{else}}
          <div class='video-noviz'>
            <VideoIcon width='30' height='30' aria-hidden='true' />
            <span class='video-noviz-label'>No video source</span>
          </div>
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      /* The matte pair is the family's own `--fd-*`, which is outside the theme
         contract, so it resolves once here and is read bare below. It degrades
         to `--tooltip` — the one inverted surface the theme guarantees a
         foreground for — which is the same mapping the office badge uses. */
      .video-fitted,
      .video {
        --video-matte: var(--fd-slate, var(--tooltip));
        --video-matte-ink: var(--fd-paper, var(--tooltip-foreground));
      }

      /* Fitted: no player. The poster thumbnail is the fitted shell's job; this
         is the fallback when the file carries none — the family glyph with the
         running time anchored in a corner. */
      .video-fitted {
        position: relative;
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        overflow: hidden;
        padding: var(--boxel-sp-2xs);
        background-color: var(--video-matte);
        color: var(--video-matte-ink);
      }
      .video-glyph {
        color: inherit;
      }
      .video-clock {
        position: absolute;
        right: var(--boxel-sp-3xs);
        bottom: var(--boxel-sp-3xs);
        font-family: var(--font-mono);
        font-size: var(--boxel-eyebrow-font-size);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        font-weight: 700;
        color: var(--video-matte-ink);
        /* A readability scrim over arbitrary footage: black darkens whatever
           frame is behind it in either scheme, where a token would flip. */
        background-color: color-mix(in oklch, transparent, black 42%);
        padding: 1px var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-2xs);
      }

      /* Embedded/isolated: the player fills the stage the shell frames (the
         video shell already picks a height and aspect for it), letterboxed on
         the same matte so nothing is cropped. */
      .video {
        width: 100%;
        height: 100%;
        min-height: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        background-color: var(--video-matte);
        color: var(--video-matte-ink);
      }
      .video-player {
        display: block;
        width: 100%;
        height: 100%;
        max-height: 100%;
        object-fit: contain;
        background-color: var(--video-matte);
      }
      .video-noviz {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-2xs);
        color: inherit;
      }
      .video-noviz-label {
        font-family: var(--font-mono);
        font-size: var(--boxel-eyebrow-font-size);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
        opacity: 0.8;
      }
    </style>
  </template>
}
