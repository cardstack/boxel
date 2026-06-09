import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { logger } from '@cardstack/runtime-common';
import { getSearchInFlight } from './search-inflight.ts';

// Periodically samples the realm-server process's event-loop health and
// in-flight search count, logging a `realm:health` line whenever there's a
// saturation signal worth capturing.
//
// Why: during a from-scratch index, prerendered cards block in
// `waiting-stability` on `_search` round-trips that the realm-server is slow
// to answer — yet the SQL behind them runs in milliseconds. The missing
// piece is whether the single-threaded realm-server's event loop is starved
// (by the synchronous, CPU-bound post-SQL JSON serialization across many
// concurrent searches) so requests sit unserviced. Event-loop lag rising in
// lockstep with `inFlightSearch` is the fingerprint of exactly that.
//
// `monitorEventLoopDelay` measures the delay between when a timer was
// scheduled and when it actually fired — i.e. how long synchronous work kept
// the loop from turning. Values are nanoseconds.
export interface HealthSamplerOptions {
  // How often to sample + maybe log. Defaults to 5s.
  intervalMs?: number;
  // Only log when peak loop lag in the window exceeds this (or a search is
  // in flight). Keeps the line quiet on an idle/healthy server. Defaults to
  // 200ms.
  lagThresholdMs?: number;
}

export function startHealthSampler(
  opts: HealthSamplerOptions = {},
): () => void {
  let intervalMs = opts.intervalMs ?? 5000;
  let lagThresholdMs = opts.lagThresholdMs ?? 200;
  // Created here (not at module load) to avoid racing the circular import
  // that installs the logger factory; startup calls this well after boot.
  let log = logger('realm:health');
  let histogram: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  let timer = setInterval(() => {
    let toMs = (ns: number) => (Number.isFinite(ns) ? ns / 1e6 : 0);
    let maxLagMs = toMs(histogram.max);
    let meanLagMs = toMs(histogram.mean);
    let p99LagMs = toMs(histogram.percentile(99));
    histogram.reset();
    let inFlightSearch = getSearchInFlight();
    // Stay silent when the loop is healthy and nothing is in flight — only
    // the saturation windows are interesting.
    if (maxLagMs < lagThresholdMs && inFlightSearch === 0) {
      return;
    }
    let heapMB = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
    log.info(
      `eventLoopLagMs(mean/p99/max)=${meanLagMs.toFixed(0)}/${p99LagMs.toFixed(0)}/${maxLagMs.toFixed(0)} ` +
        `inFlightSearch=${inFlightSearch} heapMB=${heapMB}`,
    );
  }, intervalMs);
  // Don't keep the process alive solely for sampling.
  timer.unref?.();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
