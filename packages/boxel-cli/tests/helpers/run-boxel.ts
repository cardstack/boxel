import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect } from 'vitest';

/**
 * Drive the `boxel` CLI as a subprocess — its real external interface
 * (argv + env + stdin → stdout/stderr/exit code), the same surface a
 * user or the software factory hits.
 *
 * The one thing that varies between contexts is *which* binary runs,
 * chosen by `BOXEL_CLI_BIN`:
 *
 * - **unset** → the local `dist/index.js` build. The default for
 *   `pnpm test:integration` during dev (run `pnpm build` first).
 * - **set** → an absolute path to an installed CLI's JS entry. The
 *   context runners (`scripts/run-cli-suite.ts`) point this at a
 *   freshly `npm install`ed CLI — a packed tarball on PRs, or the
 *   published version post-release — so the identical suite exercises
 *   the npm-hoisted `node_modules` layout a real install produces.
 *   That layout is exactly what in-process function-call tests could
 *   never reach — the one where `boxel parse`'s glint type-check
 *   silently resolves nothing under npm hoisting, passing a check that
 *   never actually ran.
 *
 * The install is always invoked through the current `node` rather than
 * the `.bin/boxel` shim so we don't depend on the shebang or the
 * executable bit surviving extraction — `node <entry>` resolves the
 * package's own `node_modules` identically to the shim.
 */
function resolveCliInvocation(): { command: string; baseArgs: string[] } {
  let bin = process.env.BOXEL_CLI_BIN;
  if (bin) {
    if (!existsSync(bin)) {
      throw new Error(
        `BOXEL_CLI_BIN points at ${bin}, which does not exist. The context runner should install the CLI before running the suite.`,
      );
    }
    return { command: process.execPath, baseArgs: [bin] };
  }
  let dist = resolve(import.meta.dirname, '../../dist/index.js');
  if (!existsSync(dist)) {
    throw new Error(
      `boxel-cli dist not found at ${dist}. Run \`pnpm build\` (or set BOXEL_CLI_BIN to an installed boxel binary) before running the CLI suite.`,
    );
  }
  return { command: process.execPath, baseArgs: [dist] };
}

export interface RunBoxelOptions {
  /** Working directory for the command (e.g. a parse workspace). */
  cwd?: string;
  /**
   * Home directory the CLI reads its profile from. The subprocess sees
   * `HOME` (POSIX) and `USERPROFILE` (Windows) set to this, so a profile
   * seeded on disk at `<home>/.boxel-cli/profiles.json` authenticates it
   * without a Matrix round-trip. See `seedJwtProfileOnDisk`.
   */
  home?: string;
  /** Extra env vars, merged last (override everything else). */
  env?: NodeJS.ProcessEnv;
  /** Text piped to the command's stdin. */
  input?: string;
  /**
   * Kill the command after this many ms (default 60s). A command that
   * needs longer than the enclosing test's own timeout must raise both,
   * or vitest abandons the test while the command is still running.
   */
  timeout?: number;
}

export interface BoxelResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True when the command exited 0. */
  ok: boolean;
  /** True when the command was killed for exceeding `options.timeout`. */
  timedOut: boolean;
  /**
   * Parse stdout as JSON (for commands run with `--json`). Throws with
   * the captured stdout/stderr attached when stdout isn't valid JSON, so
   * a failing command surfaces its error instead of an opaque parse
   * throw.
   */
  json<T = unknown>(): T;
}

/**
 * Strip `BOXEL_*` from the inherited env so a developer's shell (e.g.
 * one exporting `BOXEL_ENVIRONMENT` for mise tasks) can't change how the
 * CLI-under-test behaves — CI has no such vars, and the suite must match
 * CI. Tests opt specific vars back in via `options.env`.
 */
function sanitizedParentEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('BOXEL_')),
  );
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** How long a command gets to honor SIGTERM before it is SIGKILLed. */
const KILL_GRACE_MS = 2_000;
/** How much of a killed command's output is worth printing. */
const OUTPUT_TAIL_CHARS = 2_000;

interface InFlightCommand {
  child: ChildProcess;
  argv: string;
  startedAt: number;
  readStdout: () => string;
  readStderr: () => string;
}

