let originalSetTimeout: typeof window.setTimeout | undefined;
let originalSetInterval: typeof window.setInterval | undefined;
let stubDepth = 0;
let hasLogged = false;

function ensureStubs() {
  if (typeof window === 'undefined') {
    return;
  }
  if (stubDepth > 0) {
    return;
  }
  originalSetTimeout = window.setTimeout;
  originalSetInterval = window.setInterval;
  hasLogged = false;
  window.setTimeout = ((..._args: Parameters<typeof window.setTimeout>) => {
    if (!hasLogged) {
      console.warn(
        '[boxel] setTimeout is disabled while prerendering to prevent runaway timers',
      );
      hasLogged = true;
    }
    return 0 as unknown as ReturnType<typeof window.setTimeout>;
  }) as typeof window.setTimeout;
  window.setInterval = ((..._args: Parameters<typeof window.setInterval>) => {
    if (!hasLogged) {
      console.warn(
        '[boxel] setInterval is disabled while prerendering to prevent runaway timers',
      );
      hasLogged = true;
    }
    return 0 as unknown as ReturnType<typeof window.setInterval>;
  }) as typeof window.setInterval;
}

export function enableRenderTimerStub(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  ensureStubs();
  stubDepth++;
  return () => {
    if (typeof window === 'undefined') {
      return;
    }
    stubDepth = Math.max(stubDepth - 1, 0);
    if (stubDepth === 0) {
      if (originalSetTimeout) {
        window.setTimeout = originalSetTimeout;
        originalSetTimeout = undefined;
      }
      if (originalSetInterval) {
        window.setInterval = originalSetInterval;
        originalSetInterval = undefined;
      }
    }
  };
}
