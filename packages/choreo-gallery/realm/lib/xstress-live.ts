/**
 * Live innards for Crossing's plate. They are not Choreo participants: they
 * ride inside the kept hero and keep running while it flies. CSS loops on the
 * hero itself freeze during a crossing (they would fight the flight
 * transform); a <video> and an overflow pane do not.
 *
 * They run while the deck is on stage, though, and rest where they are when
 * it is scrolled away or covered. Whether it is on stage is asked of the deck
 * rather than of the hero: the hero is what flies, and where its box is
 * mid-flight says nothing about whether the deck can be seen.
 */
import { modifier } from 'ember-modifier';

import { observeStage } from './onstage';

function reduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function deckOf(el: Element): Element {
  return el.closest('.xstress-viewport') ?? el;
}

/**
 * Muted autoplay is allowed; the clip is still kicked in case the browser
 * waited. Reduced motion holds it on its first frame, and so does a deck
 * nobody can see — `pause()` also cancels the element's own `autoplay`.
 */
export const playClip = modifier((video: HTMLVideoElement) => {
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  if (reduced()) {
    video.pause();
    return;
  }
  let onStage = false;
  const kick = () => {
    if (!onStage) {
      return;
    }
    video.play().catch(() => {
      /* autoplay can still refuse; the element is the stress, not the decode */
    });
  };
  video.addEventListener('canplay', kick);
  const stage = observeStage(deckOf(video), (visible) => {
    onStage = visible;
    if (visible) {
      kick();
    } else {
      video.pause();
    }
  });
  return () => {
    stage.disconnect();
    video.removeEventListener('canplay', kick);
  };
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
  const step = () => {
    const max = el.scrollHeight - el.clientHeight;
    if (max > 1) {
      const next = el.scrollTop + 0.45;
      el.scrollTop = next >= max - 0.5 ? 0 : next;
    }
    raf = requestAnimationFrame(step);
  };
  const stage = observeStage(deckOf(el), (visible) => {
    cancelAnimationFrame(raf);
    raf = visible ? requestAnimationFrame(step) : 0;
  });
  return () => {
    stage.disconnect();
    cancelAnimationFrame(raf);
  };
});
