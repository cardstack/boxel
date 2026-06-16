// Diagnostic V8 `--prof` (kernel-signal CPU sampling) for the prerender
// renderer — the one capture that survives a hard synchronous CPU peg.
//
// When a render pegs the main thread hard, CDP can't read it: `Debugger.enable`
// / `Profiler.enable` time out because the pegged thread can't service the
// protocol (see pause-capture.ts / trace-capture.ts). V8's `--prof` sampler is
// driven by the kernel SIGPROF timer and written by a separate thread, so it
// records the spinning frame regardless — straight to a file on disk.
//
// The catch: that file accumulates every render on the isolate since browser
// launch (tens of MB), so `node --prof-process` on it blows the render-timeout
// budget. So we don't parse it in-container. On the render timeout we ship the
// RAW log to the prerender S3 artifacts bucket, keyed by realm/card/job, and
// symbolize it offline (`node --prof-process`) where there's no deadline and
// the peg dominates the top self-time frames. Once the upload is durable we
// delete the local log so these tens-of-MB files don't pile up on the
// container's disk over the browser's long life.
//
// Off by default (`PRERENDER_V8_PROF=true` to arm) — it samples every render,
// so it can perturb a timing-sensitive wedge; arm it deliberately.

import { logger } from '@cardstack/runtime-common';
import { promises as fs, createReadStream } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { uploadArtifact, type ArtifactKeyParts } from './artifact-sink.ts';

const log = logger('prerenderer');

export const V8_PROF_LOG_DIR = tmpdir();
export const V8_PROF_LOG_PREFIX = 'prerender-v8-prof-';

export function v8ProfEnabled(): boolean {
  return process.env.PRERENDER_V8_PROF === 'true';
}

// The `--js-flags` value to pass at Chrome launch when armed. Per-pid
// logfile so concurrent renderer processes don't clobber one another.
export function v8ProfJsFlags(): string {
  return `--prof --logfile=${V8_PROF_LOG_DIR}/${V8_PROF_LOG_PREFIX}%p.log`;
}

// Browser-launch wall-clock; logs older than this are from a previous run.
let v8ProfLaunchAt = 0;

// Call once at browser launch (when armed) to isolate this run's profile
// logs. The OS temp dir is shared and the container can be reused across
// deploys, so a stale `--prof` log from an earlier run could otherwise be
// picked as the timeout diagnostic and point at the wrong stack. Delete
// any pre-existing logs and stamp the launch time so the timeout-path
// processor only ever considers logs written by THIS browser run.
export async function prepareV8ProfForLaunch(): Promise<void> {
  // Sweep stale logs on EVERY browser launch, even when disabled — so
  // flipping PRERENDER_V8_PROF off and restarting clears the logs the
  // prior "on" period left behind (the OS temp dir is shared and the
  // container can outlive a single browser). Only stamp the launch time
  // when armed (the reader uses it to scope to this run's logs).
  if (v8ProfEnabled()) {
    v8ProfLaunchAt = Date.now();
  }
  try {
    let entries = await fs.readdir(V8_PROF_LOG_DIR);
    await Promise.all(
      entries
        // `includes`, not `startsWith`: V8's per-isolate logging prepends
        // `isolate-<addr>-` to the --logfile name.
        .filter((e) => e.includes(V8_PROF_LOG_PREFIX) && e.endsWith('.log'))
        .map((e) =>
          fs.rm(path.join(V8_PROF_LOG_DIR, e), { force: true }).catch(() => {}),
        ),
    );
  } catch (e) {
    log.debug('v8 --prof stale-log cleanup failed:', e);
  }
}

// Find the pegged isolate's `--prof` log among this browser run's logs.
// Returns the chosen file (or a self-diagnosing reason string).
async function pickV8ProfLog(): Promise<
  { full: string; sizeMB: string } | { reason: string }
