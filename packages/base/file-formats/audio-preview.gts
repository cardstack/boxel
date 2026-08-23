// The sampled-audio family's renderer, projected into the four format shells by
// `FilePreviewStage` — and the content-only component an embedding author
// imports from the `file-formats/index` barrel to render a waveform and player
// without any shell chrome. The browser is the decoder, so the reading formats
// mount one native `<audio controls>` — but a sound file has no picture, so the
// visual
// the shells hand their stage is the amplitude envelope the extract pass read
// out of the bytes, drawn as a waveform.
//
// The envelope arrives already resampled and bounded by `fileViewModel`
// (`waveformBars`, 64 bars in a fitted cell, 256 in the reading formats), so
// this component only draws it; it never sees an unbounded payload. A file whose
// envelope could not be decoded — an over-budget FLAC, a stream that would not
// re-read — still renders: the duration and identity carry the cell, and the
// waveform area falls back to the family glyph rather than a broken frame.
//
// A fitted cell deliberately does not mount a player: a grid of live audio
// elements is a page full of independent transport chrome. It shows the
// waveform and the running time, and the reading formats own playback.
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import MusicIcon from '@cardstack/boxel-icons/music';
import { cn } from '@cardstack/boxel-ui/helpers';

import { formatClock } from './file-presentation';
import type { ContentPreviewSignature } from './file-preview-stage';
import {
  ensureFileViewModel,
  type FileFormat,
  type FileViewModel,
} from './file-view-model';

// SVG clipPath ids are document-global, and a page can mount several audio
// previews at once, so each instance takes its own serial.
let clipSerial = 0;

// One drawn bar of the waveform, in the 0–100 viewBox the template stretches to
// fill. Centered on the mid-line so the envelope reads as a real waveform rather
// than a bar chart growing from the floor.
interface WaveBar {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class AudioPreview extends GlimmerComponent<ContentPreviewSignature> {
  get mode(): FileFormat {
    return this.args.mode ?? 'embedded';
  }

  get isFitted(): boolean {
    return this.mode === 'fitted';
  }

  // `@model` is the FileDef instance in the content-only case and a prebuilt
  // view model when a shell is rendering; either way the reads below see the
  // shared projection.
  @cached
  get model(): FileViewModel {
    return ensureFileViewModel(this.args.model, this.mode);
  }

  // The resampled envelope, already normalized to 0–100 and capped to the
  // format's bar budget by the shared projection.
  get bars(): number[] {
    return this.model.waveformBars ?? [];
  }

  get hasWaveform(): boolean {
    return this.bars.length > 0;
  }

  // Lay the envelope out as centered bars in a 0–100 square the template
  // stretches to the stage with `preserveAspectRatio='none'`. A silent sample
  // keeps a sliver of height so the track's shape stays continuous.
  get waveBars(): WaveBar[] {
    let values = this.bars;
    let n = values.length;
    if (!n) {
      return [];
    }
    let slot = 100 / n;
    let w = Math.max(slot * 0.62, 0.35);
    return values.map((value, index) => {
      let v = Math.max(0, Math.min(100, Number(value) || 0));
      let h = Math.max(1.5, (v / 100) * 96);
      return {
        x: index * slot + (slot - w) / 2,
        y: (100 - h) / 2,
        w,
        h,
      };
    });
  }

  // Present for the `audio`/`music` families, where the shared projection routes
  // the file's own URL to the player.
  get mediaUrl(): string | undefined {
    return this.model.mediaUrl;
  }

  // How much of the track has played, 0–1, mirrored from the mounted player.
  // Kept as a ratio rather than a time so the waveform math never cares which
  // duration source (media element vs. extract) produced it.
  @tracked playedRatio = 0;

  private clipId = `audio-wave-played-${++clipSerial}`;

  get playedClip(): string {
    return `url(#${this.clipId})`;
  }

  // Gate on the rounded width, not the raw ratio: on very long media the first
  // moments of playback round to a zero-width clip window, and keying off the
  // ratio there would dim the whole waveform while highlighting nothing.
  get hasPlayed(): boolean {
    return this.playedWidth > 0;
  }

  // Width of the clip window in the 0–100 viewBox. One decimal keeps the
  // attribute churn per timeupdate readable without visibly stepping.
  get playedWidth(): number {
    return Math.round(this.playedRatio * 1000) / 10;
  }

  updatePlayed = (event: Event) => {
    let el = event.currentTarget as HTMLAudioElement;
    // The element's own duration wins once metadata arrives; before that (or
    // in a context where the media never loads) the extracted figure stands in.
    let duration =
      Number.isFinite(el.duration) && el.duration > 0
        ? el.duration
        : Number(this.model.durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) {
      this.playedRatio = 0;
      return;
    }
    this.playedRatio = Math.max(0, Math.min(1, el.currentTime / duration));
  };

  // The extracted running time. The native player reports its own once metadata
  // loads, but that never happens in a headless prerender and may lag a slow
  // range fetch, so the figure the extractor already read is shown regardless.
  get duration(): string {
    return formatClock(this.model.durationSeconds);
  }

  get trackTitle(): string {
    return this.model.mediaTags?.trackTitle ?? '';
  }

  get artist(): string {
    return this.model.mediaTags?.artist ?? '';
  }

