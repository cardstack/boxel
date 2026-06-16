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

// Best-effort summary of the hottest frames from the renderer's `--prof`
// log via `node --prof-process`. Called on the timeout path only when
// armed. Time-boxed — the log can be large, and the pegged render's
// samples dominate it, so the top self-time frames name the wedge.
export async function processV8ProfTopFrames(
  budgetMs = 40000,
): Promise<string | null> {
  if (!v8ProfEnabled()) {
    return null;
  }
  try {
    let entries = await fs.readdir(V8_PROF_LOG_DIR);
    // `includes`, not `startsWith`: V8's per-isolate logging prepends
    // `isolate-<addr>-` to the --logfile name, so the file is e.g.
    // `isolate-0x…-prerender-v8-prof-<pid>.log`.
    let logs = entries.filter(
      (e) => e.includes(V8_PROF_LOG_PREFIX) && e.endsWith('.log'),
    );
    if (logs.length === 0) {
      // Name what IS present, so a still-missed pattern is self-diagnosing.
      let present = entries.filter((e) => e.endsWith('.log')).slice(0, 12);
      return `<no v8 --prof log found; .log present: ${present.join(', ') || 'none'}>`;
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
    // Only this browser run's logs (stale prior-run logs were cleared +
    // the launch time stamped). Among those pick the LARGEST: the pegged
    // isolate accumulates by far the most samples over the 60s peg, so its
    // log dwarfs sibling isolates' and earlier renders' — and the peg's
    // samples dominate its top frames regardless of what else it rendered.
    let fromThisRun = withStats.filter(
      (s) => s.size > 0 && s.mtimeMs >= v8ProfLaunchAt,
    );
    if (fromThisRun.length === 0) {
      let seen = withStats
        .map((s) => `${path.basename(s.full)}(${s.size}b)`)
        .slice(0, 8);
      return `<no v8 --prof log from this run; seen: ${seen.join(', ')}>`;
    }
    fromThisRun.sort((a, b) => b.size - a.size);
    let logPath = fromThisRun[0].full;
    let sizeMB = (fromThisRun[0].size / (1024 * 1024)).toFixed(1);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        process.execPath,
        ['--prof-process', logPath],
        { timeout: budgetMs, maxBuffer: 128 * 1024 * 1024 },
      ));
    } catch (e) {
      // Report the reason + size rather than swallowing it: a large
      // accumulated log (every render since browser launch) can blow the
      // time-box or the stdout cap, and we need to SEE that, not get null.
      let err = e as { code?: string; killed?: boolean; message?: string };
      return `<prof-process failed on ${path.basename(logPath)} (${sizeMB}MB)${err.killed ? ' [killed: timed out]' : ''}: ${err.code ?? ''} ${String(err.message ?? e).slice(0, 140)}>`;
    }
    let lines = stdout.split('\n');
    // The bottom-up "[Summary]" section lists self-time by category; the
    // top JS/C++ entries that follow name the hot function.
    let summaryIdx = lines.findIndex((l) => /\[Summary\]/.test(l));
    let slice =
      summaryIdx >= 0
        ? lines.slice(summaryIdx, summaryIdx + 60)
        : lines.slice(0, 60);
    let summary = slice.join('\n').trim();
    return `[${path.basename(logPath)} ${sizeMB}MB]\n${summary || '<empty prof summary>'}`;
  } catch (e) {
    // Never silently null — surface the reason on the timeout line.
    return `<v8 --prof reader error: ${String((e as { message?: string }).message ?? e).slice(0, 160)}>`;
  }
}
