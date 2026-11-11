import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import {
  formatChromeProcessMemory,
  formatTabHeapUsage,
  readChromeProcessMemory,
  toTabHeapUsage,
} from '../prerender/chrome-memory.ts';

const MB = 1024 * 1024;

// Builds a `/proc`-shaped tree: one directory per pid with the three files
// the reader consults. `cmdline` is written as given, so a test can use the
// space-separated form Chrome leaves after retitling its children.
async function writeProc(
  root: string,
  pid: number,
  opts: { ppid: number; comm: string; cmdline: string; rssAnonKB: number },
) {
  let dir = join(root, String(pid));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'stat'),
    `${pid} (${opts.comm}) S ${opts.ppid} ${pid} ${pid} 0 -1 4194560`,
  );
  await writeFile(join(dir, 'cmdline'), opts.cmdline);
  await writeFile(
    join(dir, 'status'),
    [
      `Name:\t${opts.comm}`,
      `PPid:\t${opts.ppid}`,
      `VmRSS:\t${opts.rssAnonKB + 2048} kB`,
      `RssAnon:\t${opts.rssAnonKB} kB`,
      `RssFile:\t2048 kB`,
      `RssShmem:\t0 kB`,
    ].join('\n'),
  );
}

module(basename(import.meta.filename), function (hooks) {
  let root: string;
  let procRoot: string;
  let cgroupRoot: string;

  hooks.beforeEach(async function () {
    root = await mkdtemp(join(tmpdir(), 'chrome-memory-test-'));
    procRoot = join(root, 'proc');
    cgroupRoot = join(root, 'cgroup');
    await mkdir(procRoot, { recursive: true });
    await mkdir(cgroupRoot, { recursive: true });

    // node (1) → chrome browser (100) → zygote (101) → renderers (102, 103)
    //                                 → gpu (104), network utility (105)
    // plus a process outside Chrome's tree (200) that must not be counted.
    await writeProc(procRoot, 1, {
      ppid: 0,
      comm: 'node',
      cmdline: 'node\0server.ts\0',
      rssAnonKB: 400 * 1024,
    });
    await writeProc(procRoot, 100, {
      ppid: 1,
      comm: 'chrome',
      cmdline: '/opt/chrome/chrome\0--headless=new\0--no-sandbox\0',
      rssAnonKB: 150 * 1024,
    });
    await writeProc(procRoot, 101, {
      ppid: 100,
      comm: 'chrome',
      cmdline: '/opt/chrome/chrome\0--type=zygote\0',
      rssAnonKB: 10 * 1024,
    });
    await writeProc(procRoot, 102, {
      ppid: 101,
      // A command name holding a space and a parenthesis, which the stat
      // parser has to read past.
      comm: 'Chrome (Renderer',
      cmdline: '/opt/chrome/chrome --type=renderer --renderer-client-id=5',
      rssAnonKB: 12 * 1024 * 1024,
    });
    await writeProc(procRoot, 103, {
      ppid: 101,
      comm: 'chrome',
      cmdline: '/opt/chrome/chrome --type=renderer --renderer-client-id=6',
      rssAnonKB: 300 * 1024,
    });
    await writeProc(procRoot, 104, {
      ppid: 100,
      comm: 'chrome',
      cmdline: '/opt/chrome/chrome\0--type=gpu-process\0',
      rssAnonKB: 80 * 1024,
    });
    await writeProc(procRoot, 105, {
      ppid: 100,
      comm: 'chrome',
      cmdline:
        '/opt/chrome/chrome\0--type=utility\0--utility-sub-type=network.mojom.NetworkService\0',
      rssAnonKB: 40 * 1024,
    });
    await writeProc(procRoot, 200, {
      ppid: 1,
      comm: 'fluent-bit',
      cmdline: 'fluent-bit\0',
      rssAnonKB: 999 * 1024,
    });
    // Non-pid entries `/proc` always has.
    await mkdir(join(procRoot, 'self'));
    await writeFile(join(procRoot, 'meminfo'), 'MemTotal: 1 kB\n');
  });

  hooks.afterEach(async function () {
    await rm(root, { recursive: true, force: true });
  });

  test('attributes private memory to each kind of Chrome process', async function (assert) {
    let memory = await readChromeProcessMemory(100, { procRoot, cgroupRoot });
    assert.deepEqual(
      memory && { ...memory, cgroup: undefined },
      {
        browserMB: 150,
        gpuMB: 80,
        rendererCount: 2,
        rendererSumMB: 12 * 1024 + 300,
        rendererMaxMB: 12 * 1024,
        rendererMaxPid: 102,
        otherMB: 50,
        cgroup: undefined,
      },
      'renderers are recognised from a space-separated cmdline, the zygote and utility land in other, and processes outside the browser tree (node, fluent-bit) are not counted',
    );
  });

  test('reads a cgroup v2 container as working set, anon and file', async function (assert) {
    await writeFile(join(cgroupRoot, 'memory.current'), `${14000 * MB}\n`);
    await writeFile(
      join(cgroupRoot, 'memory.stat'),
      [
        `anon ${12500 * MB}`,
        `file ${1500 * MB}`,
        `inactive_file ${1000 * MB}`,
      ].join('\n'),
    );
    let memory = await readChromeProcessMemory(100, { procRoot, cgroupRoot });
    assert.deepEqual(memory?.cgroup, {
      workingSetMB: 13000,
      anonMB: 12500,
      fileMB: 1500,
    });
  });

  test('reads a cgroup v1 container as working set, anon and file', async function (assert) {
    await mkdir(join(cgroupRoot, 'memory'));
    await writeFile(
      join(cgroupRoot, 'memory', 'memory.usage_in_bytes'),
      `${9000 * MB}\n`,
    );
    await writeFile(
      join(cgroupRoot, 'memory', 'memory.stat'),
      [
        `cache ${100 * MB}`,
        `rss ${100 * MB}`,
        `total_cache ${2000 * MB}`,
        `total_rss ${7000 * MB}`,
        `total_inactive_file ${500 * MB}`,
      ].join('\n'),
    );
    let memory = await readChromeProcessMemory(100, { procRoot, cgroupRoot });
    assert.deepEqual(
      memory?.cgroup,
      { workingSetMB: 8500, anonMB: 7000, fileMB: 2000 },
      'the hierarchical total_* figures are read, not the cgroup-local ones',
    );
  });

  test('yields null without a browser pid or a readable /proc', async function (assert) {
    assert.strictEqual(
      await readChromeProcessMemory(undefined, { procRoot, cgroupRoot }),
      null,
      'no browser launched',
    );
    assert.strictEqual(
      await readChromeProcessMemory(100, {
        procRoot: join(root, 'missing'),
        cgroupRoot,
      }),
      null,
      'no /proc (macOS)',
    );
    assert.strictEqual(
      await readChromeProcessMemory(4242, { procRoot, cgroupRoot }),
      null,
      'a browser pid that has already exited',
    );
  });

  test('formats as key=value pairs, omitting what was not read', async function (assert) {
    let memory = await readChromeProcessMemory(100, { procRoot, cgroupRoot });
    assert.strictEqual(
      formatChromeProcessMemory(memory),
      'chromeBrowserMB=150 chromeGpuMB=80 chromeOtherMB=50 chromeRenderers=2 chromeRendererSumMB=12588 chromeRendererMaxMB=12288 chromeRendererMaxPid=102',
    );
    assert.strictEqual(formatChromeProcessMemory(null), '');
  });

  test("splits a tab's heap reading into JS, DOM and buffers", function (assert) {
    let usage = toTabHeapUsage({
      usedSize: 160 * MB,
      totalSize: 200 * MB,
      embedderHeapUsedSize: 900 * MB,
      backingStorageSize: 40 * MB,
    });
    assert.strictEqual(
      formatTabHeapUsage(usage),
      'tabJsHeapUsedMB=160 tabJsHeapTotalMB=200 tabDomHeapMB=900 tabBuffersMB=40',
    );
    assert.strictEqual(
      toTabHeapUsage({}),
      null,
      'a reply without usedSize is no reading',
    );
    assert.strictEqual(formatTabHeapUsage(null), '');
  });
});
