/**
 * Is anything still moving?
 *
 * Ember Animated's maturity is not its sprite code, it is `animationsSettled()`
 * — a test can say "when everything has stopped" instead of `sleep(200)` and
 * hoping. This is the machinery under that: every part of the binding that can
 * still have work outstanding registers a probe, and a probe answers with a
 * short reason string while it is busy and `false` when it is not.
 *
 * The reason is not decoration. A test that times out waiting for motion is
 * useless if all it can say is "timed out"; `whatIsBusy()` names the element
 * and the property that never stopped, which is usually the bug itself.
 *
 * Deliberately NOT an `@ember/test-waiters` waiter, which would make plain
 * `await settled()` block until animations finish. That reads well in a doc and
 * is wrong here: the interruption suite exists precisely to click again while
 * something is still in flight, and a blocking waiter would turn every one of
 * those into a wait-for-completion — the tests would pass by no longer testing
 * anything. Waiting for motion is a thing a test asks for, not a thing it gets.
 *
 * Probes are module-global rather than owner-linked because the things they
 * watch are: the engine's frameloop, the projection tree and the beacon
 * registry are all one per document, and a probe that could not see across an
 * owner boundary could not see the far-match barrier at all. A probe over one
 * element's or component's state is removed in its destructor, so nothing
 * outlives its element; a probe over module-global state stays registered.
 */

/** busy → a short reason; idle → false */
export type BusyProbe = () => false | string;

const probes = new Set<BusyProbe>();

/**
 * Make a layer's own in-flight work count toward "motion is busy", so
 * `animationsSettled()` and `whatIsBusy()` wait on it too. The probe runs on
 * every settle check and answers `false` at rest or a short reason while busy.
 * Returns the remover: a probe over one instance's state is removed in that
 * instance's destructor; a probe over module-global state (Choreo's far-match
 * barrier) may stay registered for the life of the page.
 */
export function registerBusyProbe(probe: BusyProbe): () => void {
  probes.add(probe);
  return () => {
    probes.delete(probe);
  };
}

/** every reason the binding is not at rest, for a timeout message */
export function whatIsBusy(): string[] {
  const reasons: string[] = [];
  for (const probe of probes) {
    const reason = probe();
    if (reason) {
      reasons.push(reason);
    }
  }
  return reasons;
}

export function isMotionIdle(): boolean {
  for (const probe of probes) {
    if (probe()) {
      return false;
    }
  }
  return true;
}
