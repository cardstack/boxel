// The video family's declared-capture: a capture-only component
// that decodes one frame into a canvas so the fitted cell (and the thumbnail
// fallback chain) show a real poster frame instead of the placeholder.
//
// Determinism is the contract: the seek lands on an exact timestamp derived
// only from the file's own duration, the frame is drawn once into a static
// canvas, and the `<video>` element never enters the DOM — so nothing
// animates between settle and shot, and a reindex of unchanged bytes
// byte-hashes to the same poster.
import GlimmerComponent from '@glimmer/component';
import { modifier } from 'ember-modifier';

import { fileResourceURL } from './file-image';

import type { CaptureSpec } from '../card-api';

// Where the poster frame comes from: one second in, clamped to the middle of
// anything shorter. Early enough to be cheap to decode, late enough to skip
// a fade-in from black.
function posterTimestamp(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(1, duration / 2);
}

// The element's `error` carries a MediaError whose numeric code is the only
// stable part; spell it out so the slot's failure diagnostics read without a
// lookup table.
const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

function describeMediaError(error: MediaError | null): string {
  if (!error) {
    return 'the video element reported an error';
  }
  let name = MEDIA_ERROR_NAMES[error.code] ?? `MediaError code ${error.code}`;
  return error.message ? `${name}: ${error.message}` : name;
}

interface CaptureSignature {
  Args: {
    model: any;
  };
  Element: HTMLElement;
}

export class VideoPosterCapture extends GlimmerComponent<CaptureSignature> {
  // The capture engine waits (bounded) for no `data-capture-pending`
  // attribute before shooting: a video seek's paint isn't visible to the
  // engine's image-paint wait, so the component owns the readiness signal.
  //
  // Both signals are written by mutating the attribute directly, not by a
  // tracked re-render: capture pages run in backgrounded pooled tabs, where
  // the timers a tracked update's render flush rides are throttled, so the
  // flip can sit unflushed past the engine's whole wait. The engine polls raw
  // DOM mutations, so raw DOM is the reliable channel.
  private drawPosterFrame = modifier((canvas: HTMLCanvasElement) => {
    let cancelled = false;
    let container = canvas.parentElement!;
    let video: HTMLVideoElement | undefined;
    let release = () => {
      video?.removeAttribute('src');
      video?.load();
      video = undefined;
    };
    // Readiness resolves only on a drawn frame.
    let finish = () => {
      if (!cancelled) {
        container.removeAttribute('data-capture-pending');
      }
      release();
    };
    // A video that cannot produce a frame — undecodable or unsupported bytes,
    // a failed media fetch, a stream with no picture — never becomes ready:
    // swap in the definitive-failure signal so the engine fails this slot
    // immediately instead of holding the prerender lane for the full pending
    // budget on every retry. Failing the slot is the point — no manifest
    // entry lands, so nothing is served for the poster (the fitted cell's
    // placeholder path stays in charge). Resolving readiness instead would
    // persist the empty capture box — a solid black poster, keyed on these
    // exact bytes — and the thumbnail seam would serve it as if it were a
    // real frame until the file changed. The attribute value carries the
    // cause into the slot's failure diagnostics, so an unreadable file is
    // distinguishable from a hung component.
    let fail = (cause: string) => {
      if (!cancelled) {
        container.removeAttribute('data-capture-pending');
        container.setAttribute('data-capture-failed', cause);
      }
      release();
    };
    let url = fileResourceURL(this.args.model);
    if (!url) {
      fail('no file resource url on the model');
      return;
    }
    video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.addEventListener(
      'error',
      () => fail(describeMediaError(video?.error ?? null)),
      { once: true },
    );
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (cancelled || !video) {
          return;
        }
        video.currentTime = posterTimestamp(video.duration);
      },
      { once: true },
    );
    video.addEventListener(
      'seeked',
      () => {
        if (cancelled || !video) {
          return;
        }
        let sourceWidth = video.videoWidth;
        let sourceHeight = video.videoHeight;
        if (!sourceWidth || !sourceHeight) {
          fail('the decoded stream has no picture dimensions');
          return;
        }
        try {
          let box = container.getBoundingClientRect();
          let scale = window.devicePixelRatio || 1;
          let width = Math.round(box.width * scale);
          let height = Math.round(box.height * scale);
          canvas.width = width;
          canvas.height = height;
          canvas.style.width = `${box.width}px`;
          canvas.style.height = `${box.height}px`;
          // Cover-crop the frame into the capture box, the same fit the
          // fitted stage applies to the poster it will display.
          let fit = Math.max(width / sourceWidth, height / sourceHeight);
          let cropWidth = width / fit;
          let cropHeight = height / fit;
          canvas
            .getContext('2d')!
            .drawImage(
              video,
              (sourceWidth - cropWidth) / 2,
              (sourceHeight - cropHeight) / 2,
              cropWidth,
              cropHeight,
              0,
              0,
              width,
              height,
            );
        } catch (error) {
          fail(`drawing the frame threw: ${String(error)}`);
          return;
        }
        finish();
      },
      { once: true },
    );
    video.src = url;
    return () => {
      cancelled = true;
      release();
    };
  });

  <template>
    <div class='video-poster-capture' data-capture-pending='true'>
      <canvas {{this.drawPosterFrame}} />
    </div>
    <style scoped>
      /* Fill the capture box; the cover-cropped canvas covers it edge to
         edge over the black ground the slot's background provides. */
      .video-poster-capture {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
      }
    </style>
  </template>
}

// The video family's declared roster: one `poster` frame at the recommended
// thumbnail box (the CardsGrid tile, 170×250 at the default
// deviceScaleFactor of 2), jpeg (a photographic frame, no alpha) over a
// black ground, keyed on file content so a metadata-only edit never
// re-decodes the video, feeding the thumbnail fallback chain and the fitted
// cell through the view model's thumbnail seam.
export const VIDEO_FAMILY_CAPTURES: Record<string, CaptureSpec> = {
  poster: {
    render: VideoPosterCapture,
    width: 170,
    height: 250,
    keyBy: 'file-content',
    useAsThumbnail: true,
    type: 'jpeg',
    background: 'black',
  },
};
