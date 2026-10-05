/**
 * The gallery ⇄ demo crossing — what remains of the 435-line animateView
 * orchestration this file replaced.
 *
 * The transition itself belongs to the library now: `<Choreo @route>` in the
 * application template treats the route swap as one render pass, and the
 * timeline says the whole move — leaves fade, the paired stage and type fly,
 * arrivals land near the settle. Nothing is snapshotted, so the live demos
 * keep running through the move; nothing is veiled, because real elements
 * cover their own ground; and nothing pauses the rest of the page, because
 * only what a viewport can see animates (`onstage`).
 *
 * The LIFECYCLE — arm before the run exists, hand over when a run is replaced
 * mid-flight, stand down on the survivor or on a deadline — belongs to the
 * library too, as `createArming()`: this file was one of two hand-written
 * copies of it, and the second copy is what made it a library part.
 *
 * What is left here is the part that is genuinely the app's: knowing WHAT
 * this crossing is (the region stays router-agnostic by design — §9), and
 * knowing where the arriving page wants the window.
 */
import { type ChoreoContext, createArming } from '@cardstack/choreo';
import type Transition from '@ember/routing/transition';
import { tracked } from '@glimmer/tracking';
import { factor, setCrossing } from 'test-app/lib/tempo';

const DEMO_ROUTE = 'demo';

class State {
  /** the card a RETURN crossing lands on, null any other time */
  @tracked closingId: string | null = null;
}
const state = new State();

/**
 * The crossing's own lifecycle. Everything app-specific about standing down
 * — the counterpart card, the entrance gate the cards check — hangs off the
 * one hook.
 */
const crossing = createArming({
  onStandDown: () => {
    if (state.closingId !== null) {
      state.closingId = null;
    }
    setCrossing(false);
  },
});

/**
 * Where the gallery was standing, so the back button can put it back.
 * Null until the gallery has actually been left: a demo loaded standalone
 * has no position to restore, and pretending "0" was one sends the stage
 * flying toward a card thousands of pixels below the fold.
 */
let galleryScroll: number | null = null;

/** what the crossing in flight is doing, for the scroll intent */
let landing: { closing: boolean; id: string | undefined } = {
  closing: false,
  id: undefined,
};

/** the application region's context, for watching the crossing's run */
let region: ChoreoContext | null = null;

function demoIdOf(info: Transition['to']): string | undefined {
  return (info?.params as Record<string, string> | undefined)?.['demo_id'];
}

/** a crossing pass is in flight — the region's timeline renders only then */
export function crossingActive(): boolean {
  return crossing.active();
}

/** a crossing is in flight AND it is the trip home to the gallery */
export function returningHome(): boolean {
  return crossing.active() && state.closingId !== null;
}

/**
 * The card the return flight lands on — the one tile that is PART of the
 * crossing. Every other tile is unmatched: the crossing never touches it,
 * and it enters on its own once the move has landed.
 */
export function counterpartId(): string | null {
  return state.closingId;
}

/** the application template hands the region's context over once, on mount */
export function wireRegion(c: ChoreoContext): void {
  region = c;
}

/** routeWillChange: remember what this crossing is, and arm the timeline */
export function beginCrossing(transition: Transition): void {
  if (transition.isAborted || !transition.from || !transition.to || !region) {
    return;
  }
  const leaving = transition.from.name;
  const arriving = transition.to.name;
  const opening = arriving === DEMO_ROUTE && leaving !== DEMO_ROUTE;
  const closing = leaving === DEMO_ROUTE && arriving !== DEMO_ROUTE;
  if (opening) {
    galleryScroll = window.scrollY;
  }
  landing = { closing, id: closing ? demoIdOf(transition.from) : undefined };
  // Instant means instant: with the timeline unrendered the pass compiles
  // nothing — no run, not a zero-length one — and the region still places
  // the scroll inside the pass, clamped against the arriving page's height.
  if (factor() === 0) {
    return;
  }
  state.closingId = closing ? (landing.id ?? null) : null;
  // cards mounting mid-crossing skip their entrance: twenty-six springs
  // firing as the flight lands is a kink at the end of a smooth move
  setCrossing(true);
  crossing.begin(region);
}

/**
 * Resolves when the crossing in flight stands down — immediately if none
 * is. The gallery uses this to bring its thirty live stages up AFTER the
 * landing rather than booting them all inside the pass: the mount is the
 * single heaviest render in the app, and paying it under the flight is
 * exactly the jank the crossing exists to avoid.
 */
export function crossingSettled(): Promise<void> {
  return crossing.settled();
}

/** the crossing's run has finished (or never materialised): stand down */
export function endCrossing(): void {
  crossing.end();
}

/**
 * `@scroll` for the region: where the arriving page wants the window,
 * applied inside the pass — after the swap renders, before final bounds
 * are measured, so the flight lands where the page will actually stand.
 *
 * Going back to the gallery is the only case with somewhere to return to.
 * Everything else starts at the top — including demo to demo, which can be
 * asked for from the pager at the very BOTTOM of the page. The standalone
 * case is the subtle one: with no saved position, the gallery is scrolled
 * so the card this flight lands on is centred in view — the stage flies to
 * something the eye can follow.
 */
export function scrollIntent(): number {
  if (!landing.closing) {
    return 0;
  }
  if (galleryScroll !== null) {
    return galleryScroll;
  }
  const card = landing.id
    ? document.querySelector<HTMLElement>(`.card[data-demo='${landing.id}']`)
    : null;
  if (!card) {
    return 0;
  }
  const box = card.getBoundingClientRect();
  return Math.max(
    0,
    window.scrollY + box.top - (window.innerHeight - box.height) / 2
  );
}

/** test hook: forget the remembered scroll and stand any crossing down */
export function resetCrossing(): void {
  galleryScroll = null;
  landing = { closing: false, id: undefined };
  crossing.end();
}
