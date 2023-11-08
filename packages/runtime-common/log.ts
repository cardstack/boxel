import LogLevel, { type LogLevelDesc } from 'loglevel';

/*
 * this module allows us to specify log levels as outlined in the
 * @cardstack/logger package here https://github.com/cardstack/logger. For
 * example:
 *
 *  $ LOG_LEVELS='*=none,app:*=debug,dependency=warn' node app.js
 *    app:index starting up
 *    app:index running dependency
 *    dependency Woah this isn't linux, don't you believe in free software?!
 *    app:index all done
 */

const DEFAULT_LOG_LEVEL = 'debug';

const validLevels = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'silent',
  0,
  1,
  2,
  3,
  4,
  5,
];

interface LogDefinitions {
  [logName: string]: LogLevel.LogLevelDesc;
}

export function makeLogDefinitions(
  serializedLogLevels: string,
): LogDefinitions {
  return Object.fromEntries(
    serializedLogLevels.split(',').map((pattern) => {
      let [logName, level] = pattern.split('=');
      assertLogLevelDesc(level);
      return [logName, level];
    }),
  );
}

export function logger(
  logName: string,
  logDefinitions: LogDefinitions = (globalThis as any)._logDefinitions,
): LogLevel.Logger {
  if (!logDefinitions) {
    throw new Error(
      `Missing logDefinitions. Make sure that 'makeLogDefinitions()' is called before any module scoped code. The best way to ensure this is to evaluate makeLogDefinitions() in the module scope in its own module that is imported for side effect from the entry point module.`,
    );
  }
  let log = LogLevel.getLogger(logName);
  let level = getLevelForLog(logName, logDefinitions);
  if (level) {
    log.setLevel(level);
  }
  return log;
}

function getLevelForLog(
  logName: string,
  logDefinitions: LogDefinitions,
): LogLevel.LogLevelDesc {
  if (Object.keys(logDefinitions).includes(logName)) {
    return logDefinitions[logName];
  }
  let matchingDefinitions = Object.keys(logDefinitions).filter(
    (candidate) =>
      logName.startsWith(candidate.slice(0, -1)) && candidate.endsWith('*'),
  );
  matchingDefinitions.sort((a, b) => a.length - b.length);
  let matchingLogName = matchingDefinitions[0];
  return matchingLogName ? logDefinitions[matchingLogName] : DEFAULT_LOG_LEVEL;
}

function assertLogLevelDesc(level: any): asserts level is LogLevelDesc {
  if (!validLevels.includes(level)) {
    throw new Error(
      `${level} is not a valid log level. valid values are ${validLevels.join()}`,
    );
  }
}
