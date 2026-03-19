export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'none';

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
  let parsedLevels = serializedLogLevels
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => {
      let [logName, level] = pattern.split('=');
      assertLogLevel(level);
      return [logName, level] as [string, LogLevel];
    });

  let defaultLevel =
    parsedLevels.find(([pattern]) => pattern === '*')?.[1] ?? 'info';
  let logLevels = parsedLevels.filter(([pattern]) => pattern !== '*');

  return {
    defaultLevel,
    logLevels,
  };
}

function assertLogLevel(level: unknown): asserts level is LogLevel {
  if (
    level !== 'trace' &&
    level !== 'debug' &&
    level !== 'info' &&
    level !== 'warn' &&
    level !== 'error' &&
    level !== 'none'
  ) {
    throw new Error(
      `${String(level)} is not a valid log level. valid values are trace,debug,info,warn,error,none`,
    );
  }
}
