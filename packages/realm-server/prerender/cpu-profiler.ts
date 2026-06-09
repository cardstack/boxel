// Best-effort V8 CPU sampling for prerender pages.
//
// Why this module exists:
//
//   Some renders wedge the page's JS thread in a CPU-bound loop — no
//   I/O is outstanding, the thread is simply spinning. The passive
//   signals on the timeout path (`Performance.getMetrics`, the network
//   in-flight tracker, in-page `page.evaluate` diagnostics) can tell
//   that the thread is pegged but cannot name the function burning the
//   CPU: `Performance.getMetrics` needs the main thread to service the
//   read, and `page.evaluate` blocks outright on a wedged thread.
//
//   CDP's `Profiler` domain is a sampling profiler that runs in the
//   browser process, out of band from the page's JS thread. It keeps
//   collecting stack samples on a timer even while the main thread is
//   fully pegged — which is exactly the condition we most want to
//   diagnose. Aggregating self-time (`hitCount`) by call frame yields a
//   "top hot frames" summary that names the spinning function, small
//   enough to write to logs.
//
// What this module does NOT do:
//
//   It produces a compact top-N self-time summary only. It deliberately
//   does not persist a full `.cpuprofile` / trace / heap blob — the
//   prerender task has no durable artifact sink. The window-profiling
//   primitive is shaped so a future blob-producing capability could
//   layer on top, but that is out of scope here.
//
// Cost model:
//
//   The window profiler is invoked only by callers that have already
//   decided it's worth the cost: the timeout path (a render that has
//   already failed) and the affinity-scoped trigger (one deliberately
//   targeted realm). It performs no work and issues no CDP calls unless
//   called. Every operation is best-effort: any CDP error resolves to
//   `null`, and `Profiler.stop` is raced against a short timeout so a
//   fully-wedged renderer can never stall the pool waiting on a stop
//   that won't return.

import type { CDPSession, Page } from 'puppeteer';
import { logger } from '@cardstack/runtime-common';

const log = logger('prerenderer');

// Default number of hottest self-time frames to report. Enough to name
// the loop and its immediate callers without bloating a log line.
const DEFAULT_TOP_FRAMES = 25;
// Default sampling interval. 1ms (1000us) is fine-grained enough to
// resolve a tight loop without flooding the profiler with samples over
// the short windows these triggers use.
const DEFAULT_SAMPLING_INTERVAL_US = 1000;
// Hard ceiling on how long we wait for `Profiler.stop` to return. A
// wedged renderer can leave the stop hanging; abandoning the profile
// after this budget keeps the pool moving. The render this profiles has
// already either timed out or is on a deliberately-targeted realm, so
// adding at most this much to its teardown is acceptable.
const PROFILER_STOP_TIMEOUT_MS = 5000;

// One hot frame in the summary: a call frame and how much self-time
// (sampling hits) accrued to it over the profiled window.
export interface CpuProfileFrame {
  // `functionName  <path>:<line>` — host origin stripped from the url so
  // the frame reads cleanly and carries no environment-specific host.
  frame: string;
  hitCount: number;
  // Share of total samples, 0..1, rounded to a few decimals.
  fraction: number;
}

export interface CpuProfileSummary {
  topFrames: CpuProfileFrame[];
  totalSamples: number;
  durationMs: number;
}

// Local subset of the CDP `Profiler.*` shapes we read. We deliberately
// don't import `devtools-protocol` (a transitive, not direct, dependency
// of puppeteer) — declaring just the fields used keeps the import graph
// honest. Full shapes:
//   https://chromedevtools.github.io/devtools-protocol/tot/Profiler/
interface CdpProfileNode {
  id: number;
  hitCount?: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
}
interface CdpProfile {
  nodes: CdpProfileNode[];
  samples?: number[];
}

export interface ProfileWindowOptions {
  // V8 sampling interval in microseconds. Smaller = finer resolution and
  // more samples. Defaults to `DEFAULT_SAMPLING_INTERVAL_US`.
  samplingIntervalUs?: number;
  // Number of hottest self-time frames to return. Defaults to
  // `DEFAULT_TOP_FRAMES`.
  topFrames?: number;
  // Work to run between `Profiler.start` and `Profiler.stop`. For the
  // timeout trigger this just waits while the wedged thread keeps
  // spinning; for the affinity trigger this runs the render itself
  // (capturing its result in an outer closure). If `run` throws, the
  // profiler is still stopped and the error is re-thrown so the caller's
  // own error handling is unchanged.
  run: () => Promise<void>;
}

// Runs a CDP CPU profile across the window defined by `run`, then
// summarizes self-time by call frame. Returns the summary plus whatever
// `run` resolved to. Never throws: any CDP failure resolves the summary
// to `null` while still awaiting `run` so the caller's own work
// completes regardless of profiler health.
export async function profileWindow(
  page: Page,
  options: ProfileWindowOptions,
): Promise<CpuProfileSummary | null> {
  let samplingIntervalUs =
    options.samplingIntervalUs ?? DEFAULT_SAMPLING_INTERVAL_US;
  let topFrames = options.topFrames ?? DEFAULT_TOP_FRAMES;

  let client: CDPSession | undefined;
  let started = false;
  let startedAt = 0;
  try {
    client = await page.createCDPSession();
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', {
      interval: samplingIntervalUs,
    });
    await client.send('Profiler.start');
    started = true;
    startedAt = Date.now();
  } catch (e) {
    // Couldn't even start (page closing, session race). Still run the
    // caller's work so its result and side effects are unaffected.
    log.debug('CPU profiler failed to start:', e);
    await runQuietly(options.run);
    await detachQuietly(client);
    return null;
  }

  // Run the caller's work inside the profiling window. If it throws we
  // still stop the profiler and surface whatever we collected — but we
  // re-throw so the caller's own error handling is unchanged.
  let runError: unknown;
  try {
    await options.run();
  } catch (e) {
    runError = e;
  }

  let durationMs = Date.now() - startedAt;
  let profile = await stopProfilerWithTimeout(client);
  await detachQuietly(client);

  if (runError !== undefined) {
    // The profile (if any) is discarded — the caller's failure path owns
    // the outcome. Re-throwing keeps `profileWindow` transparent to the
    // work it wraps.
    throw runError;
  }
  if (!started || !profile) {
    return null;
  }
  return summarizeProfile(profile, durationMs, topFrames);
}