const inFlight = new Set<InFlightCommand>();

function outputTail(text: string): string {
  if (text.length === 0) {
    return '(empty)';
  }
  return text.length <= OUTPUT_TAIL_CHARS
    ? text
    : `…${text.slice(-OUTPUT_TAIL_CHARS)}`;
}

function describeCommand(entry: InFlightCommand): string {
  return [
    `command: ${entry.argv}`,
    `pid: ${entry.child.pid ?? 'n/a'}`,
    `elapsed: ${Date.now() - entry.startedAt}ms`,
    `--- stdout so far ---\n${outputTail(entry.readStdout())}`,
    `--- stderr so far ---\n${outputTail(entry.readStderr())}`,
  ].join('\n');
}

/**
 * Kill any command still running when a test ends, and say what it was.
 *
 * vitest's default 30s `testTimeout` is shorter than this helper's 60s
 * command deadline, so a wedged command outlives the test that started it
 * and keeps writing to the realm server the *next* test is using — pushing
 * files, creating realms, or queueing index jobs behind a test that never
 * asked for any of it. Reaping at test boundaries keeps a single slow
 * command from becoming a cascade of unrelated failures.
 *
 * The report matters as much as the kill: on its own, a timed-out test
 * reports only `Test timed out in 30000ms`, which names neither the command
 * that hung nor what it had printed before it did.
 */
export function reapInFlightCommands(testName: string): number {
  let survivors = [...inFlight];
  inFlight.clear();
  for (let entry of survivors) {
    console.error(
      `[runBoxel] command outlived "${testName}"; killing it.\n${describeCommand(entry)}`,
    );
    entry.child.kill('SIGKILL');
  }
  return survivors.length;
}

afterEach(() => {
  if (inFlight.size === 0) {
    return;
  }
  reapInFlightCommands(expect.getState().currentTestName ?? 'unknown test');
});

export function runBoxel(
  args: string[],
  options: RunBoxelOptions = {},
): Promise<BoxelResult> {
  let { command, baseArgs } = resolveCliInvocation();
  let env: NodeJS.ProcessEnv = {
    ...sanitizedParentEnv(),
    ...(options.home ? { HOME: options.home, USERPROFILE: options.home } : {}),
    ...options.env,
  };

  let timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

  return new Promise<BoxelResult>((resolvePromise, reject) => {
    let child = spawn(command, [...baseArgs, ...args], {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    // Decode as UTF-8 via a StringDecoder that buffers partial multi-byte
    // sequences across `data` events. Without this each chunk is decoded
    // independently, so a multi-byte character split across a pipe
    // boundary would yield U+FFFD — a latent flake for realm content with
    // non-ASCII text (surfacing through `file read` and `--json` payloads
    // that get JSON.parsed).
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    let entry: InFlightCommand = {
      child,
      argv: [command, ...baseArgs, ...args].join(' '),
      startedAt: Date.now(),
      readStdout: () => stdout,
      readStderr: () => stderr,
    };
    inFlight.add(entry);

    // The deadline lives here rather than in `spawn`'s own `timeout` for
    // two reasons: `spawn` sends SIGTERM only, and `boxel realm watch`
    // installs a SIGTERM handler, so a command wedged inside that handler
    // needs the SIGKILL follow-up; and the caller needs to be told the
    // command was killed instead of inferring it from a null exit code.
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    let deadline = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);

    let settle = () => {
      clearTimeout(deadline);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      inFlight.delete(entry);
    };

    child.on('error', (err) => {
      settle();
      reject(err);
    });
    child.on('close', (code) => {
      settle();
      if (timedOut) {
        stderr += `\n[runBoxel] killed after exceeding its ${timeoutMs}ms deadline: ${entry.argv}\n`;
      }
      resolvePromise({
        stdout,
        stderr,
        exitCode: code,
        ok: code === 0,
        timedOut,
        json<T = unknown>(): T {
          try {
            return JSON.parse(stdout) as T;
          } catch (err) {
            throw new Error(
              `Expected JSON on stdout but parse failed (${
                err instanceof Error ? err.message : String(err)
              }).\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
            );
          }
        },
      });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}
