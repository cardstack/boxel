let restoreSetTimeout: typeof window.setTimeout | undefined;
let restoreSetInterval: typeof window.setInterval | undefined;
let restoreRequestAnimationFrame:
  | typeof window.requestAnimationFrame
  | undefined;
let restoreCancelAnimationFrame: typeof window.cancelAnimationFrame | undefined;
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
let invokeRequestAnimationFrame:
  | ((
      ...args: Parameters<typeof window.requestAnimationFrame>
    ) => ReturnType<typeof window.requestAnimationFrame>)
  | undefined;
let invokeCancelAnimationFrame:
  | ((
      ...args: Parameters<typeof window.cancelAnimationFrame>
    ) => ReturnType<typeof window.cancelAnimationFrame>)
  | undefined;
const nativeClearTimeout =
  typeof globalThis.clearTimeout === 'function'
    ? globalThis.clearTimeout.bind(globalThis)
    : undefined;
const nativeClearInterval =
  typeof globalThis.clearInterval === 'function'
    ? globalThis.clearInterval.bind(globalThis)
    : undefined;
const nativeCancelAnimationFrame =
  typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : undefined;
let stubDepth = 0;
let blockDepth = 0;
let warnedTimeout = false;
let warnedInterval = false;
let warnedAnimationFrame = false;

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
  restoreRequestAnimationFrame = window.requestAnimationFrame;
  restoreCancelAnimationFrame = window.cancelAnimationFrame;
  invokeSetTimeout = window.setTimeout.bind(window);
  invokeSetInterval = window.setInterval.bind(window);
  invokeRequestAnimationFrame =
    window.requestAnimationFrame?.bind(window) ?? undefined;
  invokeCancelAnimationFrame =
    window.cancelAnimationFrame?.bind(window) ?? undefined;

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

  window.requestAnimationFrame = ((
    ...args: Parameters<typeof window.requestAnimationFrame>
  ) => {
    if (!timersBlocked() || !invokeRequestAnimationFrame) {
      return invokeRequestAnimationFrame
        ? invokeRequestAnimationFrame(...args)
        : (0 as const);
    }
    if (!warnedAnimationFrame) {
      console.warn(
        '[boxel] requestAnimationFrame is disabled while prerendering to prevent runaway timers',
      );
      warnedAnimationFrame = true;
    }
    let handle = invokeRequestAnimationFrame(() => {});
    nativeCancelAnimationFrame?.(handle as unknown as number);
    return handle;
  }) as typeof window.requestAnimationFrame;

  window.cancelAnimationFrame = ((
    ...args: Parameters<typeof window.cancelAnimationFrame>
  ) => {
    return invokeCancelAnimationFrame?.(...args);
  }) as typeof window.cancelAnimationFrame;
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
  if (restoreRequestAnimationFrame) {
    window.requestAnimationFrame = restoreRequestAnimationFrame;
  }
  if (restoreCancelAnimationFrame) {
    window.cancelAnimationFrame = restoreCancelAnimationFrame;
  }
  restoreSetTimeout = undefined;
  restoreSetInterval = undefined;
  restoreRequestAnimationFrame = undefined;
  restoreCancelAnimationFrame = undefined;
  invokeSetTimeout = undefined;
  invokeSetInterval = undefined;
  invokeRequestAnimationFrame = undefined;
  invokeCancelAnimationFrame = undefined;
  warnedTimeout = false;
  warnedInterval = false;
  warnedAnimationFrame = false;
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
