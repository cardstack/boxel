/**
 * The gallery ⇄ demo crossing.
 *
 * The transition itself belongs to the library: `<Choreo @route>` in the site
 * frame treats the page swap as one render pass, and the timeline says the
 * whole move — leaves fade, the paired stage and type fly, arrivals land near
 * the settle. Nothing is snapshotted, so the live demos keep running through
 * the move.
 *
 * The LIFECYCLE — arm before the run exists, hand over when a run is replaced
 * mid-flight, stand down on the survivor or on a deadline — belongs to the
 * library too, as `createArming()`.
 *
 * What is left here is the part that is genuinely the gallery's: knowing WHAT
 * this crossing is (the region stays router-agnostic by design), and knowing
 * where the arriving page wants its scroll container.
 *
 * One `Crossing` per gallery card. A gallery can be open in several stacks at
 * once, and each one's crossing is its own.
 */
import { type ChoreoContext, createArming } from '@cardstack/choreo';
import { tracked } from '@glimmer/tracking';

import { factor } from './tempo';

/** the attribute every gallery tile carries, keyed by its demo's slug */
export const TILE_ATTRIBUTE = 'data-gallery-tile';

class State {
  /** the tile a RETURN crossing lands on, null any other time */
  @tracked closingSlug: string | null = null;
}

/**
 * Where the card actually scrolls. In the host that is the stack item the
 * card sits in, not the window; on a published page it is the document.
 */
function scrollerOf(el: Element): Element {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
}

export class Crossing {
  private state = new State();

  /**
   * True while a crossing is running.
   *
   * Anything mounting during one must not play its own entrance: the region
   * is already animating the page, and twenty-six cards popping in as the
   * morph lands is a kink at the end of an otherwise smooth movement.
   *
   * Deliberately NOT tracked. Setting it would invalidate whatever reads it
   * and force a re-render in the middle of the transition. It is read once,
   * when a tile mounts, and that is the only moment it matters.
   */
  private crossing = false;

  private arming = createArming({
    onStandDown: () => {
      if (this.state.closingSlug !== null) {
        this.state.closingSlug = null;
      }
      this.crossing = false;
    },
  });

  /**
   * Where the gallery was standing, so the trip home can put it back. Null
   * until the gallery has actually been left: a demo opened directly has no
   * position to restore.
   */
  private galleryScroll: number | null = null;

  /**
   * The page swap waiting for its scroll placement. Set when a swap begins
   * and consumed by the pass that renders it, so later passes in the same
   * region — a filter, the How panel, the stages booting after the landing —
   * leave the scroll where the viewer put it.
   */
  private landing: { closing: boolean; slug: string | null } | null = null;

  private region: ChoreoContext | null = null;
  private anchor: Element | null = null;

  /** the site frame hands over the region's context and an element inside it */
  wire(region: ChoreoContext, anchor: Element): void {
    this.region = region;
    this.anchor = anchor;
  }

  /** a crossing pass is in flight — the region's timeline renders only then */
  get active(): boolean {
    return this.arming.active();
  }

  /** a crossing is in flight AND it is the trip home to the gallery */
  get returningHome(): boolean {
    return this.arming.active() && this.state.closingSlug !== null;
  }

  /**
   * The tile the return flight lands on — the one tile that is PART of the
   * crossing. Every other tile is unmatched and enters on its own once the
   * move has landed.
   */
  get counterpart(): string | null {
    return this.state.closingSlug;
  }

  get isCrossing(): boolean {
    return this.crossing;
  }

  /**
   * Called just before the page swaps: remember what this crossing is, and
   * arm the timeline. `null` is the gallery; a slug is that demo's page.
   */
  begin(from: string | null, to: string | null): void {
    if (!this.region || from === to) {
      return;
    }
    const opening = from === null;
    const closing = to === null;
    if (opening && this.anchor) {
      this.galleryScroll = scrollerOf(this.anchor).scrollTop;
    }
    this.landing = { closing, slug: closing ? from : null };
    // Instant means instant: with the timeline unrendered the pass compiles
    // nothing — no run, not a zero-length one — and the region still places
    // the scroll inside the pass.
    if (factor() === 0) {
      return;
    }
    this.state.closingSlug = closing ? from : null;
    this.crossing = true;
    this.arming.begin(this.region);
  }

  /**
   * Resolves when the crossing in flight stands down — immediately if none
   * is. The grid brings its live stages up AFTER the landing rather than
   * booting them all inside the pass.
   */
  settled(): Promise<void> {
    return this.arming.settled();
  }

  /**
   * The brand mark, clicked while already standing in the gallery: the
   * leftover intent is "take me back to the top". Smooth unless the viewer
   * has asked for less motion.
   */
  scrollToTop(): void {
    if (!this.anchor) {
      return;
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollerOf(this.anchor).scrollTo({
      top: 0,
      behavior: reduce ? 'auto' : 'smooth',
    });
  }

  /** stand any crossing down, and forget the remembered scroll */
  reset(): void {
    this.galleryScroll = null;
    this.landing = null;
    this.arming.end();
  }

  /**
   * `@scroll` for the region: where the arriving page wants its scroll
   * container, applied inside the pass — after the swap renders, before
   * final bounds are measured, so the flight lands where the page will
   * actually stand.
   *
   * The region asks on every pass that brings something in, not only on a
   * page swap; a pass with no swap pending answers with where the window
   * already is, so nothing moves.
   *
   * The region positions the window. Inside the host the card scrolls in its
   * stack item instead, so this places that container itself and answers
   * with the window's own position, which leaves the window where it is.
   */
  scrollIntent = (): number => {
    const landing = this.landing;
    this.landing = null;
    const scroller = this.anchor ? scrollerOf(this.anchor) : null;
    if (!landing || !scroller) {
      return window.scrollY;
    }
    const target = this.targetScroll(scroller, landing);
    if (scroller === document.scrollingElement) {
      return target;
    }
    scroller.scrollTop = target;
    return window.scrollY;
  };

  /**
   * Going back to the gallery is the only case with somewhere to return to.
   * Everything else starts at the top. The standalone case is the subtle one:
   * with no saved position, the gallery is scrolled so the tile this flight
   * lands on is centred in view — the stage flies to something the eye can
   * follow.
   */
  private targetScroll(
    scroller: Element,
    landing: { closing: boolean; slug: string | null },
  ): number {
    if (!landing.closing) {
      return 0;
    }
    if (this.galleryScroll !== null) {
      return this.galleryScroll;
    }
    const root = this.anchor?.closest('[data-choreo-site]');
    const tile = landing.slug
      ? root?.querySelector<HTMLElement>(
          `[${TILE_ATTRIBUTE}='${CSS.escape(landing.slug)}']`,
        )
      : null;
    if (!tile) {
      return 0;
    }
    const box = tile.getBoundingClientRect();
    const frame =
      scroller === document.scrollingElement
        ? { top: 0, height: window.innerHeight }
        : scroller.getBoundingClientRect();
    return Math.max(
      0,
      scroller.scrollTop +
        box.top -
        frame.top -
        (frame.height - box.height) / 2,
    );
  }
}
