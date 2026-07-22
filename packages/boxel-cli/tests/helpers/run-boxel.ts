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
  /** Kill the command after this many ms (default 60s). */
  timeout?: number;
}

export interface BoxelResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True when the command exited 0. */
  ok: boolean;
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

  return new Promise<BoxelResult>((resolvePromise, reject) => {
    let child = spawn(command, [...baseArgs, ...args], {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout ?? 60_000,
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

    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({
        stdout,
        stderr,
        exitCode: code,
        ok: code === 0,
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
