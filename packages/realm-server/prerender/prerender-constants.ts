export const PRERENDER_SERVER_STATUS_HEADER = 'X-Boxel-Prerender-Server-Status';
export const PRERENDER_SERVER_STATUS_DRAINING = 'draining';
export const PRERENDER_SERVER_DRAINING_STATUS_CODE = 410;

// Base timeout for a single prerender capture on the prerender server
// (DOM rendering + data loading inside the headless browser).
const DEFAULT_RENDER_TIMEOUT_MS = 90_000;
// Additional budget for request-level timeouts that wrap render work across
// process/network boundaries (manager proxying, serialization, retries, etc).
// Request timeout defaults are computed as:
//   render timeout + overhead
// so request-level aborts happen after render-level timeouts, not before.
const DEFAULT_RENDER_TIMEOUT_OVERHEAD_MS = 60_000;
// Global lower bound used when parsing timeout env vars so invalid/too-small
// values (0, negative, NaN) do not cause immediate aborts or tight retry loops.
const MIN_TIMEOUT_MS = 1_000;

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
  let parsed = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) {
    return Math.max(MIN_TIMEOUT_MS, fallback);
  }
  return Math.max(MIN_TIMEOUT_MS, parsed);
}

// Primary knob for prerender timeout behavior across layers.
export const prerenderRenderTimeoutMs = parseTimeoutMs(
  process.env.RENDER_TIMEOUT_MS,
  DEFAULT_RENDER_TIMEOUT_MS,
);

const defaultPrerenderRequestTimeoutMs =
  prerenderRenderTimeoutMs + DEFAULT_RENDER_TIMEOUT_OVERHEAD_MS;

export const prerenderRequestTimeoutMs = parseTimeoutMs(
  process.env.PRERENDER_REQUEST_TIMEOUT_MS,
  defaultPrerenderRequestTimeoutMs,
);

export function resolvePrerenderManagerRequestTimeoutMs(): number {
  return parseTimeoutMs(
    process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS,
    prerenderRequestTimeoutMs,
  );
}

export function resolvePrerenderServerProxyTimeoutMs(): number {
  return parseTimeoutMs(
    process.env.PRERENDER_SERVER_TIMEOUT_MS,
    prerenderRequestTimeoutMs,
  );
}
