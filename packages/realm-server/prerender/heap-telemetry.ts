import { getHeapStatistics } from 'node:v8';

// The prerender server's own Node heap, as distinct from the browser-side
// JS heap the render paths already report (`jsHeapUsedMB` on a paused
// stack capture). A prerender server is long-lived and holds memory from
// work it has already finished, so these are the numbers that say whether
// a task is heading for `FATAL ERROR: Reached heap limit` — a crash that
// takes the task's warm tabs with it and leaves the surviving instances
// serving cold ones.
export interface HeapTelemetry {
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimitMB: number;
  rssMB: number;
  externalMB: number;
}

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

export function heapTelemetry(): HeapTelemetry {
  let heap = getHeapStatistics();
  let mem = process.memoryUsage();
  return {
    heapUsedMB: mb(heap.used_heap_size),
    heapTotalMB: mb(heap.total_heap_size),
    // V8 sizes its default old-space limit from visible memory rather
    // than from the task's allocation, so this is not derivable from the
    // ECS memory setting — reporting it makes the effective
    // `--max-old-space-size` readable from a running task instead of
    // inferred from a task definition plus a Node version.
    heapLimitMB: mb(heap.heap_size_limit),
    rssMB: mb(mem.rss),
    // Strings and buffers held outside the JS heap. Worth its own field
    // rather than folding into rss: heap exhaustion here has surfaced
    // during response serialisation, and memory retained that way shows
    // up here rather than in `heapUsedMB`.
    externalMB: mb(mem.external),
  };
}

// Rendered as `key=value` pairs to match the surrounding prerender log
// lines, so the same greps work and a Loki query can pull any single
// field out with one `regexp` stage.
export function formatHeapTelemetry(telemetry: HeapTelemetry): string {
  return (
    `heapUsedMB=${telemetry.heapUsedMB} ` +
    `heapTotalMB=${telemetry.heapTotalMB} ` +
    `heapLimitMB=${telemetry.heapLimitMB} ` +
    `rssMB=${telemetry.rssMB} ` +
    `externalMB=${telemetry.externalMB}`
  );
}
