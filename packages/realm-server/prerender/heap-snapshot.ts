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

    let uploadStartedAt = Date.now();
    let uploaded = await uploadArtifact({
      kind: 'heapsnapshot',
      step: `node-heap-${before.heapUsedMB}mb`,
      body: createReadStream(path),
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
    // The file is multi-gigabyte and the container's disk is shared with
    // every render, so it goes whether or not the upload worked.
    await unlink(path).catch(() => undefined);
    inFlight = false;
  }
}
