// Bounded observation of work that is already in flight.
//
// Distinct from a timeout: nothing is cancelled and nothing is abandoned. The
// caller learns whether the work finished inside the window and decides what to
// report; the work itself keeps running and a later observation sees it done.
// That fits gates in front of long-running background work, where holding a
// request until the work finishes is worse than answering "not yet" — the
// caller can act on an answer, but a held connection just consumes its deadline
// somewhere it cannot see.
//
// Resolves true when `promise` fulfills before `deadline`, false when the
// deadline arrives first. A rejection that wins the race propagates, because
// work having failed is a different answer from work still being outstanding
// and callers generally need to tell them apart.
//
// `deadline` is an absolute `Date.now()`-style timestamp, not a duration, so
// that several gates in one request can share a single deadline and the request
// spends one budget rather than one per gate. Passing a duration yields a
// deadline in 1970 — i.e. immediately expired.
//
// Ties go to the work: an already-fulfilled promise reports settled even when
// the deadline has already passed, because the fulfilment is observed on the
// microtask queue and the deadline on a macrotask. That ordering is relied on —
// work that is demonstrably finished must never be reported as outstanding, or
// a gate would answer "not ready" about something already done.
export async function settledBy(
  promise: Promise<unknown>,
  deadline: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = new Promise<false>((resolve) => {
    timer = setTimeout(
      () => resolve(false),
      Math.max(0, deadline - Date.now()),
    );
    // Deliberately not `unref`'d. This timer is what makes the deadline
    // binding: if the awaited work is the only other pending thing, an
    // unref'd timer lets the process exit with this promise never settling,
    // so the caller never gets its answer at all. The hold it adds is capped
    // by the deadline and released below the moment the race settles.
  });
  let fulfilled = promise.then(() => true as const);
  try {
    return await Promise.race([fulfilled, expired]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