  <template>
    {{#if this.isFitted}}
      <div class='wave-fitted' data-test-audio-fitted>
        {{#if this.hasWaveform}}
          <svg
            class='wave-svg'
            viewBox='0 0 100 100'
            preserveAspectRatio='none'
            aria-hidden='true'
          >
            {{#each this.waveBars as |bar|}}
              <rect x={{bar.x}} y={{bar.y}} width={{bar.w}} height={{bar.h}} />
            {{/each}}
          </svg>
        {{else}}
          <MusicIcon class='wave-glyph' width='26' height='26' />
        {{/if}}
        {{#if this.duration}}
          <span
            class='wave-clock'
            data-test-audio-duration
          >{{this.duration}}</span>
        {{/if}}
      </div>
    {{else}}
      <div class='audio' data-mode={{this.mode}} data-test-audio-preview>
        <div class='audio-visual'>
          {{#if this.hasWaveform}}
            <svg
              class={{cn 'wave-svg' has-progress=this.hasPlayed}}
              viewBox='0 0 100 100'
              preserveAspectRatio='none'
              aria-hidden='true'
            >
              {{#each this.waveBars as |bar|}}
                <rect
                  x={{bar.x}}
                  y={{bar.y}}
                  width={{bar.w}}
                  height={{bar.h}}
                />
              {{/each}}
              {{#if this.hasPlayed}}
                <g
                  class='wave-played'
                  clip-path={{this.playedClip}}
                  data-test-audio-waveform-played={{this.playedWidth}}
                >
                  {{#each this.waveBars as |bar|}}
                    <rect
                      x={{bar.x}}
                      y={{bar.y}}
                      width={{bar.w}}
                      height={{bar.h}}
                    />
                  {{/each}}
                </g>
                <defs>
                  <clipPath id={{this.clipId}}>
                    <rect x='0' y='0' width={{this.playedWidth}} height='100' />
                  </clipPath>
                </defs>
              {{/if}}
            </svg>
          {{else}}
            <div class='audio-noviz'>
              <MusicIcon width='30' height='30' aria-hidden='true' />
              <span class='audio-noviz-label'>No waveform</span>
            </div>
          {{/if}}
        </div>

        <div class='audio-bar'>
          <div class='audio-caption'>
            {{#if this.trackTitle}}
              <span class='audio-track' title={{this.trackTitle}}>
                {{this.trackTitle}}
              </span>
            {{/if}}
            {{#if this.artist}}
              <span class='audio-artist' title={{this.artist}}>
                {{this.artist}}
              </span>
            {{/if}}
          </div>
          {{#if this.duration}}
            <span
              class='audio-clock'
              data-test-audio-duration
            >{{this.duration}}</span>
          {{/if}}
        </div>

        {{#if this.mediaUrl}}
          {{! An arbitrary audio file ships no caption track, so an empty
          <track> would only mislead (and warn); omit it. The a11y rule that
          wants one doesn't apply when no captions exist. }}
          {{! template-lint-disable require-media-caption }}
          <audio
            class='audio-player'
            src={{this.mediaUrl}}
            controls
            preload='metadata'
            data-test-audio-player
            {{on 'timeupdate' this.updatePlayed}}
            {{on 'seeking' this.updatePlayed}}
            {{on 'emptied' this.updatePlayed}}
          ></audio>
        {{else}}
          <p class='audio-empty'>No audio source</p>
        {{/if}}
      </div>
    {{/if}}

    <style scoped>
      /* Fitted: the waveform fills the cell, with the running time anchored in a
         corner. No player — a collection of live transports is not a preview. */
      .wave-fitted {
        position: relative;
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        overflow: hidden;
        padding: 8px;
      }
      .wave-glyph {
        color: var(--muted-foreground);
      }
      .wave-clock {
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

      /* The bars read on both the light stage gray and the dark waveform rail the
         fitted shell mats them onto, so they take an accent tone rather than the
         theme foreground. */
      .wave-svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .wave-svg rect {
        fill: var(--fd-accent, var(--primary, #4f7cff));
      }

      /* Embedded/isolated: waveform, a caption of what the track says about
         itself, then the native player. */
      .audio {
        width: 100%;
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px 12px;
        background: var(--card, #fff);
        color: var(--card-foreground, var(--foreground));
        font-family: var(--font-sans);
        overflow: hidden;
      }
      .audio-visual {
        flex: 1;
        min-height: 40px;
        border-radius: 6px;
        background: var(--fd-slate, #1f2430);
        padding: 10px 12px;
        overflow: hidden;
      }
      .audio-visual .wave-svg rect {
        fill: var(--fd-accent, var(--primary, #7c9dff));
      }

      /* Once playback begins, the un-played remainder recedes so the
         accent-colored played span reads as the position. Direct children
         only: the played layer's rects sit inside their own group and keep
         full strength. Before playback the class is absent, so a track at
         rest keeps the waveform's usual weight. */
      .audio-visual .wave-svg.has-progress > rect {
        opacity: 0.45;
      }
      .audio-noviz {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: var(--fd-paper, #d4d8e0);
      }
      .audio-noviz-label {
        font-family: var(--font-mono);
        font-size: 0.53125rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        opacity: 0.8;
      }
      .audio-bar {
        display: flex;
        align-items: baseline;
        gap: 10px;
        min-width: 0;
        flex-shrink: 0;
      }
      .audio-caption {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
        flex: 1;
        overflow: hidden;
      }
      .audio-track {
        font-size: 0.8125rem;
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .audio-artist {
        font-size: 0.75rem;
        color: var(--muted-foreground);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .audio-clock {
        margin-left: auto;
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
      .audio-player {
        width: 100%;
        flex-shrink: 0;
      }
      .audio-empty {
        margin: 0;
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.625rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
