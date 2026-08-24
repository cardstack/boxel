import { writeHeapSnapshot } from 'node:v8';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@cardstack/runtime-common';
import {
  artifactSinkEnabled,
  shouldAllowHeapSnapshot,
  uploadArtifact,
} from './artifact-sink.ts';
import { heapTelemetry } from './heap-telemetry.ts';

let log = logger('prerender-heap-snapshot');

export type HeapSnapshotOutcome =
  | { status: 'captured'; bytes: number; writeMs: number; uploadMs: number }
  | { status: 'disabled' }
  | { status: 'no-sink' }
  | { status: 'busy' }
  | { status: 'upload-declined'; bytes: number; writeMs: number }
  | { status: 'failed'; message: string };

// One at a time. Two concurrent snapshots would stop the world twice over and
// write two multi-gigabyte files to the same disk, which is a far more
// disruptive way to fail than refusing the second request.
let inFlight = false;

// Heap size at which an instance captures itself without being asked. Chosen
// as an absolute size rather than a fraction of the limit, because what makes
// a snapshot expensive is how big the heap is when it is taken, not how close
// to the ceiling that was. A leak that shows up at 12 GB shows the same
// retention at 1.5, for a fraction of the pause.
const DEFAULT_AUTO_CAPTURE_MB = 1536;

// Fires once per process. A leak refills after a restart, so a second
// snapshot from the same instance describes the same thing at greater cost;
// and the failure this guards against — a threshold crossed every 30s,
// pausing the world each time — is worse than missing a capture.
let autoCaptureArmed = true;

function autoCaptureThresholdMB(): number {
  let raw = process.env.PRERENDER_HEAP_SNAPSHOT_MB;
  if (typeof raw === 'string') {
    let parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_AUTO_CAPTURE_MB;
}

// Called on each telemetry tick with the heap reading already taken there.
// Deliberately not awaited by the caller: the write blocks the event loop
// whether or not anyone waits on it, so awaiting would only delay the tick
// that follows.
export function maybeAutoCaptureHeapSnapshot(heapUsedMB: number): void {
  if (!autoCaptureArmed || !shouldAllowHeapSnapshot()) {
    return;
  }
  let threshold = autoCaptureThresholdMB();
  if (heapUsedMB < threshold) {
    return;
  }

  // Disarm before starting rather than after finishing, so the ticks that
  // land during a slow capture don't queue up behind it.
  autoCaptureArmed = false;
  log.info(
    `heap reached ${heapUsedMB}MB (auto-capture threshold ${threshold}MB); ` +
      `capturing one snapshot for this process`,
  );
  captureHeapSnapshot()
    .then((outcome) => {
      // Re-arm only when nothing was actually written — those outcomes mean
      // the capture never happened, so this instance still owes one.
      if (
        outcome.status === 'disabled' ||
        outcome.status === 'no-sink' ||
        outcome.status === 'busy'
      ) {
        autoCaptureArmed = true;
      }
    })
    .catch(() => {
      autoCaptureArmed = true;
    });
}

// Test-only: put the once-per-process arm back.
export function __rearmAutoCaptureForTests(): void {
  autoCaptureArmed = true;
}

// Writes the server's own heap to disk and streams it to the artifact sink.
//
// `writeHeapSnapshot` serialises straight to a file descriptor rather than
// building the snapshot in JS memory, so it stays usable on the process it is
// diagnosing — a heap that is nearly full could not have buffered its own
// snapshot. The trade is that it stops the world for the whole write: seconds
// on a small heap, and long enough on a large one that the manager's
// heartbeat (30s by default) can lapse and evict this instance until it
// re-registers. Capture at a couple of gigabytes rather than near the limit —
// the retention pattern is the same and everything about it is cheaper.
export async function captureHeapSnapshot(): Promise<HeapSnapshotOutcome> {
  if (!shouldAllowHeapSnapshot()) {
    return { status: 'disabled' };
  }
  if (!artifactSinkEnabled()) {
    return { status: 'no-sink' };
  }
  if (inFlight) {
    return { status: 'busy' };
  }
  inFlight = true;

  let before = heapTelemetry();
  let body: ReturnType<typeof createReadStream> | undefined;
  let path = join(
    tmpdir(),
    `prerender-${process.pid}-${Date.now()}.heapsnapshot`,
  );
  let bytes = 0;
  let writeMs = 0;

  try {
    log.info(
      `heap snapshot starting heapUsedMB=${before.heapUsedMB} ` +
        `rssMB=${before.rssMB} path=${path} (the process is paused until this completes)`,
    );
    let startedAt = Date.now();
    writeHeapSnapshot(path);
    writeMs = Date.now() - startedAt;
    bytes = (await stat(path)).size;
    log.info(`heap snapshot written bytes=${bytes} writeMs=${writeMs}`);

    // The sink can decline before it reads a byte — its per-process budget
    // may already be spent — so this owns the stream's lifecycle rather than
    // handing it over and assuming it gets consumed. Without the listener, a
    // stream whose open loses the race with the unlink below raises an
    // unhandled `error` and takes the process down with it. Without the
    // destroy in `finally`, a declined upload leaves the descriptor open, and
    // an unlinked file with an open descriptor keeps its blocks — several
    // hundred megabytes of them, in this case.
    body = createReadStream(path);
    body.on('error', (e: Error) =>
      log.warn(`heap snapshot read stream failed: ${e.message}`),
    );

    let uploadStartedAt = Date.now();
    let uploaded = await uploadArtifact({
      kind: 'heapsnapshot',
      step: `node-heap-${before.heapUsedMB}mb`,
      body,
      contentType: 'application/octet-stream',
    });
    let uploadMs = Date.now() - uploadStartedAt;
    if (!uploaded) {
      // The sink declines rather than throws when its byte budget is spent or
      // no bucket is configured; the snapshot is still on disk at this point,
      // so say so rather than reporting success.
      log.warn(`heap snapshot upload declined bytes=${bytes}`);
      return { status: 'upload-declined', bytes, writeMs };
    }
    log.info(`heap snapshot uploaded bytes=${bytes} uploadMs=${uploadMs}`);
    return { status: 'captured', bytes, writeMs, uploadMs };
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e);
    log.warn(`heap snapshot failed: ${message}`);
    return { status: 'failed', message };
  } finally {
    // Closes the descriptor on the paths that never consumed the stream. A
    // stream the upload already drained is finished, so this is a no-op
    // there, and it has to happen before the unlink either way.
    body?.destroy();
    // The file is multi-gigabyte and the container's disk is shared with
    // every render, so it goes whether or not the upload worked.
    await unlink(path).catch(() => undefined);
    inFlight = false;
  }
}
