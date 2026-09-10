// The video family's declared-screenshot capture: a capture-only component
// that decodes one frame into a canvas so the fitted cell (and the thumbnail
// fallback chain) show a real poster frame instead of the placeholder.
//
// Determinism is the contract: the seek lands on an exact timestamp derived
// only from the file's own duration, the frame is drawn once into a static
// canvas, and the `<video>` element never enters the DOM — so nothing
// animates between settle and shot, and a reindex of unchanged bytes
// byte-hashes to the same poster.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import { fileResourceURL } from './file-image';

import type { ScreenshotSpec } from '../card-api';

// Where the poster frame comes from: one second in, clamped to the middle of
// anything shorter. Early enough to be cheap to decode, late enough to skip
// a fade-in from black.
function posterTimestamp(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(1, duration / 2);
}

interface CaptureSignature {
  Args: {
    model: any;
  };
  Element: HTMLElement;
}

export class VideoPosterCapture extends GlimmerComponent<CaptureSignature> {
  // The capture engine waits (bounded) for no `data-screenshot-pending`
  // attribute before shooting: a video seek's paint isn't visible to the
  // engine's image-paint wait, so the component owns the readiness signal.
  @tracked pending = true;

  private drawPosterFrame = modifier((canvas: HTMLCanvasElement) => {
    let cancelled = false;
    let video: HTMLVideoElement | undefined;
    let finish = () => {
      if (!cancelled) {
        this.pending = false;
      }
      video?.removeAttribute('src');
      video?.load();
      video = undefined;
    };
    let url = fileResourceURL(this.args.model);
    if (!url) {
      finish();
      return;
    }
    video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.addEventListener('error', finish, { once: true });
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
        try {
          if (cancelled || !video) {
            return;
          }
          let box = canvas.parentElement!.getBoundingClientRect();
          let scale = window.devicePixelRatio || 1;
          let width = Math.round(box.width * scale);
          let height = Math.round(box.height * scale);
          canvas.width = width;
          canvas.height = height;
          canvas.style.width = `${box.width}px`;
          canvas.style.height = `${box.height}px`;
          let sourceWidth = video.videoWidth;
          let sourceHeight = video.videoHeight;
          if (!sourceWidth || !sourceHeight) {
            return;
          }
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
        } finally {
          finish();
        }
      },
      { once: true },
    );
    video.src = url;
    return () => {
      cancelled = true;
      video?.removeAttribute('src');
      video?.load();
      video = undefined;
    };
  });

  <template>
    <div
      class='video-poster-capture'
      data-screenshot-pending={{if this.pending 'true'}}
    >
      <canvas {{this.drawPosterFrame}} />
    </div>
    <style scoped>
      .video-poster-capture {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: #000;
      }
    </style>
  </template>
}

// The video family's declared roster: one `poster` frame at the recommended
// thumbnail box (the CardsGrid tile, 170×250 at the default
// deviceScaleFactor of 2), jpeg (a photographic frame, no alpha), keyed on
// file content so a metadata-only edit never re-decodes the video, feeding
// the thumbnail fallback chain and the fitted cell through the view model's
// thumbnail seam.
export const VIDEO_FAMILY_SCREENSHOTS: Record<string, ScreenshotSpec> = {
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
