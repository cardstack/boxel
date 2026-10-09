import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import { scrollRoot } from './onstage';
import { factor } from './tempo';

const GLIDE = 0.5;
const GLIDE_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

interface Box {
  border: string;
  radius: string;
  rect: DOMRect;
}

function boxOf(el: HTMLElement): Box {
  let style = getComputedStyle(el);
  return {
    rect: el.getBoundingClientRect(),
    radius: style.borderTopLeftRadius,
    border: style.borderTopWidth,
  };
}

/**
 * Carry the stage from the box it had to the box it has now, by transform:
 * the frame keeps its parent, so the film plays straight through the move.
 * The corners and the hairline go with it, so the well's rim neither snaps
 * off on the way in nor pops back on the way out.
 */
function glide(el: HTMLElement, from: Box) {
  let duration = GLIDE * factor();
  if (
    duration === 0 ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    !el.isConnected
  ) {
    return;
  }
  let to = boxOf(el);
  if (!to.rect.width || !to.rect.height) {
    return;
  }
  let dx = from.rect.left - to.rect.left;
  let dy = from.rect.top - to.rect.top;
  let sx = from.rect.width / to.rect.width;
  let sy = from.rect.height / to.rect.height;
  el.animate(
    [
      {
        transformOrigin: '0 0',
        transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
        borderRadius: from.radius,
        borderWidth: from.border,
      },
      {
        transformOrigin: '0 0',
        transform: 'none',
        borderRadius: to.radius,
        borderWidth: to.border,
      },
    ],
    { duration: duration * 1000, easing: GLIDE_EASE },
  );
}

/**
 * Publish what theater sizes the stage against, as custom properties on the
 * element: `--view-h`, the height of what the viewer can see of the card —
 * the element that scrolls it, which in the host is the stack item under the
 * card's header, not the window — and `--site-w`, the width of the gallery's
 * root, which the stage spans in theater. A document that scrolls itself
 * publishes no height, and the stylesheet falls back to the window's.
 */
export const theaterView = modifier((el: HTMLElement) => {
  let scroller = scrollRoot(el);
  let site = el.closest<HTMLElement>('[data-choreo-site]');
  let publish = () => {
    if (scroller) {
      el.style.setProperty('--view-h', `${scroller.clientHeight}px`);
    }
    if (site) {
      el.style.setProperty('--site-w', `${site.clientWidth}px`);
    }
  };
  let observer = new ResizeObserver(publish);
  for (let target of [scroller, site]) {
    if (target) {
      observer.observe(target);
    }
  }
  publish();
  return () => observer.disconnect();
});

/**
 * Theater mode: a film's page with its stage brought to the front and given
 * the height of what the viewer can see. It is a mode of the page rather than
 * a page of its own because the film must not restart when you enter it, so
 * the stage never moves in the DOM (re-parenting an iframe reloads it); the
 * page re-orders around it instead, and the stage glides between the two
 * boxes.
 *
 * The state belongs to whoever renders the page: the gallery card, or a demo
 * card opened on its own. It is never written to the host's URL.
 */
export class Theater {
  @tracked on = false;

  /**
   * The curtain is down: the page is about to leave, its film has stopped
   * and its poster stands in the frame's place. The crossing flies the stage
   * out, and an iframe can't ride a crossing — the region lifts what leaves
   * into a layer of its own, and an iframe that moves reloads, mid-flight and
   * on the page's own thread.
   */
  @tracked curtain = false;

  private stageEl?: HTMLElement;

  /** on the stage's box, so a switch in or out can carry it */
  stage = modifier((el: HTMLElement) => {
    this.stageEl = el;
    return () => {
      if (this.stageEl === el) {
        this.stageEl = undefined;
      }
    };
  });

  /** the viewer's switch, in or out: the stage glides between its boxes */
  enter = (on: boolean) => {
    if (on === this.on) {
      return;
    }
    let el = this.stageEl;
    let from = el ? boxOf(el) : undefined;
    this.on = on;
    if (el && from) {
      // the switch has rendered by the next frame, and that frame is not
      // yet painted: the stage starts the glide from where it was
      requestAnimationFrame(() => glide(el, from));
    }
  };

  toggle = () => this.enter(!this.on);

  /**
   * Set the mode for a page that is arriving, with no glide: the crossing
   * animates a page swap, and the curtain goes back up for the new page.
   */
  reset = (on = false) => {
    this.on = on;
    this.curtain = false;
  };
}