> {
  let entries = await fs.readdir(V8_PROF_LOG_DIR);
  // `includes`, not `startsWith`: V8's per-isolate logging prepends
  // `isolate-<addr>-` to the --logfile name, so the file is e.g.
  // `isolate-0x…-prerender-v8-prof-<pid>.log`.
  let logs = entries.filter(
    (e) => e.includes(V8_PROF_LOG_PREFIX) && e.endsWith('.log'),
  );
  if (logs.length === 0) {
    let present = entries.filter((e) => e.endsWith('.log')).slice(0, 12);
    return {
      reason: `<no v8 --prof log found; .log present: ${present.join(', ') || 'none'}>`,
    };
  }
  let withStats = await Promise.all(
    logs.map(async (name) => {
      let full = path.join(V8_PROF_LOG_DIR, name);
      try {
        let st = await fs.stat(full);
        return { full, mtimeMs: st.mtimeMs, size: st.size };
      } catch {
        return { full, mtimeMs: 0, size: 0 };
      }
    }),
  );
  // This browser run's logs only (stale ones were cleared + the launch time
  // stamped). Pick the LARGEST: the pegged isolate accumulates by far the
  // most samples over the peg, so its log dwarfs sibling isolates' and
  // earlier renders' — and the peg dominates its frames regardless of what
  // else it rendered.
  let fromThisRun = withStats.filter(
    (s) => s.size > 0 && s.mtimeMs >= v8ProfLaunchAt,
  );
  if (fromThisRun.length === 0) {
    let seen = withStats
      .map((s) => `${path.basename(s.full)}(${s.size}b)`)
      .slice(0, 8);
    return {
      reason: `<no v8 --prof log from this run; seen: ${seen.join(', ')}>`,
    };
  }
  fromThisRun.sort((a, b) => b.size - a.size);
  return {
    full: fromThisRun[0].full,
    sizeMB: (fromThisRun[0].size / (1024 * 1024)).toFixed(1),
  };
}

// On the render timeout (when armed), ship the pegged isolate's RAW `--prof`
// log to the artifact sink, keyed by realm/card/job so the wedging task's log
// is self-identifying across the fleet. We don't `--prof-process` it here: the
// accumulated log is too large to symbolize inside the timeout budget, and the
// sink streams it (managed multipart) so memory stays bounded. Symbolize the
// artifact offline with `node --prof-process`. Returns a short status for the
// timeout log line.
export async function uploadV8ProfLog(
  keyParts: Omit<ArtifactKeyParts, 'kind'>,
): Promise<string | null> {
  if (!v8ProfEnabled()) {
    return null;
  }
  try {
    let picked = await pickV8ProfLog();
    if ('reason' in picked) {
      return picked.reason;
    }
    let uploaded = await uploadArtifact({
      ...keyParts,
      kind: 'v8log',
      body: createReadStream(picked.full),
      contentType: 'text/plain',
    });
    if (!uploaded) {
      // The bytes did NOT land in S3 (sink disabled / budget spent / upload
      // failed). Keep the local log — it's the only copy — rather than
      // destroying it for a capture we can't retrieve.
      return `<v8 --prof log not persisted to artifact bucket (sink disabled/declined/failed); kept local ${path.basename(picked.full)} (${picked.sizeMB}MB)>`;
    }
    // Durable in S3, so reclaim the container's local disk: these logs run
    // tens of MB and `--logfile` accumulates them in the OS temp dir across
    // the browser's long life. A render timeout evicts the wedged page (its
    // isolate tears down; the next visit writes a FRESH log), so deleting
    // this one strands nothing. `await uploadArtifact` has fully drained the
    // read stream by now, so the unlink is safe; it frees the dirent
    // immediately and the bytes once the evicted renderer process exits.
    let cleanup = ' (local log removed)';
    try {
      await fs.rm(picked.full, { force: true });
    } catch (e) {
      cleanup = ` (local delete failed: ${String((e as { message?: string }).message ?? e).slice(0, 80)})`;
    }
    return `uploaded v8 --prof log ${path.basename(picked.full)} (${picked.sizeMB}MB) to artifact bucket${cleanup} — symbolize offline with \`node --prof-process\``;
  } catch (e) {
    // Never silently null — surface the reason on the timeout line.
    return `<v8 --prof upload error: ${String((e as { message?: string }).message ?? e).slice(0, 160)}>`;
  }
}
