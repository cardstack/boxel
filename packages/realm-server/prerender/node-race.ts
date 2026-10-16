// Bounding a promise by a real Node timer, for code that waits on Chrome.
//
// The prerender server process is not the rendered page, so `setTimeout` here
// is the genuine one (the render-timer stub only replaces the page's timers),
// and it fires whether or not Chrome ever answers. The losing promise is
// abandoned, not cancelled: a CDP call left pending keeps waiting on Chrome,
// but nothing waits on it.

export const TIMED_OUT = Symbol('node-timeout');

export async function raceNodeTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
