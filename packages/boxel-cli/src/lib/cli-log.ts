/**
 * Centralized logger for the boxel CLI.
 *
 * # Guidance for command authors
 *
 * Pick where output goes by asking: **does anything ever parse this
 * line programmatically (`--json` consumer, shell pipeline, the
 * software factory tool executor)?**
 *
 * - **No → `console.log` / `console.info` / `console.debug`.** This is
 *   the default for interactive/decorative output: progress messages,
 *   colored confirmations ("Fixed: foo.gts"), summaries, anything you'd
 *   write with ANSI escapes from `lib/colors`. Under `--quiet` these are
 *   intercepted and silenced — a fresh command author doesn't need to
 *   know quiet mode exists.
 * - **Yes → `cliLog.output(...)`.** This is for raw payloads a caller
 *   parses: the `--json` branch (`cliLog.output(JSON.stringify(result, null, 2))`),
 *   raw file content from `read`/`read-transpiled`, and any other
 *   stdout-as-contract output. `cliLog.output` writes to stdout
 *   regardless of `--quiet`.
 * - **Errors / warnings → `console.error` / `console.warn`.** Never
 *   silenced; goes to stderr.
 *
 * Quick heuristic: if the string you're about to print contains
 * `FG_GREEN`/`DIM`/`RESET`/etc., it's decorative — use `console.log`.
 * If it's `JSON.stringify(...)` or raw bytes, use `cliLog.output`.
 *
 * # How it works
 *
 * `--quiet` is a global flag in `src/index.ts`. When set, `setQuiet(true)`
 * replaces `console.log`/`info`/`debug` with no-ops; `cliLog.output`
 * writes directly to `process.stdout` and bypasses the interceptor.
 * Software factory's tool executor passes `--quiet` by default so chatty
 * progress lines don't pollute CI logs (see `factory-tool-executor.ts`).
 */

let quiet = false;

/**
 * Original references to the console methods we intercept. Captured at
 * module load so `setQuiet(false)` can put them back if quiet mode is
 * toggled off (the unit tests rely on this).
 */
const originalConsoleLog = console.log.bind(console);
const originalConsoleInfo = console.info.bind(console);
const originalConsoleDebug = console.debug.bind(console);

/**
 * Toggle quiet mode. When true, `console.log` / `console.info` /
 * `console.debug` are replaced with no-ops for the lifetime of the
 * process. `console.warn` and `console.error` are untouched.
 *
 * Idempotent: calling with the same value is a no-op.
 */
export function setQuiet(value: boolean): void {
  if (value === quiet) return;
  quiet = value;
  if (quiet) {
    const noop = () => {
      /* intentionally empty: silence info/log/debug under --quiet */
    };
    console.log = noop;
    console.info = noop;
    console.debug = noop;
  } else {
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.debug = originalConsoleDebug;
  }
}

export function isQuiet(): boolean {
  return quiet;
}

export const cliLog = {
  /**
   * Informational progress message. Silenced under `--quiet`. Goes to
   * stderr (not stdout) so that it never contaminates stdout-payload
   * commands even when they're inadvertently mixed in.
   */
  info(...args: unknown[]): void {
    if (quiet) return;
    process.stderr.write(args.map(stringifyArg).join(' ') + '\n');
  },

  /**
   * Warning. Always written (even under quiet) — warnings should reach
   * the operator. Goes to stderr.
   */
  warn(...args: unknown[]): void {
    process.stderr.write(args.map(stringifyArg).join(' ') + '\n');
  },

  /**
   * Error. Always written (even under quiet). Goes to stderr.
   */
  error(...args: unknown[]): void {
    process.stderr.write(args.map(stringifyArg).join(' ') + '\n');
  },

  /**
   * Programmatic command output — the "result payload" a caller parses.
   * Writes to stdout and is **never** silenced by `--quiet`.
   *
   * Use this **only** for output where stdout is the contract:
   *   - `--json` branches: `cliLog.output(JSON.stringify(result, null, 2))`
   *   - raw file content: `read` / `read-transpiled` print bytes via
   *     `cliLog.output(result.content ?? '')`
   *   - any other stdout-as-API output a script or the software factory
   *     pipes/parses
   *
   * Do **not** use this for human-facing decorative lines (colored
   * confirmations, status, summaries, progress). Those go to
   * `console.log` so the `--quiet` interceptor can silence them.
   * If you're tempted to wrap the string in ANSI escapes from
   * `lib/colors`, you want `console.log`, not `cliLog.output`.
   */
  output(...args: unknown[]): void {
    process.stdout.write(args.map(stringifyArg).join(' ') + '\n');
  },
};

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
