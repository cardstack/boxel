// How much module compiling this process has done since the stats were last
// taken. A compile runs on the calling thread and holds it for its whole
// duration, so a process that compiled for many seconds in a window spent
// those seconds unable to answer anything else. The realm server's health
// line reports these beside its event-loop lag, so a stall names its cause.
//
// Only real compiles are recorded. A module answered from either transpile
// cache did no compiling and is not counted.

export interface ModuleCompileStats {
  // Compiles finished since the last take.
  count: number;
  // Their durations added together, in milliseconds.
  totalMs: number;
  // The longest of them, in milliseconds.
  maxMs: number;
}

let count = 0;
let totalMs = 0;
let maxMs = 0;

export function recordModuleCompile(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }
  count += 1;
  totalMs += durationMs;
  if (durationMs > maxMs) {
    maxMs = durationMs;
  }
}

// Return the stats gathered since the last take, and start again from zero.
export function takeModuleCompileStats(): ModuleCompileStats {
  let stats = { count, totalMs, maxMs };
  count = 0;
  totalMs = 0;
  maxMs = 0;
  return stats;
}
