import { createServer, type Server } from 'node:net';

// Port-allocation strategy for per-worker service blocks:
//
//   - The Playwright harness pre-reserves a 3-port block per worker for
//     compat, realm-server, and prerender, and keeps those ports stable
//     for the worker's lifetime so BOXEL_HOST_URL does not change between
//     tests.
//   - The Linux ephemeral port range is typically 32768-60999. Any port
//     chosen by OS port-0 allocation (Node's `server.listen(0)`, used by
//     `findAvailablePort` in isolated-realm-stack.ts / support-services.ts)
//     will fall in that range. If our reserved blocks overlapped it, a
//     different worker's dynamic allocation could return a port that
//     another worker has "reserved" but not actually bound, producing
//     EADDRINUSE when the reserver later tries to listen.
//   - We therefore confine reserved blocks to [20000, 32000), below the
//     ephemeral range, and (for defense in depth) bind a holder socket to
//     each reserved port for the worker's lifetime, closing it only for
//     the microseconds between "about to spawn a child" and "child has
//     bound".
export const TEST_WORKER_PORT_BLOCK_SIZE = 10;

export const TEST_WORKER_PORT_RANGE_START = Number(
  process.env.TEST_HARNESS_TEST_WORKER_PORT_RANGE_START ?? 20000,
);
export const TEST_WORKER_PORT_RANGE_END = Number(
  process.env.TEST_HARNESS_TEST_WORKER_PORT_RANGE_END ?? 32000,
);

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    let remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

const TEST_WORKER_PORT_NUM_SLOTS = Math.floor(
  (TEST_WORKER_PORT_RANGE_END - TEST_WORKER_PORT_RANGE_START) /
    TEST_WORKER_PORT_BLOCK_SIZE,
);

// Preferred stride for linear-probe search so repeated attempts cover a wide
// portion of the slot space before wrapping. 7 is coprime with the default
// 1200-slot range. If the configured slot count is a multiple of 7 (possible
// via env-var overrides) the probe would only visit 1/7 of the slots, so
// fall back to a pure linear probe (stride=1) in that case.
const TEST_WORKER_PORT_PREFERRED_SEARCH_STRIDE = 7;
const TEST_WORKER_PORT_SEARCH_STRIDE =
  TEST_WORKER_PORT_NUM_SLOTS > 0 &&
  gcd(TEST_WORKER_PORT_PREFERRED_SEARCH_STRIDE, TEST_WORKER_PORT_NUM_SLOTS) ===
    1
    ? TEST_WORKER_PORT_PREFERRED_SEARCH_STRIDE
    : 1;

const TEST_WORKER_RUN_OFFSET = Number(
  process.env.TEST_HARNESS_TEST_WORKER_RUN_OFFSET ??
    (process.pid * 31 + process.ppid) % TEST_WORKER_PORT_NUM_SLOTS,
);

if (
  !Number.isInteger(TEST_WORKER_PORT_RANGE_START) ||
  !Number.isInteger(TEST_WORKER_PORT_RANGE_END) ||
  TEST_WORKER_PORT_RANGE_START < 1024 ||
  TEST_WORKER_PORT_RANGE_END > 32768 ||
  TEST_WORKER_PORT_RANGE_END - TEST_WORKER_PORT_RANGE_START <
    TEST_WORKER_PORT_BLOCK_SIZE * 4
) {
  throw new Error(
    `Invalid software-factory test worker port range [${TEST_WORKER_PORT_RANGE_START}, ${TEST_WORKER_PORT_RANGE_END}); must be a subrange of [1024, 32768) with room for several blocks. See port-allocator.ts comment.`,
  );
}

export type TestWorkerPortSet = {
  compatRealmServerPort: number;
  realmServerPort: number;
  prerenderPort: number;
};

export type PortHolder = {
  readonly port: number;
  /** Close the holding socket so the port is free for a child to bind. */
  release(): Promise<void>;
  /** Re-bind the holding socket after a transient consumer released the port. */
  reacquire(): Promise<void>;
  /** Permanently close the holding socket (idempotent). */
  stop(): Promise<void>;
};

export type TestWorkerPortReservation = TestWorkerPortSet & {
  /**
   * Release the compat + realm-server port holders right before spawning
   * a realm child that will bind to those ports. Must be paired with
   * `reacquireRealmServerPorts()` once the child exits (typically inside
   * the realm's `stop()` method), so the next test in this worker starts
   * with the ports held again.
   */
  releaseRealmServerPorts(): Promise<void>;
  reacquireRealmServerPorts(): Promise<void>;
  /**
   * Release the prerender port holder once. The prerender child takes
   * ownership for the remainder of the worker's lifetime, so there is
   * intentionally no matching reacquire.
   */
  releasePrerenderPort(): Promise<void>;
  /** Stop all port holders. Called at worker-fixture teardown. */
  stop(): Promise<void>;
};

