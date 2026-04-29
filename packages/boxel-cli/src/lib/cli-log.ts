/**
 * Centralized logger for the boxel CLI.
 *
 * Quiet mode is the mechanism that the software factory (and any other
 * automated caller) uses to silence the chatty per-step progress lines
 * commands emit (e.g. "Starting sync between …", "Downloaded: …",
 * "Sync completed"). When `--quiet` is supplied as a global CLI flag,
 * `setQuiet(true)` is called from `src/index.ts` BEFORE Commander invokes
 * any action, and we install a `console.log`/`console.info`/`console.debug`
 * interceptor that no-ops while quiet.
 *
 * Why intercept `console.*` rather than require commands to migrate to
 * a custom API? The issue explicitly asks for a solution "that requires
 * very little overhead for new commands … so that it is very simple or
 * automatic in terms of log silencing." Intercepting console means a new
 * command author can keep writing `console.log("Doing X…")` and it's
 * silenced for free under `--quiet`. The only thing they must remember is
 * that command **result payloads** (JSON sent to stdout for SF to parse,
 * file contents printed for `read`, etc.) must be emitted via
 * `cliLog.output()`, which writes to stdout regardless of quiet.
 *
 * Stderr (`console.error`, `console.warn`) is never silenced — errors and
 * warnings always surface.
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
   * Command result payload. Always written, even under quiet — this is
   * what callers (humans piping to a file, software-factory parsing the
   * tool output) actually want. Use this for JSON results, file
   * contents, listings, etc. Goes to stdout.
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
