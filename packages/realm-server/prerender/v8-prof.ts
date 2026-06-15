// Diagnostic V8 `--prof` (kernel-signal CPU sampling) for the prerender
// renderer. Off by default (`PRERENDER_V8_PROF=true` to arm).
//
// Why this exists alongside `Debugger.pause` (pause-capture.ts):
//
//   `Debugger.pause` reads a synchronous JS loop (V8 honors the pause at a
//   back-edge) with zero continuous overhead. But if the wedge is one long
//   NON-YIELDING native call there is no back-edge, and pause times out.
//   `--prof` covers that gap: the kernel SIGPROF timer preempts the thread
//   mid-instruction regardless of what it's running (JS or native), so the
//   busiest frame wins the samples — exactly the case `Debugger.pause`
//   can't reach. It also never needs the pegged thread to service a CDP
//   `stop` (the failure mode of the CDP `Profiler`; see trace-capture.ts).
//
//   The trade-off, and why it's gated off: it samples EVERY render, so its
//   own interrupts can perturb a timing-sensitive wedge enough to dissolve
//   it. Run it only when `Debugger.pause` reports `pause-timeout` (a
//   suspected native peg).

import { logger } from '@cardstack/runtime-common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const log = logger('prerenderer');
const execFileAsync = promisify(execFile);

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
  if (!v8ProfEnabled()) {
    return;
  }
  v8ProfLaunchAt = Date.now();
  try {
    let entries = await fs.readdir(V8_PROF_LOG_DIR);
    await Promise.all(
      entries
        .filter((e) => e.startsWith(V8_PROF_LOG_PREFIX) && e.endsWith('.log'))
        .map((e) =>
          fs.rm(path.join(V8_PROF_LOG_DIR, e), { force: true }).catch(() => {}),
        ),
    );
  } catch (e) {
    log.debug('v8 --prof stale-log cleanup failed:', e);
  }
}

// Best-effort summary of the hottest frames from the renderer's `--prof`
// log via `node --prof-process`. Called on the timeout path only when
// armed. Time-boxed — the log can be large, and the pegged render's
// samples dominate it, so the top self-time frames name the wedge.
export async function processV8ProfTopFrames(
  budgetMs = 20000,
): Promise<string | null> {
  if (!v8ProfEnabled()) {
    return null;
  }
  try {
    let entries = await fs.readdir(V8_PROF_LOG_DIR);
    let logs = entries.filter(
      (e) => e.startsWith(V8_PROF_LOG_PREFIX) && e.endsWith('.log'),
    );
    if (logs.length === 0) {
      return '<no v8 --prof log found>';
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
    // Only this browser run's logs (cleared + stamped at launch), and
    // among those the most-recently-written one — the renderer that was
    // still spinning up to the timeout, not an earlier completed render's
    // larger-but-stale log.
    let fromThisRun = withStats.filter(
      (s) => s.size > 0 && s.mtimeMs >= v8ProfLaunchAt,
    );
    if (fromThisRun.length === 0) {
      return '<no v8 --prof log from this run>';
    }
    fromThisRun.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let logPath = fromThisRun[0].full;
    let { stdout } = await execFileAsync(
      process.execPath,
      ['--prof-process', logPath],
      { timeout: budgetMs, maxBuffer: 32 * 1024 * 1024 },
    );
    let lines = stdout.split('\n');
    // The bottom-up "[Summary]" section lists self-time by category; the
    // top JS/C++ entries that follow name the hot function.
    let summaryIdx = lines.findIndex((l) => /\[Summary\]/.test(l));
    let slice =
      summaryIdx >= 0
        ? lines.slice(summaryIdx, summaryIdx + 60)
        : lines.slice(0, 60);
    return slice.join('\n').trim() || '<empty prof summary>';
  } catch (e) {
    log.debug('v8 --prof processing failed:', e);
    return null;
  }
}
