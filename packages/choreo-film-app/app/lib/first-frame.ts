import { modifier } from 'ember-modifier';

/**
 * The message a film posts to the page that framed it once its first frame is
 * on screen. The gallery shows the film's poster in the frame's place until
 * this arrives (`choreo-gallery/realm/shell/film-frame.gts`), so the poster
 * hands over to the picture it is a still of instead of to an empty frame.
 */
export const FIRST_FRAME = 'choreo-film:first-frame';

/**
 * Post `FIRST_FRAME` to the framing page, two animation frames from now: the
 * one that paints the picture, and the one after it, so the poster never
 * lifts off a frame that has not been composited yet. A document that is not
 * framed has nobody to tell.
 */
export function announceFirstFrame(): void {
  if (window.parent === window) {
    return;
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      window.parent.postMessage({ type: FIRST_FRAME }, '*')
    )
  );
}

/** on an element that renders once the film's first frame is up */
export const firstFrame = modifier(() => {
  announceFirstFrame();
});
