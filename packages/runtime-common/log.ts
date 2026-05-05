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
 *
 * in host, you can dynamically set log levels; with a handle on the
 * container (easily obtained via Ember Inspector), in the Javascript console:
 *
 *  $E.lookup('service:logger-service').getLogger('realm:events').setLevel('info')
 *
 * You can also see what named loggers are known:
 *
 *  $E.lookup('service:logger-service').getLoggers()
 */

const DEFAULT_LOG_LEVEL = 'info';

// We historically documented @cardstack/logger-style `none`, while the
// underlying loglevel package uses `silent`. Accept both spellings and
// normalize to `silent` before configuring loglevel.
const canonicalLevels = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'none',
  0,
  1,
  2,
  3,
  4,
  5,
];
const validLevels = [...canonicalLevels, 'silent'];

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
      return [logName, normalizeLogLevelDesc(level)];
    }),
  );
}

export function logger(
  logName: string,
  logDefinitions: LogDefinitions = (globalThis as any)._logDefinitions,
): LogLevel.Logger {
  let log = LogLevel.getLogger(logName);
  if (logDefinitions) {
    let level = getLevelForLog(logName, logDefinitions);
    if (level) {
      log.setLevel(level);
    }
  }
  return log;
}

// Re-apply levels to loggers that were created before `_logDefinitions` was
// populated. Needed because bundlers (Vite/Rolldown) may evaluate shared
// chunks containing module-scope `logger()` calls before the entry module
// has a chance to install `_logDefinitions`.
export function reapplyLogLevels(): void {
  let logDefinitions = (globalThis as any)._logDefinitions as
    | LogDefinitions
    | undefined;
  if (!logDefinitions) {
    return;
  }
  let loggers = LogLevel.getLoggers();
  for (let name of Object.keys(loggers)) {
    let level = getLevelForLog(name, logDefinitions);
    if (level) {
      loggers[name].setLevel(level);
    }
  }
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

function normalizeLogLevelDesc(level: LogLevelDesc | 'none'): LogLevelDesc {
  return level === 'none' ? 'silent' : level;
}

function assertLogLevelDesc(
  level: any,
): asserts level is LogLevelDesc | 'none' {
  if (!validLevels.includes(level)) {
    throw new Error(
      `${level} is not a valid log level. valid values are ${canonicalLevels.join()} (silent is accepted as an alias for none)`,
    );
  }
}
