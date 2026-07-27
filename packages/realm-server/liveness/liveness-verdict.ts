// Decides whether the realm-server's main thread counts as alive, from the age
// of the last heartbeat it wrote.
//
// Pure and dependency-free so both sides can use it: the responder worker calls
// it per request, and unit tests drive it without threads or sockets.
//
// The distinction it draws is the whole point. A single-threaded server under
// load has a loop that turns late — hundreds of milliseconds, sometimes
// seconds — and one that has stopped turning at all. The first recovers once
// load abates and must not be restarted, because a replacement comes up with a
// cold definition/transpile cache and lands back in the same load. The second
// cannot recover on its own. `wedgeMs` is where that line sits: a beat age
// under it means "late, still turning", over it means "not turning".
//
// Both readings are `process.hrtime.bigint()` nanoseconds off the same
// process-wide base, so the age is a true elapsed duration and cannot be
// distorted by a wall-clock adjustment in either direction.

export interface LivenessVerdict {
  // True while the main thread is still turning its event loop, whether or not
  // it currently has capacity to serve. Consumers that restart on `false` get a
  // restart only for a loop that has stopped.
  alive: boolean;
  // How long ago the main thread last wrote a beat.
  heartbeatAgeMs: number;
  // The threshold this verdict was measured against, echoed so a reader of the
  // response body doesn't have to know the server's configuration.
  wedgeMs: number;
}

const NS_PER_MS = 1_000_000;

export function judgeLiveness({
  nowNs,
  beatNs,
  wedgeMs,
}: {
  nowNs: bigint;
  beatNs: bigint;
  wedgeMs: number;
}): LivenessVerdict {
  // A never-written beat reads as 0, which makes the age the whole of process
  // uptime and so fails any threshold. That is the honest answer for a buffer
  // nobody has beaten into: nothing has reported the loop turning. In practice
  // the heartbeat writes its first beat synchronously at construction, before
  // the responder exists to be asked.
  // Rounded to whole milliseconds: the threshold is seconds-scale, and a bare
  // integer reads better in the response body than a nanosecond-precision float.
  let heartbeatAgeMs = Math.round(Number(nowNs - beatNs) / NS_PER_MS);
  return {
    alive: heartbeatAgeMs <= wedgeMs,
    heartbeatAgeMs,
    wedgeMs,
  };
}
