import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'puppeteer';
import { raceNodeTimeout, TIMED_OUT } from './node-race.ts';

// Where a prerender task's memory sits, split the way that decides what to
// do about it. The Node heap is reported separately (`prerender-heap`); the
// numbers here cover the Chrome this process launched, and the container as
// the task's memory limit sees it.
//
// Read from `/proc` and the cgroup filesystem, never from Chrome, so a reading
// is available exactly when it matters most: while a renderer has stopped
// answering CDP. On a platform without `/proc` (macOS dev) the reading is
// `null` and the log lines omit it.

export interface ChromeProcessMemory {
  // Private (anonymous) resident memory, per process kind, in MB. Anonymous
  // memory is what JS heaps, the DOM, layout and decoded buffers live in, and
  // it is never shared, so these sum without double counting. Shared memory
  // Chrome passes between its processes is file-backed (Puppeteer launches
  // with `--disable-dev-shm-usage`, so it lives in the temp dir) and shows up
  // in the cgroup's `file` figure instead.
  browserMB: number;
  gpuMB: number;
  rendererCount: number;
  rendererSumMB: number;
  rendererMaxMB: number;
  rendererMaxPid: number | null;
  // Zygotes, the network and storage services and other utility processes.
  otherMB: number;
  cgroup: CgroupMemory | null;
}

export interface CgroupMemory {
  // Usage minus inactive file cache: the "working set" ECS and `docker stats`
  // report against the memory limit.
  workingSetMB: number;
  anonMB: number;
  fileMB: number;
}

export interface TabHeapUsage {
  // V8's JS heap. With pointer compression a renderer's JS heap cannot grow
  // past about 4 GB, so a renderer holding more than that is holding it in
  // one of the two figures below.
  jsUsedMB: number;
  jsTotalMB: number;
  // Blink's garbage-collected heap: DOM nodes, styles and other objects the
  // page's documents own.
  domMB: number;
  // Backing stores of ArrayBuffers and external strings, held outside the JS
  // heap.
  buffersMB: number;
}

export interface ChromeMemoryPaths {
  procRoot: string;
  cgroupRoot: string;
}

const DEFAULT_PATHS: ChromeMemoryPaths = {
  procRoot: '/proc',
  cgroupRoot: '/sys/fs/cgroup',
};

// A `/proc` walk over a few dozen Chrome processes takes milliseconds; the
// bound is there for a filesystem that stalls, so a log line is never held
// up by its own memory reading.
export const CHROME_MEMORY_READ_BUDGET_MS = 2000;

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

// `/proc/<pid>/stat` puts the command name in parentheses, and the name can
// itself contain spaces and parentheses, so the fields are read after the
// last `)`. The parent pid is the second field after it.
function parentPid(stat: string): number | null {
  let close = stat.lastIndexOf(')');
  if (close < 0) {
    return null;
  }
  let fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  let ppid = Number(fields[1]);
  return Number.isInteger(ppid) ? ppid : null;
}

// Chrome tags every child process with `--type=<kind>`; the browser process
// carries no type. On Linux, Chrome rewrites its children's process titles,
// which leaves their `cmdline` space-separated rather than NUL-separated, so
// both separators split it.
function processType(cmdline: string): string | null {
  for (let arg of cmdline.split(/[\0\s]+/)) {
    if (arg.startsWith('--type=')) {
      return arg.slice('--type='.length);
    }
  }
  return null;
}

