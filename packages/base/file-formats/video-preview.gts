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
      <div class='video-fitted' data-test-video-fitted>
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
      <div class='video' data-mode={{this.format}} data-test-video-preview>
        {{#if this.mediaUrl}}
          <FileVideo
            class='video-player'
            @src={{this.mediaUrl}}
            @poster={{this.posterUrl}}
            @preload='metadata'
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
        padding: 8px;
        background: var(--fd-slate, #1f2430);
      }
      .video-glyph {
        color: var(--fd-paper, #d4d8e0);
      }
      .video-clock {
        position: absolute;
        right: 6px;
        bottom: 5px;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: rgb(0 0 0 / 42%);
        padding: 1px 5px;
        border-radius: 3px;
      }

      /* Embedded/isolated: the player fills the stage the shell frames (the
         video shell already picks a height and aspect for it), letterboxed on a
         matte so nothing is cropped. */
      .video {
        width: 100%;
        height: 100%;
        min-height: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: var(--fd-slate, #1f2430);
      }
      .video-player {
        display: block;
        width: 100%;
        height: 100%;
        max-height: 100%;
        object-fit: contain;
        background: #000;
      }
      .video-noviz {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: var(--fd-paper, #d4d8e0);
      }
      .video-noviz-label {
        font-family: var(--font-mono);
        font-size: 0.53125rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        opacity: 0.8;
      }
    </style>
  </template>
}
