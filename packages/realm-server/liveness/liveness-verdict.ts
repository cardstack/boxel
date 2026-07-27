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

export function judgeLiveness({
  nowMs,
  beatMs,
  wedgeMs,
}: {
  nowMs: number;
  beatMs: number;
  wedgeMs: number;
}): LivenessVerdict {
  // A never-written beat reads as epoch 0, which yields an enormous age and so
  // fails the threshold. That is the honest answer for a buffer nobody has
  // beaten into: nothing has reported the loop turning. In practice the
  // heartbeat writes its first beat synchronously at construction, before the
  // responder exists to be asked.
  let heartbeatAgeMs = nowMs - beatMs;
  // A clock that went backwards (NTP step) would otherwise read as a negative
  // age and pass trivially; clamp so the age is always a duration.
  if (heartbeatAgeMs < 0) {
    heartbeatAgeMs = 0;
  }
  return {
    alive: heartbeatAgeMs <= wedgeMs,
    heartbeatAgeMs,
    wedgeMs,
  };
}
