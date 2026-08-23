/**
 * Far matching — one identity, two regions.
 *
 * A `<Choreo>` is a scene: it reconciles its own participants and nothing else.
 * That is the point of nesting, and it is why an element that leaves one region
 * and appears in another looks like a death and an unrelated birth rather than
 * one continuous flight.
 *
 * Ember Animated calls the two halves `sentSprites` and `receivedSprites` and
 * pairs them at a `farMatch` rendezvous — every animator that is starting this
 * pass parks, they all wake together, and each reads the others' lists. The
 * legacy boxel-motion filed this as CS-260 and never built it.
 *
 * The rendezvous here is a barrier in the render pass itself, not a timed one.
 * Every region that will animate this pass announces itself while Glimmer is
 * still rendering (`join`), the first announcement books one post-render
 * callback for all of them, and that callback runs three phases in order:
 *
 *   1. MEASURE — every region builds its changeset. Nobody has run anything,
 *      so nobody's in-flight values are polluting anybody else's measurement.
 *   2. MATCH   — inserted ids are paired against removed ids in OTHER regions.
 *   3. RUN     — every region compiles and plays its own timeline.
 *
 * All three are synchronous, so no frame is painted between a region measuring
 * and a region pinning its start values. That matters: the whole reason cues
 * pin synchronously is that one frame of the destination layout is visible
 * otherwise, and a barrier that yielded would hand that frame back.
 *
 * The pairing itself is the same shape as the counterpart matching a region
 * already does within itself. The receiving element is the one that flies: it
 * takes the sender's bounds as an `initial` it never had, and the sender is
 * dropped rather than orphaned, because the thing it would animate is already
 * being animated somewhere else.
 *
 * Bounds cross the boundary in PAGE space, which is the only space the two
 * regions agree on — a region-relative measurement means nothing to a region
 * somewhere else on the page.
 */
import { registerBusyProbe } from '../activity.ts';
import type { ChoreoNode, Sprite } from './types.ts';

/** one region's measured pass, waiting for the others before it runs */
export interface Pass {
  claimed: ChoreoNode[];
  host: PassHost;
  inserted: Sprite[];
  kept: Sprite[];
  removed: Sprite[];
  root: HTMLElement;
}

export interface PassHost {
  /** phase 3: compile and play, now that identities have been reconciled */
  finishPass(pass: Pass): void;
  /** phase 1: snapshot vs. now, into a changeset — no animation started yet */
  measurePass(): Pass | undefined;
}

const intents = new Set<PassHost>();
let booked = false;
/** a seam for the region to book the callback without far.ts importing the scheduler */
let schedule: (fn: () => void) => void = (fn) => fn();

export function setPassScheduler(fn: (run: () => void) => void) {
  schedule = fn;
}

/**
 * Announce that this region has a pass coming. Called while Glimmer is still
 * rendering, so by the time the barrier runs, every region taking part in this
 * pass is known — which is what lets the match be synchronous.
 */
export function join(host: PassHost) {
  intents.add(host);
  if (!booked) {
    booked = true;
    schedule(runBarrier);
  }
}

export function leave(host: PassHost) {
  intents.delete(host);
}

/** a booked barrier is work outstanding: nothing has measured yet */
registerBusyProbe(() => booked && 'far-match barrier booked');

/**
 * Drop a barrier that will never run. A test torn down between `join` and the
 * post-render callback leaves a destroyed region parked in `intents`, and the
 * next test's first pass would try to measure it. `setupMotion(hooks)` calls
 * this.
 */
export function resetBarrier() {
  intents.clear();
  booked = false;
}

/** mount everything rendered this pass before ANY region measures */
let beforeMeasure: () => void = () => {};
export function setBeforeMeasure(fn: () => void) {
  beforeMeasure = fn;
}

function runBarrier() {
  booked = false;
  const hosts = [...intents];
  intents.clear();
  beforeMeasure();
  const passes: Pass[] = [];
  for (const host of hosts) {
    const pass = host.measurePass();
    if (pass) {
      passes.push(pass);
    }
  }
  if (passes.length > 1) {
    match(passes);
  }
  for (const pass of passes) {
    pass.host.finishPass(pass);
  }
}

const deltaOf = (s: Sprite) =>
  s.initial && s.final
    ? {
        height: s.final.page.height - s.initial.page.height,
        width: s.final.page.width - s.initial.page.width,
        x: s.final.page.x - s.initial.page.x,
        y: s.final.page.y - s.initial.page.y,
      }
    : undefined;

/**
 * Pair an id inserted in one region against the same id removed in another.
 *
 * The receiver becomes a kept sprite carrying the sender as its counterpart —
 * exactly what same-region counterpart matching produces, so every step that
 * already understands `kept` and `counterpart` works across the boundary with
 * no further teaching. The sender is flagged `sent` so its own region knows to
 * let it go quietly instead of playing a removal for it.
 */
function match(passes: Pass[]) {
  for (const pass of passes) {
    for (const s of pass.inserted) {
      if (s.id === null || s.counterpart) {
        continue;
      }
      for (const other of passes) {
        if (other === pass) {
          continue;
        }
        const sender = other.removed.find(
          (r) => r.id === s.id && !r.counterpart && !r.sent,
        );
        if (sender) {
          sender.sent = true;
          s.counterpart = sender;
          s.initial = sender.initial;
          s.type = 'kept';
          s.delta = deltaOf(s);
          break;
        }
      }
    }
  }
}
