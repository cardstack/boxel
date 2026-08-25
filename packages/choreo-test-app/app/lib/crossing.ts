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
 * What is left here is the part that is genuinely the app's: KNOWING a
 * crossing has begun (the region stays router-agnostic by design — §9), and
 * knowing where the arriving page wants the window.
 */
import type Transition from '@ember/routing/transition';
import { tracked } from '@glimmer/tracking';
import type { ChoreoContext } from 'glimmer-motion';
import { factor, setCrossing } from 'test-app/lib/tempo';

const DEMO_ROUTE = 'demo';

class State {
  @tracked active = false;
}
const state = new State();

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

/** which crossing is current — a stale run's settle must not stand down a newer one */
let generation = 0;

function demoIdOf(info: Transition['to']): string | undefined {
  return (info?.params as Record<string, string> | undefined)?.['demo_id'];
}

/** a crossing pass is in flight — the region's timeline renders only then */
export function crossingActive(): boolean {
  return state.active;
}

/** the application template hands the region's context over once, on mount */
export function wireRegion(c: ChoreoContext): void {
  region = c;
}

/** routeWillChange: remember what this crossing is, and arm the timeline */
export function beginCrossing(transition: Transition): void {
  if (transition.isAborted || !transition.from || !transition.to) {
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
  state.active = true;
  // cards mounting mid-crossing skip their entrance: twenty-six springs
  // firing as the flight lands is a kink at the end of a smooth move
  setCrossing(true);
  watchRun(++generation);
}

/** the crossing's run has finished (or never materialised): stand down */
export function endCrossing(): void {
  state.active = false;
  setCrossing(false);
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
  generation++;
  endCrossing();
}

/**
 * Stand down when the crossing's run finishes. The run does not exist yet
 * when the route hook fires — it is born after the swap renders — so this
 * latches the first live run the region produces. Region runs only exist
 * while the timeline is rendered, and the timeline renders only during a
 * crossing, so the first live run IS the crossing's. The deadline is a
 * backstop for a transition that never produced a pass (aborted, or
 * rendered identically).
 */
function watchRun(gen: number): void {
  const started = performance.now();
  const latch = (run: NonNullable<ChoreoContext['run']>) => {
    void run.finished.then(() => {
      // an interrupted crossing's run resolves as the NEXT crossing
      // begins; only the current generation may stand the timeline down —
      // and a run REPLACED mid-flight (a real interruption recompiles the
      // score) hands over to its successor instead of ending anything
      if (gen !== generation) {
        return;
      }
      const current = region?.run;
      if (current && current !== run && !current.isDone()) {
        latch(current);
        return;
      }
      endCrossing();
    });
  };
  const look = () => {
    if (!state.active || gen !== generation) {
      return;
    }
    const run = region?.run;
    if (run && !run.isDone()) {
      latch(run);
      return;
    }
    if (performance.now() - started > 4000) {
      endCrossing();
      return;
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
