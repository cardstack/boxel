import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBoxel } from '../helpers/run-boxel.ts';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'fake-watcher.cjs',
);
const READY_TIMEOUT_MS = 10_000;
const EXIT_TIMEOUT_MS = 5_000;

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

let tmpHome: string;
const liveChildren: ChildProcess[] = [];

function registryPath(): string {
  return path.join(tmpHome, '.boxel-cli', 'watch-processes.json');
}

function readRegistry(): Array<{ pid: number; workspace: string }> {
  if (!fs.existsSync(registryPath())) return [];
  const raw = fs.readFileSync(registryPath(), 'utf8');
  return (
    JSON.parse(raw) as { processes: Array<{ pid: number; workspace: string }> }
  ).processes;
}

function spawnFakeWatcher(opts: {
  workspace: string;
  doRegister?: boolean;
  argv?: string[];
}): Promise<ChildProcess> {
  const env = {
    ...process.env,
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    WATCHER_WORKSPACE: opts.workspace,
    DO_REGISTER: opts.doRegister === false ? 'false' : 'true',
  };
  const args = [FIXTURE_PATH, ...(opts.argv ?? [])];
  const child = spawn(process.execPath, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  liveChildren.push(child);

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('fake watcher did not signal ready in time'));
      }
    }, READY_TIMEOUT_MS);

    let buf = '';
    child.stdout?.on('data', (chunk) => {
      buf += chunk.toString();
      if (buf.includes('FAKE_WATCHER_READY') && !resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(new Error(`fake watcher exited early with code ${code}`));
      }
    });
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('child did not exit in time'));
    }, EXIT_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-watch-stop-int-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(async () => {
  // Reap any survivors so a failed test doesn't leave processes around.
  for (const child of liveChildren) {
    if (child.exitCode === null && child.pid !== undefined) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  }
  liveChildren.length = 0;
  process.env.HOME = ORIGINAL_HOME;
  process.env.USERPROFILE = ORIGINAL_USERPROFILE;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('realm watch stop (integration)', () => {
  it('signals registered watchers and removes them from the registry', async () => {
    const child = await spawnFakeWatcher({ workspace: '/tmp/test-stop-a' });
    expect(child.pid).toBeDefined();

    const before = readRegistry();
    expect(before.some((p) => p.pid === child.pid)).toBe(true);

    // The CLI reads the watch-process registry from `$HOME/.boxel-cli`.
    let res = await runBoxel(['realm', 'watch', 'stop'], { home: tmpHome });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain(`PID ${child.pid}`);
    expect(res.stdout).not.toContain('Failed to stop');

    const exitCode = await waitForExit(child);
    expect(exitCode).toBe(0);

    const after = readRegistry();
    expect(after.some((p) => p.pid === child.pid)).toBe(false);
  });

  it('returns an empty result when no watchers are running', async () => {
    let res = await runBoxel(['realm', 'watch', 'stop'], { home: tmpHome });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain('No running watch processes found.');
  });

  it.skipIf(process.platform === 'win32')(
    'finds unregistered watchers via the ps fallback',
    async () => {
      // DO_REGISTER=false: the child does NOT enter the registry. We
      // craft argv so its `ps` line matches the `node ... boxel realm
      // watch start` pattern that stop.ts greps for.
      const child = await spawnFakeWatcher({
        workspace: '/tmp/test-stop-b',
        doRegister: false,
        argv: ['boxel', 'realm', 'watch', 'start', '/tmp/test-stop-b'],
      });
      expect(child.pid).toBeDefined();

      // Confirm the registry pass would have found nothing.
      expect(readRegistry().some((p) => p.pid === child.pid)).toBe(false);

      let res = await runBoxel(['realm', 'watch', 'stop'], { home: tmpHome });
      expect(res.ok, res.stderr).toBe(true);
      expect(res.stdout).toContain(`PID ${child.pid}`);

      const exitCode = await waitForExit(child);
      expect(exitCode).toBe(0);
    },
  );
});
