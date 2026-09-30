// Motion tests wait on browser playback. If a crossing is skipped or a
// regression stops a timeline, these fail the test with a named deadline
// instead of hanging the whole shard.

export function within<T>(
  promise: Promise<T> | undefined,
  what: string,
  ms = 5000,
): Promise<T> {
  if (!promise) return Promise.reject(new Error(`${what}: never started`));
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what}: not within ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// A check to call on each pass of a polling loop.
export function motionDeadline(what: string, ms = 5000) {
  let deadline = performance.now() + ms;
  return () => {
    if (performance.now() > deadline)
      throw new Error(`${what}: not within ${ms}ms`);
  };
}
