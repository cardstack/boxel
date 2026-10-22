// What a cold socket costs, and the one pool property everything here depends
// on.
//
// undici returns a socket to its pool a tick AFTER the response settles. A
// request issued in the same microtask therefore finds no free client and opens
// a fresh connection, paying a fresh TCP and TLS handshake. Two things in this
// harness depend on that timing, and they have to agree: the primer, so a batch
// reuses the connections it just opened, and the setup measurement, so its
// "warm" sample is actually warm. They live together for that reason — written
// separately, one of them yielded and the other did not, and the measurement
// silently compared two cold handshakes against each other and reported the
// difference between them as the cost of a handshake.

export function yieldSocketToPool(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface ConnectionSetup {
  // A request that had to open a connection.
  coldMs: number;
  // The cheapest request that reused one.
  warmMs: number;
  // The difference: what a timed request silently includes when its socket has
  // gone cold. Deliberately not clamped at zero — in-region this lands in the
  // noise, and a clamp would dress that up as a measurement.
  setupMs: number;
}

// `probe` performs one request and returns its duration. The first call is the
// cold sample, so the caller must not have touched the origin yet.
//
// The warm figure is the MINIMUM of several samples rather than a single one.
// A single warm sample that happens to be slow shrinks the reported setup cost,
// and under-reporting is the damaging direction: the number exists to stop
// someone reading connection setup as server time.
export async function measureConnectionSetup(
  probe: () => Promise<number>,
  {
    warmSamples = 3,
    yieldTick = yieldSocketToPool,
  }: { warmSamples?: number; yieldTick?: () => Promise<void> } = {},
): Promise<ConnectionSetup> {
  let coldMs = await probe();
  let warmMs = Infinity;
  for (let i = 0; i < warmSamples; i++) {
    await yieldTick();
    warmMs = Math.min(warmMs, await probe());
  }
  return { coldMs, warmMs, setupMs: coldMs - warmMs };
}

// Below this, the two samples are indistinguishable and the difference is
// jitter rather than a handshake.
const NOISE_FLOOR_MS = 3;

// Always reports both raw samples. The subtraction is the interesting number
// but it is also the one that can be quietly wrong, and a reader who can see
// what it was computed from can tell.
export function describeConnectionSetup(
  host: string,
  { coldMs, warmMs, setupMs }: ConnectionSetup,
): string {
  let samples = `cold ${Math.round(coldMs)}ms vs warm ${Math.round(warmMs)}ms`;
  if (setupMs < NOISE_FLOOR_MS) {
    return (
      `Connection setup to ${host}: under ${NOISE_FLOOR_MS}ms (${samples}) — ` +
      `this driver is close to the server.`
    );
  }
  return `Connection setup to ${host}: ~${Math.round(setupMs)}ms TCP+TLS (${samples}).`;
}
