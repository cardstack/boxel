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

// Stands in for the CLI. `--hang` idles past any deadline; otherwise it
// prints on both streams and exits 0.
const STUB_CLI = `
if (process.argv.includes('--hang')) {
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
