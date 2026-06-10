// Out-of-process in-flight network tracker for prerender pages.
//
// Why this module exists:
//
//   When a render hangs, the most useful question is often "which
//   resource fetch is it waiting on?" The host's own
//   `__boxelRenderDiagnostics()` can answer that — but only while the
//   page's JS thread is responsive. The render-hang failure mode we
//   most want to discriminate is the one where the JS thread is wedged
//   (a runaway sync loop, or a never-settling Glimmer render), and in
//   that case any `page.evaluate(...)` call blocks until the timeout
//   path tears the tab down, so the host diagnostic comes back null.
//
//   CDP's Network domain runs in the browser process, out of band from
//   the page's JS thread. It keeps reporting request lifecycle events
//   even while the page's main thread is pegged. That makes a passive
//   CDP-side request map the one signal that survives exactly the
//   conditions where the in-page hook goes dark — so on the timeout
//   path we can still name the fetch (or fetches) that never came back.
//
// Cost model:
//
//   This runs for EVERY render, not just the ones that time out, so it
//   must stay cheap: a single Map keyed by CDP requestId, mutated on
//   request start / finish / fail, with no per-request logging. Reading
//   the pending list (sort + cap + URL truncation) happens only on the
//   timeout path, where the work is already bounded by a torn-down tab.
//
// Lifecycle:
//
//   `attachNetworkInflightTracker` creates a per-page CDP session and
//   registers the tracker in a module-level `WeakMap<Page, …>` so the
//   timeout path can look it up from just the page handle, without
//   any global mutable state. Puppeteer auto-detaches the CDP session
//   when the page closes, and the WeakMap entry is collected with the
//   page, so there is no explicit teardown. Attach failures (a race
//   with page teardown, transient CDP errors) are logged at debug and
//   resolve without throwing — this is best-effort observability and
//   must never break or slow the render path.

import type { CDPSession, Page } from 'puppeteer';
import { logger } from '@cardstack/runtime-common';

const log = logger('prerenderer');

// Hard caps so a pathological page (thousands of concurrent fetches)
// can't turn the timeout-path read into expensive work or bloat the
// persisted diagnostics row.
const MAX_PENDING_REPORTED = 20;
const MAX_URL_LENGTH = 200;

// Local subset of the CDP `Network.*` event payloads we read. We
// deliberately don't import `devtools-protocol` (a transitive, not
// direct, dependency of puppeteer) — declaring just the fields used
// keeps the import graph honest. Full shapes:
//   https://chromedevtools.github.io/devtools-protocol/tot/Network/
interface CdpRequestWillBeSentEvent {
  requestId: string;
  request: { url: string };
}
interface CdpLoadingFinishedEvent {
  requestId: string;
}
interface CdpLoadingFailedEvent {
  requestId: string;
}

export interface PendingNetworkRequest {
  url: string;
  ageMs: number;
}

export class NetworkInflightTracker {
  // requestId -> { url, startedAt }. Bare Map mutated on the CDP
  // event stream; never iterated except on the timeout path.
  #inFlight = new Map<string, { url: string; startedAt: number }>();

  recordStarted(requestId: string, url: string): void {
    this.#inFlight.set(requestId, { url, startedAt: Date.now() });
  }

  recordSettled(requestId: string): void {
    this.#inFlight.delete(requestId);
  }

  // Snapshot of requests still outstanding, oldest first (the longest-
  // hanging fetch is the most interesting), capped and URL-truncated so
  // the result is safe to log and persist. Called only on the timeout
  // path.
  getPending(): PendingNetworkRequest[] {
    let now = Date.now();
    let pending = Array.from(this.#inFlight.values())
      .map(({ url, startedAt }) => ({
        url: url.length > MAX_URL_LENGTH ? url.slice(0, MAX_URL_LENGTH) : url,
        ageMs: now - startedAt,
      }))
      .sort((a, b) => b.ageMs - a.ageMs);
    return pending.slice(0, MAX_PENDING_REPORTED);
  }
}

// Page handle -> its tracker. A WeakMap so the entry is reclaimed with
// the page; the timeout path resolves the tracker from just the page,
// so no global mutable registry is needed.
const trackersByPage = new WeakMap<Page, NetworkInflightTracker>();

export async function attachNetworkInflightTracker(page: Page): Promise<void> {
  let tracker = new NetworkInflightTracker();
  let client: CDPSession;
  try {
    client = await page.createCDPSession();
    // Register listeners BEFORE awaiting `Network.enable` so we don't
    // miss requests delivered in the window between enable arriving at
    // the browser and the local handlers being subscribed.
    client.on(
      'Network.requestWillBeSent',
      (event: CdpRequestWillBeSentEvent) => {
        try {
          tracker.recordStarted(event.requestId, event.request?.url ?? '');
        } catch {
          // Best-effort: a malformed event must not perturb the render.
        }
      },
    );
    client.on('Network.loadingFinished', (event: CdpLoadingFinishedEvent) => {
      try {
        tracker.recordSettled(event.requestId);
      } catch {
        // Best-effort.
      }
    });
    client.on('Network.loadingFailed', (event: CdpLoadingFailedEvent) => {
      try {
        tracker.recordSettled(event.requestId);
      } catch {
        // Best-effort.
      }
    });
    await client.send('Network.enable');
  } catch (e) {
    // CDP session creation can race with page teardown — best-effort.
    log.debug('Failed to attach Network in-flight tracker:', e);
    return;
  }
  trackersByPage.set(page, tracker);
}

// Reads the pending-request snapshot for a page if a tracker is
// attached. Returns null when no tracker exists (attach raced teardown,
// or this is a test stub page) so the caller can omit the field.
export function getPendingNetworkRequests(
  page: Page,
): PendingNetworkRequest[] | null {
  let tracker = trackersByPage.get(page);
  if (!tracker) {
    return null;
  }
  try {
    return tracker.getPending();
  } catch {
    return null;
  }
}
