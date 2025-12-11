let restoreSetTimeout: typeof window.setTimeout | undefined;
let restoreSetInterval: typeof window.setInterval | undefined;
let invokeSetTimeout:
  | ((
      ...args: Parameters<typeof window.setTimeout>
    ) => ReturnType<typeof window.setTimeout>)
  | undefined;
let invokeSetInterval:
  | ((
      ...args: Parameters<typeof window.setInterval>
    ) => ReturnType<typeof window.setInterval>)
  | undefined;
const nativeClearTimeout =
  typeof globalThis.clearTimeout === 'function'
    ? globalThis.clearTimeout.bind(globalThis)
    : undefined;
const nativeClearInterval =
  typeof globalThis.clearInterval === 'function'
    ? globalThis.clearInterval.bind(globalThis)
    : undefined;
let stubDepth = 0;
let blockDepth = 0;
let warnedTimeout = false;
let warnedInterval = false;

function timersBlocked() {
  return stubDepth > 0 && blockDepth > 0;
}

function installStubs() {
  if (typeof window === 'undefined') {
    return;
  }
  if (restoreSetTimeout) {
    return;
  }
  restoreSetTimeout = window.setTimeout;
  restoreSetInterval = window.setInterval;
  invokeSetTimeout = window.setTimeout.bind(window);
  invokeSetInterval = window.setInterval.bind(window);

  window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => {
    if (!timersBlocked() || !invokeSetTimeout) {
      return invokeSetTimeout ? invokeSetTimeout(...args) : (0 as const);
    }
    if (!warnedTimeout) {
      console.warn(
        '[boxel] setTimeout is disabled while prerendering to prevent runaway timers',
      );
      warnedTimeout = true;
    }
    // Return a syntactically valid timeout handle but immediately clear it so
    // no timer keeps running while prerendering.
    let handle = invokeSetTimeout(() => {}, args[1] as number | undefined);
    nativeClearTimeout?.(handle as unknown as number | undefined);
    return handle;
  }) as typeof window.setTimeout;

  window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
    if (!timersBlocked() || !invokeSetInterval) {
      return invokeSetInterval ? invokeSetInterval(...args) : (0 as const);
    }
    if (!warnedInterval) {
      console.warn(
        '[boxel] setInterval is disabled while prerendering to prevent runaway timers',
      );
      warnedInterval = true;
    }
    // Likewise for intervals: issue and clear right away to satisfy callers.
    let handle = invokeSetInterval(() => {}, args[1] as number | undefined);
    nativeClearInterval?.(handle as unknown as number | undefined);
    return handle;
  }) as typeof window.setInterval;
}

function restoreStubs() {
  if (typeof window === 'undefined') {
    return;
  }
  if (stubDepth !== 0) {
    return;
  }
  if (restoreSetTimeout) {
    window.setTimeout = restoreSetTimeout;
  }
  if (restoreSetInterval) {
    window.setInterval = restoreSetInterval;
  }
  restoreSetTimeout = undefined;
  restoreSetInterval = undefined;
  invokeSetTimeout = undefined;
  invokeSetInterval = undefined;
  warnedTimeout = false;
  warnedInterval = false;
}

export function enableRenderTimerStub(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }
  stubDepth++;
  installStubs();
  return () => {
    stubDepth = Math.max(stubDepth - 1, 0);
    if (stubDepth === 0) {
      blockDepth = 0;
      restoreStubs();
    }
  };
}

export function beginTimerBlock(): () => void {
  blockDepth++;
  return () => {
    blockDepth = Math.max(blockDepth - 1, 0);
  };
}

export async function withTimersBlocked<T>(
  cb: () => Promise<T> | T,
): Promise<T> {
  let release = beginTimerBlock();
  try {
    return await cb();
  } finally {
    release();
  }
}
