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
//                    outlives it, the way `boxel parse` leaves ember-tsc and
//                    `boxel test` leaves chromium — the pipes stay open, so
//                    `close` never arrives
//
// Anything else prints on both streams and exits 0.
const STUB_CLI = `
const { spawn } = require('node:child_process');
if (process.argv.includes('--deaf')) {
  process.on('SIGTERM', () => {});
}
if (process.argv.includes('--leave-orphan')) {
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    stdio: 'inherit',
    detached: true,
  }).unref();
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

  it('ends a command whose orphan keeps the stdio pipes open', async () => {
    let startedAt = Date.now();
    let res = await runBoxel(['--leave-orphan'], { timeout: 1_000 });
    expect(res.timedOut).toBe(true);
    expect(res.stderr).toContain('working…');
    // The orphan holds the pipes for a minute; resolving on the command's own
    // exit means the deadline is not waiting on it.
    expect(Date.now() - startedAt).toBeLessThan(20_000);
  });

  it('refuses a deadline that would pre-empt the command own deadline', async () => {
    await expect(
      runBoxel(['realm', 'publish', '--timeout', '60000'], { timeout: 60_000 }),
    ).rejects.toThrow(
      /cannot enforce a command that was given --timeout 60000/,
    );
  });

  it('clears the command own deadline by a margin when none is requested', async () => {
    // 90s of margin over the command's 60s means the kill cannot land first,
    // so a wedged command still reports its own diagnostic. The stub exits
    // immediately; what is under test is that no deadline error is raised and
    // the run is not killed.
    let res = await runBoxel(['realm', 'publish', '--timeout=60000']);
    expect(res.timedOut).toBe(false);
    expect(res.ok).toBe(true);
  });
});
