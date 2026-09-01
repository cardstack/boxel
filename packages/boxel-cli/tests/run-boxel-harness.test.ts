import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reapInFlightCommands, runBoxel } from './helpers/run-boxel.ts';

function fixture(name: string): string {
  return resolve(import.meta.dirname, 'fixtures/run-boxel', name);
}

let previousBin = process.env.BOXEL_CLI_BIN;
let scratchDirs: string[] = [];

function scratchFile(name: string): string {
  let dir = mkdtempSync(join(tmpdir(), 'boxel-run-boxel-test-'));
  scratchDirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  if (previousBin === undefined) {
    delete process.env.BOXEL_CLI_BIN;
  } else {
    process.env.BOXEL_CLI_BIN = previousBin;
  }
  for (let dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  scratchDirs = [];
  vi.restoreAllMocks();
});

describe('runBoxel harness', () => {
  it('kills a command past its deadline and says so', async () => {
    process.env.BOXEL_CLI_BIN = fixture('hang.cjs');

    // Comfortably past interpreter startup: a deadline that races `node`'s
    // own boot kills the command before it installs its SIGTERM handler,
    // which silently stops exercising the escalation this asserts.
    let res = await runBoxel(['wedged'], { timeout: 3_000 });

    expect(res.timedOut).toBe(true);
    expect(res.ok).toBe(false);
    // Without this the caller sees only a null exit code and an empty
    // stderr, which reads like a command that failed on its own terms.
    expect(res.stderr).toContain('killed after exceeding its 3000ms deadline');
    // A command that ignores SIGTERM still dies, and its output survives.
    expect(res.stdout).toContain('hang.cjs started with args: wedged');
  });

  it('kills what the command spawned, not just the command', async () => {
    process.env.BOXEL_CLI_BIN = fixture('hang-with-grandchild.cjs');

    // The grandchild holds the stdio pipes, so this resolves at all only
    // because the whole process group is signalled.
    let res = await runBoxel([], { timeout: 3_000 });

    expect(res.timedOut).toBe(true);
    expect(res.stdout).toContain('parent started');
    expect(res.stdout).toContain('hang.cjs started with args: grandchild');
  });

  it('leaves a command that exits on its own untouched', async () => {
    process.env.BOXEL_CLI_BIN = fixture('echo-json.cjs');

    let res = await runBoxel(['--json', 'ping']);

    expect(res.ok).toBe(true);
    expect(res.timedOut).toBe(false);
    expect(res.json<{ args: string[] }>().args).toEqual(['--json', 'ping']);
  });

  it('reaps a command its test abandoned, naming the command', async () => {
    process.env.BOXEL_CLI_BIN = fixture('hang.cjs');
    let readyFile = scratchFile('ready');
    let errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    // vitest abandons a test at its own timeout while the command it started
    // keeps running against the shared realm server, so the harness reaps
    // survivors at every test and hook boundary.
    let abandoned = runBoxel(['abandoned', '--flag'], {
      env: { RUN_BOXEL_READY_FILE: readyFile },
    });
    // Generous, because this waits on `node` starting under whatever else
    // the runner is doing, and a tight budget here is its own flake.
    await vi.waitFor(() => expect(existsSync(readyFile)).toBe(true), {
      timeout: 10_000,
    });

    expect(reapInFlightCommands('test "some abandoning test"')).toBe(1);
    let report = errors.mock.calls.map(([message]) => message).join('\n');
    expect(report).toContain('command outlived test "some abandoning test"');
    expect(report).toContain('hang.cjs abandoned --flag');

    // A reaped command reads as reaped rather than as a command that failed
    // on its own terms.
    let res = await abandoned;
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(false);
    expect(res.stderr).toContain('killed when its test ended');
  });

  it('reaps nothing when every command has already exited', async () => {
    process.env.BOXEL_CLI_BIN = fixture('echo-json.cjs');

    await runBoxel([]);

    expect(reapInFlightCommands('a well behaved test')).toBe(0);
  });
});
