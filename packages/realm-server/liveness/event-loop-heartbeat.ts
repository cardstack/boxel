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
// `BigInt64Array` because the value is an epoch millisecond, which does not fit
// in the int32 that `Atomics` otherwise offers. `Atomics` on an 8-byte aligned
// slot is already atomic on every platform we run; using it explicitly is what
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
  let beat = () => writeBeat(buffer, Date.now());
  // Beat once here so the buffer is never observed at epoch 0 by a reader that
  // attaches before the first interval tick.
  beat();
  return { buffer, beat, stop: () => {} };
}

// The single encoder of a beat into the shared buffer.
export function writeBeat(buffer: SharedArrayBuffer, atMs: number): void {
  Atomics.store(new BigInt64Array(buffer), BEAT_SLOT, BigInt(atMs));
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

// Binds a reader to a buffer produced by `createHeartbeat`, for a holder of the
// buffer that doesn't have the closure that writes it — the responder worker,
// which receives the buffer through `workerData`. The typed-array view is built
// once here rather than per read, so answering a request allocates nothing.
export function createBeatReader(buffer: SharedArrayBuffer): () => number {
  let view = new BigInt64Array(buffer);
  return () => Number(Atomics.load(view, BEAT_SLOT));
}
