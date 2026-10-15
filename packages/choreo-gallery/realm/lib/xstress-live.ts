/**
 * Live innards for Crossing's plate. They are not Choreo participants: they
 * ride inside the kept hero and keep running while it flies. CSS loops on the
 * hero itself freeze during a crossing (they would fight the flight
 * transform); a <video> and an overflow pane do not.
 */
import { modifier } from 'ember-modifier';

function reduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Muted autoplay is allowed; the clip is still kicked in case the browser
 * waited. Reduced motion holds it on its first frame.
 */
export const playClip = modifier((video: HTMLVideoElement) => {
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  if (reduced()) {
    video.pause();
    return;
  }
  const kick = () => {
    video.play().catch(() => {
      /* autoplay can still refuse; the element is the stress, not the decode */
    });
  };
  kick();
  video.addEventListener('canplay', kick);
  return () => video.removeEventListener('canplay', kick);
});

/**
 * Auto-scrolls a real overflow pane (scrollTop, not a translate loop) so a
 * cut can land mid-scroll. Reduced motion leaves it still.
 */
export const liveScroll = modifier((el: HTMLElement) => {
  if (reduced()) {
    return;
  }
  let raf = 0;
  let alive = true;
  const step = () => {
    if (!alive) {
      return;
    }
    const max = el.scrollHeight - el.clientHeight;
    if (max > 1) {
      const next = el.scrollTop + 0.45;
      el.scrollTop = next >= max - 0.5 ? 0 : next;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
  };
});