function statusKB(status: string, field: string): number {
  let match = status.match(new RegExp(`^${field}:\\s+(\\d+)\\s+kB`, 'm'));
  return match ? Number(match[1]) : 0;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

// cgroup v2 exposes `memory.current` + `memory.stat` (anon/file/
// inactive_file) at the root of the container's cgroup namespace; cgroup v1
// exposes `memory/memory.usage_in_bytes` + `memory/memory.stat`
// (total_rss/total_cache/total_inactive_file).
export async function readCgroupMemory(
  cgroupRoot: string,
): Promise<CgroupMemory | null> {
  let statValue = (stat: string, key: string): number => {
    let match = stat.match(new RegExp(`^${key} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : 0;
  };
  let v2Current = await readOrNull(join(cgroupRoot, 'memory.current'));
  let v2Stat = await readOrNull(join(cgroupRoot, 'memory.stat'));
  if (v2Current !== null && v2Stat !== null) {
    let usage = Number(v2Current.trim());
    return {
      workingSetMB: mb(Math.max(0, usage - statValue(v2Stat, 'inactive_file'))),
      anonMB: mb(statValue(v2Stat, 'anon')),
      fileMB: mb(statValue(v2Stat, 'file')),
    };
  }
  let v1Usage = await readOrNull(
    join(cgroupRoot, 'memory', 'memory.usage_in_bytes'),
  );
  let v1Stat = await readOrNull(join(cgroupRoot, 'memory', 'memory.stat'));
  if (v1Usage !== null && v1Stat !== null) {
    let usage = Number(v1Usage.trim());
    return {
      workingSetMB: mb(
        Math.max(0, usage - statValue(v1Stat, 'total_inactive_file')),
      ),
      anonMB: mb(statValue(v1Stat, 'total_rss')),
      fileMB: mb(statValue(v1Stat, 'total_cache')),
    };
  }
  return null;
}

// Reads the browser process and every process descended from it. Never
// throws: a process that exits between the directory listing and the read is
// skipped, and a platform without `/proc` yields `null`.
export async function readChromeProcessMemory(
  browserPid: number | undefined,
  paths: ChromeMemoryPaths = DEFAULT_PATHS,
): Promise<ChromeProcessMemory | null> {
  if (browserPid === undefined) {
    return null;
  }
  let entries: string[];
  try {
    entries = await readdir(paths.procRoot);
  } catch {
    return null;
  }
  let children = new Map<number, number[]>();
  await Promise.all(
    entries
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        let stat = await readOrNull(join(paths.procRoot, name, 'stat'));
        let ppid = stat === null ? null : parentPid(stat);
        if (ppid === null) {
          return;
        }
        let list = children.get(ppid) ?? [];
        list.push(Number(name));
        children.set(ppid, list);
      }),
  );

  let pids: number[] = [];
  let queue = [browserPid];
  while (queue.length > 0) {
    let pid = queue.shift()!;
    pids.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }

  let result: ChromeProcessMemory = {
    browserMB: 0,
    gpuMB: 0,
    rendererCount: 0,
    rendererSumMB: 0,
    rendererMaxMB: 0,
    rendererMaxPid: null,
    otherMB: 0,
    cgroup: null,
  };
  let rendererMaxBytes = -1;
  let rendererSumBytes = 0;
  let browserBytes = 0;
  let gpuBytes = 0;
  let otherBytes = 0;
  let found = false;
  await Promise.all(
    pids.map(async (pid) => {
      let status = await readOrNull(
        join(paths.procRoot, String(pid), 'status'),
      );
      let cmdline = await readOrNull(
        join(paths.procRoot, String(pid), 'cmdline'),
      );
      if (status === null || cmdline === null) {
        return;
      }
      found = true;
      let anonBytes = statusKB(status, 'RssAnon') * 1024;
      let type = processType(cmdline);
      if (pid === browserPid) {
        browserBytes += anonBytes;
      } else if (type === 'renderer') {
        result.rendererCount++;
        rendererSumBytes += anonBytes;
        if (anonBytes > rendererMaxBytes) {
          rendererMaxBytes = anonBytes;
          result.rendererMaxPid = pid;
        }
      } else if (type === 'gpu-process') {
        gpuBytes += anonBytes;
      } else {
        otherBytes += anonBytes;
      }
    }),
  );
  if (!found) {
    return null;
  }
  result.browserMB = mb(browserBytes);
  result.gpuMB = mb(gpuBytes);
  result.rendererSumMB = mb(rendererSumBytes);
  result.rendererMaxMB = mb(Math.max(0, rendererMaxBytes));
  result.otherMB = mb(otherBytes);
  result.cgroup = await readCgroupMemory(paths.cgroupRoot);
  return result;
}

// Same `key=value` shape as `prerender-heap`, so a Loki `regexp` stage or a
// CloudWatch `parse` can pull any field out on its own.
export function formatChromeProcessMemory(
  memory: ChromeProcessMemory | null,
): string {
  if (!memory) {
    return '';
  }
  let parts = [
    `chromeBrowserMB=${memory.browserMB}`,
    `chromeGpuMB=${memory.gpuMB}`,
    `chromeOtherMB=${memory.otherMB}`,
    `chromeRenderers=${memory.rendererCount}`,
    `chromeRendererSumMB=${memory.rendererSumMB}`,
    `chromeRendererMaxMB=${memory.rendererMaxMB}`,
  ];
  if (memory.rendererMaxPid !== null) {
    parts.push(`chromeRendererMaxPid=${memory.rendererMaxPid}`);
  }
  if (memory.cgroup) {
    parts.push(
      `cgroupWorkingSetMB=${memory.cgroup.workingSetMB}`,
      `cgroupAnonMB=${memory.cgroup.anonMB}`,
      `cgroupFileMB=${memory.cgroup.fileMB}`,
    );
  }
  return parts.join(' ');
}

export function toTabHeapUsage(usage: {
  usedSize?: number;
  totalSize?: number;
  embedderHeapUsedSize?: number;
  backingStorageSize?: number;
}): TabHeapUsage | null {
  if (typeof usage.usedSize !== 'number') {
    return null;
  }
  return {
    jsUsedMB: mb(usage.usedSize),
    jsTotalMB: mb(usage.totalSize ?? 0),
    domMB: mb(usage.embedderHeapUsedSize ?? 0),
    buffersMB: mb(usage.backingStorageSize ?? 0),
  };
}

export function formatTabHeapUsage(usage: TabHeapUsage | null): string {
  if (!usage) {
    return '';
  }
  return (
    `tabJsHeapUsedMB=${usage.jsUsedMB} ` +
    `tabJsHeapTotalMB=${usage.jsTotalMB} ` +
    `tabDomHeapMB=${usage.domMB} ` +
    `tabBuffersMB=${usage.buffersMB}`
  );
}

// `Runtime.getHeapUsage` on a short-lived session of its own. Bounded by
// `budgetMs` so a tab that has stopped answering costs the caller at most
// that; a session that attaches after the budget is detached when it does.
export async function readTabHeapUsage(
  page: Page,
  budgetMs: number,
): Promise<TabHeapUsage | null> {
  if (page.isClosed()) {
    return null;
  }
  let read = (async () => {
    let client = await page.createCDPSession();
    try {
      return toTabHeapUsage(
        (await client.send('Runtime.getHeapUsage')) as {
          usedSize?: number;
          totalSize?: number;
          embedderHeapUsedSize?: number;
          backingStorageSize?: number;
        },
      );
    } finally {
      await client.detach().catch(() => {});
    }
  })();
  try {
    let usage = await raceNodeTimeout(read, budgetMs);
    if (usage === TIMED_OUT) {
      read.catch(() => {});
      return null;
    }
    return usage;
  } catch {
    return null;
  }
}

export function browserPidOf(page: Page): number | undefined {
  try {
    return page.browser().process()?.pid;
  } catch {
    return undefined;
  }
}

// What a visit reports about memory at its end: the tab's own heap, and the
// whole browser's processes beside it.
export interface VisitMemory {
  tab: TabHeapUsage | null;
  chrome: ChromeProcessMemory | null;
}

// Budget for the tab's own heap reading at the end of a healthy visit. A tab
// that has just finished rendering answers in milliseconds; this only caps
// the cost of one that hasn't.
const VISIT_TAB_HEAP_BUDGET_MS = 1000;

// Never throws, and both readings are bounded.
export async function readVisitMemory(
  page: Page,
  opts: { includeTab: boolean },
): Promise<VisitMemory> {
  let [tab, chrome] = await Promise.all([
    opts.includeTab
      ? readTabHeapUsage(page, VISIT_TAB_HEAP_BUDGET_MS)
      : Promise.resolve(null),
    raceNodeTimeout(
      readChromeProcessMemory(browserPidOf(page)),
      CHROME_MEMORY_READ_BUDGET_MS,
    )
      .then((memory) => (memory === TIMED_OUT ? null : memory))
      .catch(() => null),
  ]);
  return { tab, chrome };
}

export function formatVisitMemory(memory: VisitMemory | undefined): string {
  if (!memory) {
    return '';
  }
  return [
    formatTabHeapUsage(memory.tab),
    formatChromeProcessMemory(memory.chrome),
  ]
    .filter((part) => part.length > 0)
    .join(' ');
}
