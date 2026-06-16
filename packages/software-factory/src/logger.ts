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
// typing local here instead of maintaining an ambient .d.ts shim.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createLogger = require('@cardstack/logger') as LoggerFactory;

export function configureLogger(serializedLogLevels: string): void {
  let config = parseLogConfiguration(serializedLogLevels);
  createLogger.configure(config);
}

// Prefix every line with a wall-clock timestamp and the elapsed time since
// the previous log line (across all channels). A long-running factory:go
// otherwise emits a flat wall of text with no way to attribute where the
// time went — the `+Δms` between two lines is the cheapest possible signal
// for "this step was slow". Disable with FACTORY_LOG_TIMESTAMPS=0 (e.g. when
// asserting on exact log output).
const TIMESTAMPS_ENABLED =
  process.env.FACTORY_LOG_TIMESTAMPS !== '0' &&
  process.env.FACTORY_LOG_TIMESTAMPS !== 'false';

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

function withTimestamps(raw: Logger): Logger {
  let wrapped = {} as Logger;
  for (let method of LOG_METHODS) {
    wrapped[method] = (message: string, ...args: unknown[]) =>
      raw[method](`${timestampPrefix()} ${message}`, ...args);
  }
  return wrapped;
}

export function logger(logName: string): Logger {
  let raw = createLogger(logName);
  return TIMESTAMPS_ENABLED ? withTimestamps(raw) : raw;
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