async function bindHolderSocket(port: number): Promise<Server | null> {
  // Bind a `net.Server` to the given port and return it (still listening).
  // Returns null if the port is already in use.
  return await new Promise<Server | null>((resolvePromise, rejectPromise) => {
    let s = createServer();
    let onError = (error: NodeJS.ErrnoException) => {
      s.close();
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolvePromise(null);
      } else {
        rejectPromise(error);
      }
    };
    s.once('error', onError);
    s.listen(port, '127.0.0.1', () => {
      s.off('error', onError);
      // Swallow late errors so they don't become unhandled 'error' events.
      s.on('error', () => {});
      resolvePromise(s);
    });
  });
}

async function closeHolderSocket(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((err) => (err ? rejectPromise(err) : resolvePromise()));
  });
}

export async function tryHoldPort(port: number): Promise<PortHolder | null> {
  let server = await bindHolderSocket(port);
  if (!server) {
    return null;
  }
  let held: Server | null = server;
  let stopped = false;
  return {
    port,
    async release() {
      if (!held) return;
      let s = held;
      held = null;
      await closeHolderSocket(s);
    },
    async reacquire() {
      if (held || stopped) return;
      let next = await bindHolderSocket(port);
      if (!next) {
        throw new Error(
          `Unable to re-acquire hold on software-factory port ${port}: port is now occupied by another process`,
        );
      }
      held = next;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (held) {
        let s = held;
        held = null;
        await closeHolderSocket(s);
      }
    },
  };
}

export async function allocateTestWorkerPortSet(
  testWorkerIndex: number,
): Promise<TestWorkerPortReservation> {
  // Reserve one stable port block per Playwright testWorker for services
  // whose URLs must remain constant across test restarts within the same
  // worker: compat proxy, realm-server (for BOXEL_HOST_URL stability), and
  // prerender (standby target). The worker-manager port is NOT pre-allocated
  // here — it is assigned dynamically via findAvailablePort() each time a
  // realm stack starts, since its URL does not need to be stable.
  let baseSlot =
    (TEST_WORKER_RUN_OFFSET + testWorkerIndex) % TEST_WORKER_PORT_NUM_SLOTS;
  let maxAttempts = Math.min(100, TEST_WORKER_PORT_NUM_SLOTS);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let slot =
      (baseSlot + attempt * TEST_WORKER_PORT_SEARCH_STRIDE) %
      TEST_WORKER_PORT_NUM_SLOTS;
    let blockStart =
      TEST_WORKER_PORT_RANGE_START + slot * TEST_WORKER_PORT_BLOCK_SIZE;
    let candidate: TestWorkerPortSet = {
      compatRealmServerPort: blockStart,
      realmServerPort: blockStart + 1,
      prerenderPort: blockStart + 2,
    };
    let compatHolder: PortHolder | null = null;
    let realmHolder: PortHolder | null = null;
    let prerenderHolder: PortHolder | null = null;
    try {
      compatHolder = await tryHoldPort(candidate.compatRealmServerPort);
      if (!compatHolder) continue;
      realmHolder = await tryHoldPort(candidate.realmServerPort);
      if (!realmHolder) {
        await compatHolder.stop();
        compatHolder = null;
        continue;
      }
      prerenderHolder = await tryHoldPort(candidate.prerenderPort);
      if (!prerenderHolder) {
        await Promise.allSettled([compatHolder.stop(), realmHolder.stop()]);
        compatHolder = null;
        realmHolder = null;
        continue;
      }
    } catch (error) {
      lastError = error;
      await Promise.allSettled([
        compatHolder?.stop(),
        realmHolder?.stop(),
        prerenderHolder?.stop(),
      ]);
      throw error;
    }
    let holders = {
      compat: compatHolder,
      realm: realmHolder,
      prerender: prerenderHolder,
    };
    return {
      ...candidate,
      async releaseRealmServerPorts() {
        await Promise.all([holders.compat.release(), holders.realm.release()]);
      },
      async reacquireRealmServerPorts() {
        await Promise.all([
          holders.compat.reacquire(),
          holders.realm.reacquire(),
        ]);
      },
      async releasePrerenderPort() {
        await holders.prerender.release();
      },
      async stop() {
        await Promise.allSettled([
          holders.compat.stop(),
          holders.realm.stop(),
          holders.prerender.stop(),
        ]);
      },
    };
  }

  throw new Error(
    `Unable to allocate a stable software-factory port block for testWorker ${testWorkerIndex} within [${TEST_WORKER_PORT_RANGE_START}, ${TEST_WORKER_PORT_RANGE_END})` +
      (lastError ? ` — last error: ${(lastError as Error).message}` : ''),
  );
}
