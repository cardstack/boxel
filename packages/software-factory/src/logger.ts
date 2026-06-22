import { createRequire } from 'module';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'none';
type AcceptedLogLevel = LogLevel | 'silent';

type LoggerConfiguration = {
  defaultLevel?: LogLevel;
  logLevels?: [string, LogLevel][];
};

export type Logger = {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  log(message: string, ...args: unknown[]): void;
};

type LoggerFactory = {
  (name: string): Logger;
  configure(config?: LoggerConfiguration): void;
};

// The published package does not ship TypeScript declarations, so we keep the
// typing local here instead of maintaining an ambient .d.ts shim. It's also
// CJS, so under native ESM we load it through createRequire.
const require = createRequire(import.meta.url);
const createLogger = require('@cardstack/logger') as LoggerFactory;

export function configureLogger(serializedLogLevels: string): void {
  let config = parseLogConfiguration(serializedLogLevels);
  createLogger.configure(config);
}

// Prefix every line with a wall-clock timestamp and the elapsed time since
// the previous log line (across all channels) — the `+Δms` between two lines
// is the cheapest signal for "this step was slow". Off by default (clean
// output for normal runs); the factory CLI turns it on under `--debug` via
// setLogTimestampsEnabled. An explicit FACTORY_LOG_TIMESTAMPS=1/0 wins over
// the CLI flag either way.
function envTimestampOverride(): boolean | undefined {
  let v = process.env.FACTORY_LOG_TIMESTAMPS;
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return undefined;
}

let timestampsForced = envTimestampOverride();
let timestampsEnabled = timestampsForced ?? false;

/**
 * Toggle wall-clock/elapsed prefixes at runtime. The factory CLI calls this
 * with `true` when `--debug` is passed. A no-op when FACTORY_LOG_TIMESTAMPS
 * explicitly pins the value.
 */
export function setLogTimestampsEnabled(enabled: boolean): void {
  if (timestampsForced != null) return;
  timestampsEnabled = enabled;
}

// Shared across every logger instance so the delta reflects the gap to the
// previous line on any channel, not per-channel.
let lastLogTimeMs: number | undefined;

function timestampPrefix(): string {
  let now = Date.now();
  let deltaMs = lastLogTimeMs == null ? 0 : now - lastLogTimeMs;
  lastLogTimeMs = now;
  let d = new Date(now);
  let pad = (n: number, width = 2) => String(n).padStart(width, '0');
  let clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  return `[${clock} +${deltaMs}ms]`;
}

const LOG_METHODS = ['trace', 'debug', 'info', 'warn', 'error', 'log'] as const;

// @cardstack/logger severity order; the instance's numeric threshold
// (`_level`) is an index into this. Mirrors the library's own gate so we can
// tell, before calling through, whether a line will actually be emitted.
const LEVEL_ORDER = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'none',
] as const;

function willEmit(raw: Logger, method: (typeof LOG_METHODS)[number]): boolean {
  // `log` always prints (matches the library). For levelled methods, emit
  // when the method's severity is at or above the instance threshold.
  // `_level` is @cardstack/logger@0.2.1's private per-instance threshold; if a
  // future version drops it, the `?? 0` fallback just makes every line emit
  // (reverting to a slightly-skewed delta, never an error).
  if (method === 'log') return true;
  let threshold = (raw as unknown as { _level?: number })._level ?? 0;
  return LEVEL_ORDER.indexOf(method) >= threshold;
}

function withTimestamps(raw: Logger): Logger {
  let wrapped = {} as Logger;
  for (let method of LOG_METHODS) {
    wrapped[method] = (message: string, ...args: unknown[]) => {
      // Only stamp — and only advance the shared delta baseline — when
      // timestamps are enabled AND the line will actually print. Otherwise a
      // suppressed (or timestamp-disabled) call would make the next visible
      // line's +Δms measure from an invisible point. The call is still
      // forwarded either way.
      if (!timestampsEnabled || !willEmit(raw, method)) {
        return raw[method](message, ...args);
      }
      return raw[method](`${timestampPrefix()} ${message}`, ...args);
    };
  }
  return wrapped;
}

export function logger(logName: string): Logger {
  // Always wrap; the wrapper consults `timestampsEnabled` per call so the CLI
  // can flip timestamps on (under --debug) after these loggers are created.
  return withTimestamps(createLogger(logName));
}

function parseLogConfiguration(
  serializedLogLevels: string,
): LoggerConfiguration {
  // Keep pattern ordering intact to match @cardstack/logger. In particular,
  // `*` is just another pattern rule rather than a special default-level
  // signal, so later rules can still override earlier ones exactly as the
  // package does.
  let logLevels = serializedLogLevels
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => {
      let [logName, level] = pattern.split('=');
      assertLogLevel(level);
      return [logName, normalizeLogLevel(level)] as [string, LogLevel];
    });

  return {
    defaultLevel: 'info',
    logLevels,
  };
}

function normalizeLogLevel(level: AcceptedLogLevel): LogLevel {
  return level === 'silent' ? 'none' : level;
}

function assertLogLevel(level: unknown): asserts level is AcceptedLogLevel {
  if (
    level !== 'trace' &&
    level !== 'debug' &&
    level !== 'info' &&
    level !== 'warn' &&
    level !== 'error' &&
    level !== 'none' &&
    level !== 'silent'
  ) {
    throw new Error(
      `${String(level)} is not a valid log level. valid values are trace,debug,info,warn,error,none (silent is accepted as an alias for none)`,
    );
  }
}
