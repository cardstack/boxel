import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
   * Kill the command after this many ms (default 60s, and never less than a
   * margin above a deadline the command was given on its own argv — see
   * `resolveDeadline`).
   */
  timeout?: number;
}

export interface BoxelResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True when the command exited 0. */
  ok: boolean;
  /**
   * True when the harness's deadline killed the command rather than the
   * command exiting on its own. Distinguishes "the CLI reported a failure"
   * from "the CLI never finished", which the exit code alone cannot: a
   * signalled process reports a null code, which is only visible as
   * `ok === false`.
   */
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
 * The deadline a command was given on its own argv, in ms, or undefined when
 * it was given none. Commands that poll (`realm publish`, `realm
 * wait-for-ready`) take `--timeout <ms>` and report a precise diagnostic of
 * their own when it elapses.
 */
function commandOwnDeadlineMs(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    let value =
      args[i] === '--timeout'
        ? args[i + 1]
        : args[i].startsWith('--timeout=')
          ? args[i].slice('--timeout='.length)
          : undefined;
    if (value === undefined) {
      continue;
    }
    let ms = Number(value);
    if (Number.isFinite(ms) && ms >= 0) {
      return ms;
    }
  }
  return undefined;
}

/**
 * How long a command gets before the harness kills it, absent anything more
 * specific. Exported because `vitest.config.mjs` has to keep its own budgets
 * above this one — see the ladder described there, and
 * `tests/lib/deadline-ladder.test.ts`.
 */
export const RUN_BOXEL_DEFAULT_DEADLINE_MS = 60_000;
/**
 * How far the harness's deadline must sit above the command's own. Only needs
 * to cover the command noticing its deadline, printing its diagnostic, and
 * exiting — a fraction of the deadline it is protecting.
 */
const DEADLINE_MARGIN_MS = 30_000;

/**
 * The harness deadline exists to stop a *wedged* command from hanging its
 * test, so it must never be the thing that pre-empts a command's own
 * deadline. A command killed at the same instant it was about to report
 * "timed out after Nms waiting for …" dies with that reason unwritten, and
 * the test is left asserting on an exit code with nothing to explain it.
 */
function resolveDeadline(
  args: string[],
  requested: number | undefined,
): number {
  let ownDeadline = commandOwnDeadlineMs(args);
  if (ownDeadline === undefined) {
    return requested ?? RUN_BOXEL_DEFAULT_DEADLINE_MS;
  }
  let floor = ownDeadline + DEADLINE_MARGIN_MS;
  if (requested === undefined) {
    return Math.max(RUN_BOXEL_DEFAULT_DEADLINE_MS, floor);
  }
  if (requested < floor) {
    throw new Error(
      `runBoxel timeout of ${requested}ms cannot enforce a command that was ` +
        `given --timeout ${ownDeadline}: the kill would race the command's ` +
        `own deadline and discard its diagnostic. Use at least ${floor}ms, ` +
        `or lower the command's --timeout.`,
    );
  }
  return requested;
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

  let commandLine = [...baseArgs, ...args].join(' ');

  return new Promise<BoxelResult>((resolvePromise, reject) => {
    // Inside the executor so a misconfigured deadline rejects the returned
    // promise, the way every other failure from this helper does.
    let deadlineMs = resolveDeadline(args, options.timeout);
    let startedAt = Date.now();
    let child = spawn(command, [...baseArgs, ...args], {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Enforce the deadline here rather than through spawn's own `timeout`, so
    // the result can say the command was killed. spawn's kill leaves only a
    // null exit code behind, which reads as an ordinary failure.
    let timedOut = false;
    let deadline = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, deadlineMs);

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

    child.on('error', (err) => {
      clearTimeout(deadline);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(deadline);
      // Nearly every call site asserts with `expect(res.ok, res.stderr)`, so
      // stderr is where a reader looks for the reason. A killed command has
      // written no reason of its own — say so there, with what it had printed
      // before the kill left in place above it.
      let reportedStderr = timedOut
        ? `${stderr}\n[runBoxel] killed after ${
            Date.now() - startedAt
          }ms (deadline ${deadlineMs}ms): ${commandLine}\n`
        : stderr;
      resolvePromise({
        stdout,
        stderr: reportedStderr,
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
              }).\n--- stdout ---\n${stdout}\n--- stderr ---\n${reportedStderr}`,
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
