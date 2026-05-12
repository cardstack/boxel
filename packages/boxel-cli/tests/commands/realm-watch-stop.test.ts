import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  listRegisteredProcesses,
  registerProcess,
  unregisterCurrentProcess,
} from '../../src/lib/watch-process-registry';
import { stopWatchProcesses } from '../../src/commands/realm/watch/stop';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const DEAD_PID = 2147483647; // max 32-bit int — extremely unlikely to be a real PID

let tmpHome: string;

function registryPath(): string {
  return path.join(tmpHome, '.boxel-cli', 'watch-processes.json');
}

function readRegistryRaw(): { processes: Array<Record<string, unknown>> } {
  return JSON.parse(fs.readFileSync(registryPath(), 'utf8')) as {
    processes: Array<Record<string, unknown>>;
  };
}

function writeRegistryRaw(processes: Array<Record<string, unknown>>): void {
  fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify({ processes }, null, 2));
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-watch-reg-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  process.env.USERPROFILE = ORIGINAL_USERPROFILE;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('watch-process-registry', () => {
  it('registerProcess writes parseable JSON with the current PID and workspace', async () => {
    await registerProcess('/tmp/work-a');

    const data = readRegistryRaw();
    expect(data.processes).toHaveLength(1);
    expect(data.processes[0]).toMatchObject({
      pid: process.pid,
      workspace: '/tmp/work-a',
    });
    expect(typeof data.processes[0].startedAt).toBe('string');
  });

  it('registerProcess replaces an earlier entry for the same PID rather than duplicating', async () => {
    writeRegistryRaw([
      {
        pid: process.pid,
        workspace: '/tmp/old',
        startedAt: '2020-01-01T00:00:00Z',
      },
    ]);

    await registerProcess('/tmp/new');

    const data = readRegistryRaw();
    const myEntries = data.processes.filter((p) => p.pid === process.pid);
    expect(myEntries).toHaveLength(1);
    expect(myEntries[0].workspace).toBe('/tmp/new');
  });

  it('unregisterCurrentProcess removes the current PID and leaves others alone', async () => {
    // Seed both entries directly so registerProcess's prune-dead pass doesn't
    // wipe the DEAD_PID before unregister runs.
    writeRegistryRaw([
      {
        pid: DEAD_PID,
        workspace: '/tmp/other',
        startedAt: '2020-01-01T00:00:00Z',
      },
      {
        pid: process.pid,
        workspace: '/tmp/mine',
        startedAt: '2020-01-01T00:00:00Z',
      },
    ]);

    await unregisterCurrentProcess();

    const raw = readRegistryRaw();
    expect(raw.processes.some((p) => p.pid === process.pid)).toBe(false);
    expect(raw.processes.some((p) => p.pid === DEAD_PID)).toBe(true);
  });

  it('unregisterCurrentProcess is a no-op when the registry file is absent', async () => {
    expect(fs.existsSync(registryPath())).toBe(false);
    await expect(unregisterCurrentProcess()).resolves.toBeUndefined();
    expect(fs.existsSync(registryPath())).toBe(false);
  });

  it('listRegisteredProcesses prunes dead PIDs from disk', async () => {
    writeRegistryRaw([
      {
        pid: DEAD_PID,
        workspace: '/tmp/dead',
        startedAt: '2020-01-01T00:00:00Z',
      },
      {
        pid: process.pid,
        workspace: '/tmp/alive',
        startedAt: '2020-01-01T00:00:00Z',
      },
    ]);

    const alive = await listRegisteredProcesses();
    expect(alive.map((p) => p.pid)).toEqual([process.pid]);

    const persisted = readRegistryRaw();
    expect(persisted.processes.map((p) => p.pid)).toEqual([process.pid]);
  });
});

describe('stopWatchProcesses', () => {
  it('returns an empty result and prunes dead registry entries when nothing live is registered', async () => {
    writeRegistryRaw([
      {
        pid: DEAD_PID,
        workspace: '/tmp/dead',
        startedAt: '2020-01-01T00:00:00Z',
      },
    ]);

    const result = await stopWatchProcesses();
    expect(result.stopped).toEqual([]);
    expect(result.failed).toEqual([]);

    const raw = readRegistryRaw();
    expect(raw.processes.some((p) => p.pid === DEAD_PID)).toBe(false);
  });
});
