import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { logger } from '@cardstack/runtime-common';
import { getSearchInFlight } from './search-inflight.ts';
import {
  heapTelemetry,
  formatHeapTelemetry,
} from './prerender/heap-telemetry.ts';

// Periodically samples the realm-server process's event-loop health, in-flight
// search count, and heap usage, emitting a `realm:health` line every interval.
//
// Why: during a from-scratch index, prerendered cards block in
// `waiting-stability` on `_search` round-trips that the realm-server is slow
// to answer — yet the SQL behind them runs in milliseconds. The missing
// piece is whether the single-threaded realm-server's event loop is starved
// (by the synchronous, CPU-bound post-SQL JSON serialization across many
// concurrent searches) so requests sit unserviced. Event-loop lag rising in
// lockstep with `inFlightSearch` is the fingerprint of exactly that.
//
// The line is emitted unconditionally rather than only inside saturation
// windows: heap growth toward the OOM limit is exactly the thing an alert has
// to catch *before* a storm, so the heap number has to be present on a calm,
// idle-loop process too. A quiet-when-healthy line makes a surviving replica
// sitting at a high retained heap indistinguishable from a healthy one — the
// blind spot the availability alerts exist to close.
//
// `monitorEventLoopDelay` measures the delay between when a timer was
// scheduled and when it actually fired — i.e. how long synchronous work kept
// the loop from turning. Values are nanoseconds.
export interface HealthSamplerOptions {
  // How often to sample + log. Defaults to 5s.
  intervalMs?: number;
}

export function startHealthSampler(
  opts: HealthSamplerOptions = {},
): () => void {
  let intervalMs = opts.intervalMs ?? 5000;
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
    // Reuse the prerender heap-telemetry helpers so the realm-server health
    // line carries the same `heapUsedMB=… heapLimitMB=…` fields (one spelling
    // of the quantity, and the effective V8 limit read from the running
    // process rather than assumed from the task definition). Alerts threshold
    // on the used/limit ratio, which survives a task resize or a Node bump.
    let heap = heapTelemetry();
    log.info(
      `eventLoopLagMs(mean/p99/max)=${meanLagMs.toFixed(0)}/${p99LagMs.toFixed(0)}/${maxLagMs.toFixed(0)} ` +
        `inFlightSearch=${inFlightSearch} ${formatHeapTelemetry(heap)}`,
    );
  }, intervalMs);
  // Don't keep the process alive solely for sampling.
  timer.unref?.();

  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
