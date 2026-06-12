// HeapProfiler allocation sampling for prerender pages.
//
// Why allocation sampling (not full heap snapshots):
//
//   The question this answers is "where is the store/heap growing across a
//   realm's render session", and an affinity tab is reused across many
//   renders. The sampling allocation profiler is the right tool: started
//   once per tab, it accrues a lightweight, statistically-sampled record of
//   allocation call stacks for the life of the tab. Reading the cumulative
//   profile after each render and flushing it gives a per-render series
//   whose diffs show what kept allocating — at a tiny fraction of the cost
//   (and the multi-GB size) of full `takeHeapSnapshot`s, and without the
//   long main-thread pause a full snapshot walk imposes.
//
//   Like the CPU profiler's `Profiler.stop`, `getSamplingProfile` needs the
//   renderer's own thread to serialize the profile, so it captures
//   heavy-but-completing renders rather than a fully-wedged one — which is
//   the right division of labour: the streaming trace owns the hard wedge,
//   and heap growth is a property of the renders that complete.
//
// Sampling is enabled once per page and persists on the V8 isolate across
// the renders that reuse the tab; the cumulative profile read per render is
// the `.heapprofile` format the DevTools "Allocation sampling" view loads.

import type { CDPSession, Page } from 'puppeteer';
import { logger } from '@cardstack/runtime-common';

const log = logger('prerenderer');

// Average bytes between allocation samples. Coarse enough to keep the
// per-allocation overhead negligible over a long session while still
// resolving the call sites that dominate growth.
const SAMPLING_INTERVAL_BYTES = 32768;
// Hard ceiling on the cumulative-profile read. `getSamplingProfile` needs
// the renderer thread; time-boxing it keeps a wedged render from stalling
// the pool, mirroring the CPU profiler's `Profiler.stop` guard.
const GET_PROFILE_TIMEOUT_MS = 5000;

// Local subset of the CDP shape read. As elsewhere we avoid importing
// `devtools-protocol` and declare only what's used.
//   https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/
interface GetSamplingProfileResult {
  profile?: unknown;
}

// One CDP session per page, holding the sampling profiler open for the life
// of the tab. The session is created when sampling is first enabled and
// reused for every cumulative read; it dies with the page (puppeteer
// auto-detaches), so no explicit teardown is needed.
let heapSessions = new WeakMap<Page, CDPSession>();

// Ensures the allocation sampler is running on this page. Idempotent: the
// first call per page enables and starts sampling; later calls are no-ops,
// so the profile keeps accruing across the renders that reuse the tab
// (re-starting would reset the cumulative record). Best-effort — never
// throws; on any CDP error sampling simply stays off for this page.
export async function ensureHeapSampling(page: Page): Promise<void> {
  if (heapSessions.has(page)) {
    return;
  }
  let client: CDPSession | undefined;
  try {
    client = await page.createCDPSession();
    await client.send('HeapProfiler.enable');
    await client.send('HeapProfiler.startSampling', {
      samplingInterval: SAMPLING_INTERVAL_BYTES,
    });
    heapSessions.set(page, client);
  } catch (e) {
    log.debug('heap sampling failed to start:', e);
    await detachQuietly(client);
  }
}

// Reads the cumulative allocation-sampling profile as a `.heapprofile`
// buffer, or `null` if sampling isn't running on this page or the read
// fails / times out. Does NOT stop sampling — the profiler keeps accruing
// so the next render's read continues the series. Never throws.
export async function captureHeapSamplingProfile(
  page: Page,
): Promise<Buffer | null> {
  let client = heapSessions.get(page);
  if (!client) {
    return null;
  }
  try {
    let result = await raceTimeout(
      client.send(
        'HeapProfiler.getSamplingProfile',
      ) as Promise<GetSamplingProfileResult>,
      GET_PROFILE_TIMEOUT_MS,
    );
    if (!result || result.profile === undefined) {
      return null;
    }
    return Buffer.from(JSON.stringify(result.profile), 'utf8');
  } catch (e) {
    log.debug('heap sampling profile read failed:', e);
    return null;
  }
}

// Resolves with the command result, or `null` if it doesn't return within
// `ms`. Never throws — a wedged renderer can leave `getSamplingProfile`
// pending, and abandoning it keeps the pool moving.
async function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function detachQuietly(client: CDPSession | undefined): Promise<void> {
  try {
    await client?.detach();
  } catch {
    // Session may already be gone with the page; ignore.
  }
}

// Test-only: drop the per-page session map between cases.
export function __resetHeapSamplerForTests(): void {
  heapSessions = new WeakMap<Page, CDPSession>();
}
