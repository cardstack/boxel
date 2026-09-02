import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBoxel } from '../helpers/run-boxel.ts';

// `runBoxel`'s deadline is a backstop for a command that never finishes. These
// cover the two ways it has to stay out of the way of the command it is
// protecting: it must not fire early enough to pre-empt a deadline the command
// was given on its own argv, and when it does fire it has to say so — a
// killed process reports a null exit code, which is otherwise indistinguishable
// from the command failing on its own.

let scriptDir: string;
let stubBin: string;
let originalBin: string | undefined;

// Stands in for the CLI, in the shapes a deadline has to cope with:
//
//   --hang           idles past any deadline
//   --deaf           idles and swallows SIGTERM, like a command with its own
//                    shutdown handler
//   --leave-orphan   idles after spawning a child that inherits its stdio and
//                    would outlive it, the way `boxel parse` leaves ember-tsc
//                    and `boxel test` leaves chromium — the pipes stay open,
//                    so `close` never arrives. Prints the child's pid so the
//                    test can check it is reaped.
//
// Anything else prints on both streams and exits 0.
const STUB_CLI = `
const { spawn } = require('node:child_process');
if (process.argv.includes('--deaf')) {
  process.on('SIGTERM', () => {});
}
if (process.argv.includes('--leave-orphan')) {
  let orphan = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], {
    stdio: 'inherit',
  });
  process.stdout.write('orphan-pid=' + orphan.pid + '\\n');
}
if (
  process.argv.some((a) => ['--hang', '--deaf', '--leave-orphan'].includes(a))
) {
  process.stderr.write('working…\\n');
  setInterval(() => {}, 1 << 30);
} else {
  process.stdout.write('{"ok":true}');
  process.stderr.write('a note\\n');
}
`;

/**
 * True while `pid` names a process that is still executing.
 *
 * `process.kill(pid, 0)` is not that test: a killed process whose parent is
 * gone stays in the process table as a zombie until whatever inherited it
 * reaps it, and signalling a zombie succeeds. Read the state out of `/proc`
 * where it is available, and fall back to the signal probe elsewhere.
 */
function isRunning(pid: number): boolean {
  try {
    let stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Fields after the parenthesised comm: state is the first of them.
    let state = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[0];
    return state !== 'Z';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeAll(() => {
  scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-cli-deadline-'));
  stubBin = path.join(scriptDir, 'stub-cli.js');
  fs.writeFileSync(stubBin, STUB_CLI, 'utf8');
  originalBin = process.env.BOXEL_CLI_BIN;
  process.env.BOXEL_CLI_BIN = stubBin;
});

afterAll(() => {
  if (originalBin === undefined) {
    delete process.env.BOXEL_CLI_BIN;
  } else {
    process.env.BOXEL_CLI_BIN = originalBin;
  }
  fs.rmSync(scriptDir, { recursive: true, force: true });
});

describe('runBoxel deadline', () => {
  it('leaves a command that exits on its own untouched', async () => {
    let res = await runBoxel(['whatever'], { timeout: 30_000 });
    expect(res.timedOut).toBe(false);
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe('{"ok":true}');
    expect(res.stderr).toBe('a note\n');
  });

  it('reports the kill, the elapsed time, and the command line', async () => {
    let res = await runBoxel(['--hang'], { timeout: 1_000 });
    expect(res.timedOut).toBe(true);
    expect(res.ok).toBe(false);
    // What the command had printed before the kill survives above the report.
    expect(res.stderr).toContain('working…');
    expect(res.stderr).toMatch(/\[runBoxel\] killed after \d+ms/);
    expect(res.stderr).toContain('deadline 1000ms');
    expect(res.stderr).toContain('--hang');
  });

  it('ends a command that swallows SIGTERM', async () => {
    let startedAt = Date.now();
    let res = await runBoxel(['--deaf'], { timeout: 1_000 });
    expect(res.timedOut).toBe(true);
    // SIGTERM at 1s, SIGKILL 5s later: the deadline still ends the command,
    // rather than handing the enclosing test's budget the job.
    expect(Date.now() - startedAt).toBeLessThan(20_000);
  });

  it('ends a command whose child keeps the stdio pipes open, and that child', async () => {
    let startedAt = Date.now();
    let res = await runBoxel(['--leave-orphan'], { timeout: 1_000 });
    expect(res.timedOut).toBe(true);
    expect(res.stderr).toContain('working…');
    // The child would hold the pipes for ten minutes, so `close` never
    // arrives; settling on the command's own exit is what bounds this.
    expect(Date.now() - startedAt).toBeLessThan(20_000);

    let orphanPid = Number(/orphan-pid=(\d+)/.exec(res.stdout)?.[1]);
    expect(Number.isInteger(orphanPid)).toBe(true);
    // Killing the group, not just the command, is what stops that child from
    // running on into the tests that follow it in this process.
    expect(isRunning(orphanPid)).toBe(false);
  });

  it('refuses a deadline that would pre-empt the command own deadline', async () => {
    await expect(
      runBoxel(['realm', 'publish', '--timeout', '60000'], { timeout: 60_000 }),
    ).rejects.toThrow(
      /cannot enforce a command that was given --timeout 60000/,
    );
  });

  it('accepts a command own deadline that the default clears by a margin', async () => {
    // 30s leaves the default 60s deadline a full margin above it, so a wedged
    // command reports its own diagnostic and the harness never needs a budget
    // the vitest config does not cover. The stub exits at once; what is under
    // test is that no deadline error is raised and nothing is killed.
    let res = await runBoxel(['realm', 'publish', '--timeout=30000']);
    expect(res.timedOut).toBe(false);
    expect(res.ok).toBe(true);
  });

  it('refuses to derive a deadline past what it takes on its own', async () => {
    // Deriving it would put the harness deadline at or above the vitest
    // budgets, and the budget that then fires first abandons the subprocess
    // rather than ending it. The helper cannot see those budgets, so it makes
    // the call site name both rungs.
    await expect(
      runBoxel(['realm', 'publish', '--timeout', '60000']),
    ).rejects.toThrow(/Pass `timeout: 90000`/);
  });
});
