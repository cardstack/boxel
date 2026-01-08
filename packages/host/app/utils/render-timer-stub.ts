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
type RenderTimerType = 'setTimeout' | 'setInterval';
type RenderTimerRecord = {
  type: RenderTimerType;
  delay?: number;
  callbackName?: string;
  stack?: string | null;
};
const TIMER_SUMMARY_HEADER = 'Timers blocked during prerender:';
let blockedTimers: RenderTimerRecord[] = [];
const TIMER_SUMMARY_GLOBAL = '__boxelRenderTimerSummary';

function registerTimerSummaryGlobal() {
  if (typeof globalThis === 'undefined') {
    return;
  }
  (globalThis as any)[TIMER_SUMMARY_GLOBAL] = () => getRenderTimerSummary();
}

function unregisterTimerSummaryGlobal() {
  if (typeof globalThis === 'undefined') {
    return;
  }
  delete (globalThis as any)[TIMER_SUMMARY_GLOBAL];
}

function recordBlockedTimer(
  type: RenderTimerType,
  args:
    | Parameters<typeof window.setTimeout>
    | Parameters<typeof window.setInterval>,
) {
  let delay =
    typeof args[1] === 'number' && Number.isFinite(args[1])
      ? args[1]
      : undefined;
  let callbackName =
    typeof args[0] === 'function' && args[0].name ? args[0].name : undefined;
  let stack: string | null = null;
  try {
    stack = new Error(`Timer blocked during prerender (${type})`).stack ?? null;
  } catch {
    stack = null;
  }
  blockedTimers.push({
    type,
    ...(delay !== undefined ? { delay } : {}),
    ...(callbackName ? { callbackName } : {}),
    stack,
  });
}

export function resetRenderTimerStats() {
  blockedTimers = [];
}

export function getRenderTimerSummary(): string | undefined {
  if (!blockedTimers.length) {
    return undefined;
  }
  let counts = blockedTimers.reduce(
    (acc, timer) => {
      acc[timer.type] += 1;
      return acc;
    },
    { setTimeout: 0, setInterval: 0 },
  );
  let lines = [
    TIMER_SUMMARY_HEADER,
    `Total timers blocked: ${blockedTimers.length}`,
    `setTimeout: ${counts.setTimeout}`,
    `setInterval: ${counts.setInterval}`,
    'Stacks (timer scheduling):',
  ];
  blockedTimers.forEach((timer, index) => {
    let label = `${index + 1}) ${timer.type}`;
    if (timer.delay !== undefined) {
      label += ` (${timer.delay}ms)`;
    }
    if (timer.callbackName) {
      label += ` callback: ${timer.callbackName}`;
    }
    lines.push(label);
    if (timer.stack) {
      for (let line of timer.stack.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
  });
  return lines.join('\n');
}

export function appendRenderTimerSummaryToStack(
  stack: string | null | undefined,
): string | undefined {
  let summary = getRenderTimerSummary();
  if (!summary) {
    return stack ?? undefined;
  }
  if (stack && stack.includes(TIMER_SUMMARY_HEADER)) {
    return stack;
  }
  if (!stack) {
    return summary;
  }
  return `${stack}\n\n${summary}`;
}

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
  registerTimerSummaryGlobal();
  restoreSetTimeout = window.setTimeout;
  restoreSetInterval = window.setInterval;
  invokeSetTimeout = window.setTimeout.bind(window);
  invokeSetInterval = window.setInterval.bind(window);

  window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => {
    if (!timersBlocked() || !invokeSetTimeout) {
      return invokeSetTimeout ? invokeSetTimeout(...args) : (0 as const);
    }
    recordBlockedTimer('setTimeout', args);
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
    recordBlockedTimer('setInterval', args);
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
  if (stubDepth === 0 && restoreSetTimeout && restoreSetInterval) {
    window.setTimeout = restoreSetTimeout;
    window.setInterval = restoreSetInterval;
    restoreSetTimeout = undefined;
    restoreSetInterval = undefined;
    invokeSetTimeout = undefined;
    invokeSetInterval = undefined;
    warnedTimeout = false;
    warnedInterval = false;
    resetRenderTimerStats();
    unregisterTimerSummaryGlobal();
  }
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
