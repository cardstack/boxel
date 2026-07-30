// Small guarded reads of the browser environment the telemetry instrument depends
// on. Each one exists because the instrument must never throw from a hook, so it
// tolerates a missing API rather than assuming one — and because a prerender tab
// has to be recognizable from anywhere.

export function now(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function isDocumentHidden(): boolean {
  return (
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
  );
}

// UTF-8 byte length, matching the realm-server's TextEncoder-based size check.
export function byteLength(s: string): number {
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length;
  }
}

export function supportedEntryTypes(): readonly string[] {
  let ctor = PerformanceObserver as unknown as {
    supportedEntryTypes?: readonly string[];
  };
  return ctor.supportedEntryTypes ?? [];
}

// A short macrotask tick used to fold a settling tail into the card-load
// window measurement (the difference between loading_ms and settle_ms).
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function isRenderContext(): boolean {
  return Boolean(
    (globalThis as { __boxelRenderContext?: unknown }).__boxelRenderContext,
  );
}