// Races `Profiler.stop` against a hard timeout. A wedged renderer can
// leave the stop pending indefinitely; abandoning it (returning null)
// keeps the pool from stalling. Never throws.
async function stopProfilerWithTimeout(
  client: CDPSession,
): Promise<CdpProfile | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let stopPromise = client
      .send('Profiler.stop')
      .then((result) => (result as { profile?: CdpProfile }).profile ?? null)
      .catch(() => null);
    let timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PROFILER_STOP_TIMEOUT_MS);
    });
    return await Promise.race([stopPromise, timeoutPromise]);
  } catch {
    return null;
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

async function runQuietly(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    // The caller's work owns its own error handling; on the
    // profiler-failed-to-start path we only need it to have run.
  }
}

// Aggregates self-time (summed `hitCount`) by call frame and returns the
// hottest `topFrames`. Each frame key strips the host origin from the
// url so the summary is portable and carries no environment-specific
// host. Self-time is the right signal for a CPU-spin: the function
// actually executing when the sampler fired is the one burning cycles.
function summarizeProfile(
  profile: CdpProfile,
  durationMs: number,
  topFrames: number,
): CpuProfileSummary {
  let byFrame = new Map<string, number>();
  let totalSamples = 0;
  for (let node of profile.nodes ?? []) {
    let hitCount = node.hitCount ?? 0;
    if (hitCount <= 0) {
      continue;
    }
    totalSamples += hitCount;
    let key = frameKey(node.callFrame);
    byFrame.set(key, (byFrame.get(key) ?? 0) + hitCount);
  }
  let frames: CpuProfileFrame[] = [...byFrame.entries()]
    .map(([frame, hitCount]) => ({
      frame,
      hitCount,
      fraction:
        totalSamples > 0
          ? Math.round((hitCount / totalSamples) * 1000) / 1000
          : 0,
    }))
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, topFrames);
  return { topFrames: frames, totalSamples, durationMs };
}

// `functionName  <path>:<line>`. Anonymous frames (program, GC, idle,
// anonymous closures) get a readable placeholder. The url is reduced to
// its path so the key is stable across environments and never carries a
// host origin into logs.
function frameKey(callFrame: CdpProfileNode['callFrame']): string {
  let name = callFrame.functionName?.trim() || '(anonymous)';
  let path = stripOrigin(callFrame.url);
  // Profiler line numbers are 0-based; present them 1-based to match
  // editor / stack-trace conventions.
  let line = callFrame.lineNumber >= 0 ? `:${callFrame.lineNumber + 1}` : '';
  return path ? `${name}  ${path}${line}` : name;
}

// Reduces an absolute url to its path (+ query/hash) so the host origin
// never reaches a log line. Non-url values (V8 pseudo-frames like
// `native V8Runtime`, or empty) pass through unchanged.
function stripOrigin(url: string): string {
  if (!url) {
    return '';
  }
  try {
    let parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

// Renders a summary as a compact single-line list of the hottest frames
// for log output: `frame (hits, pct%)` joined by ` | `. Returns null
// when there's nothing to report so callers can omit the field.
export function formatTopFrames(
  summary: CpuProfileSummary | null,
): string | null {
  if (!summary || summary.topFrames.length === 0) {
    return null;
  }
  return summary.topFrames
    .map((f) => `${f.frame} (${f.hitCount}, ${(f.fraction * 100).toFixed(1)}%)`)
    .join(' | ');
}

// The affinity-scoped profiling target, read from the environment.
// `PRERENDER_PROFILE_AFFINITY` holds the exact affinity key to profile
// (e.g. `realm:https://realms.example/team/my-realm/`). Unset or empty
// means the affinity trigger is entirely inert. Read at call time rather
// than module load so the value is never frozen against a stale process
// snapshot in tests.
export function getAffinityProfileTarget(): string | undefined {
  let raw = process.env.PRERENDER_PROFILE_AFFINITY;
  if (typeof raw !== 'string') {
    return undefined;
  }
  let trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// The airtight gate for the affinity-scoped trigger. A render is
// profiled ONLY when a target is configured AND the render's affinity
// key is exactly equal to it. An unset/empty target, or any other
// affinity, profiles nothing — so every realm other than the one
// deliberately targeted incurs zero profiling and zero CDP overhead.
// Kept as a small pure function so the gate can be unit-tested without
// any Chrome / CDP dependency.
export function shouldProfileAffinity(
  affinityKey: string | undefined,
  target: string | undefined,
): boolean {
  if (target === undefined || target === '') {
    return false;
  }
  if (affinityKey === undefined || affinityKey === '') {
    return false;
  }
  return affinityKey === target;
}
