// The main thread's proof-of-life: a timestamp rewritten on every event-loop
// turn into memory another thread can read.
//
// A `SharedArrayBuffer` rather than `postMessage` because the reader has to
// stay useful precisely when the main thread is unavailable. Anything that
// needs the main loop to run — a message round-trip, a callback, a write to a
// stream the parent pumps — reports nothing at all in the case worth reporting.
// A shared buffer the reader polls has no such dependency: the beat simply
// stops advancing, and its age is the measurement.
//
// The clock is `process.hrtime.bigint()`, not `Date.now()`. It is monotonic, so
// an NTP or hypervisor step can't age a beat that was just written (a forward
// step past the wedge threshold would otherwise condemn a healthy server) or
// rejuvenate one that is genuinely stale. Its base is per-process, not
// per-thread, so a reading taken on the responder thread is directly comparable
// to a beat written on the main thread.
//
// `BigInt64Array` because the value is nanoseconds, far past what the int32
// `Atomics` otherwise offers can hold. `Atomics` on an 8-byte aligned slot is
// already tear-free on every platform we run; using it explicitly is what
// documents the cross-thread visibility the reader depends on.

// How often the main thread rewrites the beat. Fixed rather than configurable:
// it only has to be small relative to any useful wedge threshold, and a
// no-allocation timer callback four times a second costs nothing measurable.
const BEAT_INTERVAL_MS = 250;

const BEAT_SLOT = 0;

export interface Heartbeat {
  // Handed to the reader. Shared, not copied.
  buffer: SharedArrayBuffer;
  // Records a beat at the current time.
  beat: () => void;
  stop: () => void;
}

// A heartbeat with no timer of its own — the caller decides when a beat
// happens. `startEventLoopHeartbeat` is the production caller; a caller that
// needs a beat at a chosen age (a test, without blocking a thread) pairs this
// with `writeBeat`.
export function createHeartbeat(): Heartbeat {
  let buffer = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT);
  // View built once and closed over, so a beat allocates nothing beyond the
  // BigInt itself.
  let view = new BigInt64Array(buffer);
  let beat = () => {
    Atomics.store(view, BEAT_SLOT, process.hrtime.bigint());
  };
  // Beat once here so the buffer is never observed at 0 by a reader that
  // attaches before the first interval tick.
  beat();
  return { buffer, beat, stop: () => {} };
}

export function startEventLoopHeartbeat(): Heartbeat {
  let heartbeat = createHeartbeat();
  let timer = setInterval(heartbeat.beat, BEAT_INTERVAL_MS);
  // Don't keep the process alive solely for the heartbeat.
  timer.unref?.();
  return {
    ...heartbeat,
    stop: () => clearInterval(timer),
  };
}

// Places a beat at an explicit monotonic reading, for a caller that needs one
// of a chosen age without waiting for real time to pass.
export function writeBeat(buffer: SharedArrayBuffer, atNs: bigint): void {
  Atomics.store(new BigInt64Array(buffer), BEAT_SLOT, atNs);
}

// Binds a reader to a buffer produced by `createHeartbeat`, for a holder of the
// buffer that doesn't have the closure that writes it — the responder worker,
// which receives the buffer through `workerData`. The typed-array view is built
// once here rather than per read.
export function createBeatReader(buffer: SharedArrayBuffer): () => bigint {
  let view = new BigInt64Array(buffer);
  return () => Atomics.load(view, BEAT_SLOT);
}
