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

export function logger(logName: string): Logger {
  return createLogger(logName);
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
