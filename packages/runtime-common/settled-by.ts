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
export async function settledBy(
  promise: Promise<unknown>,
  deadline: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
    // Never keep the process alive for this timer alone. Present on node,
    // absent on the browser's timer handles.
    timer.unref?.();
  });
  let fulfilled = promise.then(() => true as const);
  // A rejection arriving after the deadline has already lost the race, so no
  // caller is left to observe it. Mark it handled rather than letting it
  // surface as an unhandled rejection.
  fulfilled.catch(() => {});
  try {
    return await Promise.race([fulfilled, expired]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
