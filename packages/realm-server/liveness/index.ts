import { Worker } from 'node:worker_threads';
import * as Sentry from '@sentry/node';
import { logger } from '@cardstack/runtime-common';
import type { LivenessResponderWorkerData } from './liveness-responder-worker.ts';

// Spawns the thread that answers `/_liveness`, and owns its lifecycle.
//
// The responder is an operational signal, not part of serving. A port it cannot
// bind, or a thread that dies, must leave the realm-server handling traffic
// exactly as before — so every failure here is logged and reported, never
// thrown.

const DEFAULT_WEDGE_MS = 30_000;
// Below a few seconds a threshold stops distinguishing a wedge from an ordinary
// long synchronous span (a large serialization, a major GC), and starts calling
// a server dead that is merely busy.
const MIN_WEDGE_MS = 5_000;
const LOOPBACK_HOST = '127.0.0.1';

// Ops knob, in the shape the package's other tunables use: an env override,
// clamped so a malformed value can't disable the floor.
export function livenessWedgeMs(
  raw: string | undefined = process.env.REALM_LIVENESS_WEDGE_MS,
): number {
  let parsed = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WEDGE_MS;
  }
  return Math.max(MIN_WEDGE_MS, Math.floor(parsed));
}

export interface LivenessResponder {
  // The port the responder actually bound, once it has. Resolves to undefined
  // when the bind failed — the caller carries on serving either way.
  listening: Promise<number | undefined>;
  stop: () => Promise<void>;
}

export function startLivenessResponder({
  buffer,
  port,
  wedgeMs = livenessWedgeMs(),
  host = LOOPBACK_HOST,
}: {
  buffer: SharedArrayBuffer;
  port: number;
  wedgeMs?: number;
  host?: string;
}): LivenessResponder {
  let log = logger('realm:liveness');
  let workerData: LivenessResponderWorkerData = {
    buffer,
    port,
    host,
    wedgeMs,
  };
  let worker = new Worker(
    new URL('./liveness-responder-worker.ts', import.meta.url),
    { workerData },
  );

  let resolveListening!: (boundPort: number | undefined) => void;
  let listening = new Promise<number | undefined>((resolve) => {
    resolveListening = resolve;
  });
  // The responder must not be the reason the process stays up, but it must stay
  // referenced long enough to report whether it bound — an unreferenced worker
  // holds no handle, so node would exit (or a caller's `await listening` would
  // hang) before the first message arrived. Referenced until it has reported,
  // unreferenced after.
  //
  // Unreferencing has to happen after the `message` listener is attached in any
  // case: attaching one starts the parent's side of the port, which re-references
  // the handle and would undo an earlier `unref`.
  let settle = (boundPort: number | undefined) => {
    resolveListening(boundPort);
    worker.unref();
  };

  worker.on(
    'message',
    (message: { type?: string; port?: number; message?: string }) => {
      if (message?.type === 'listening') {
        log.info(
          `liveness responder listening on ${host}:${message.port} wedgeMs=${wedgeMs}`,
        );
        settle(message.port);
      } else if (message?.type === 'error') {
        // Most often the port is already taken. Loud, because a check wired to
        // an endpoint that never bound reads as a wedge.
        log.error(`liveness responder failed to serve: ${message.message}`);
        Sentry.captureException(
          new Error(`liveness responder failed to serve: ${message.message}`),
        );
        settle(undefined);
      }
    },
  );
  worker.on('error', (err) => {
    log.error(`liveness responder thread error: ${err.message}`);
    Sentry.captureException(err);
    settle(undefined);
  });
  worker.on('exit', () => settle(undefined));

  return {
    listening,
    stop: async () => {
      await worker.terminate();
    },
  };
}
