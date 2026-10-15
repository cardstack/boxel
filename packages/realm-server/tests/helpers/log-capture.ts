import { inspect } from 'node:util';
import { logger } from '@cardstack/runtime-common';

export interface CapturedLogLine {
  channel: string;
  level: string;
  message: string;
}

// Every line logged on `channels` while `fn` runs, at info and louder whatever
// LOG_LEVELS says. Each argument is rendered the way a console would print
// it, error stacks and properties included, so a test can assert on what an
// operator would actually see.
export async function logLinesDuring(
  channels: string[],
  fn: () => Promise<void>,
): Promise<CapturedLogLine[]> {
  let lines: CapturedLogLine[] = [];
  let restore: (() => void)[] = [];
  for (let channel of channels) {
    let log = logger(channel);
    let originalFactory = log.methodFactory;
    let originalLevel = log.getLevel();
    log.methodFactory = (methodName, level, loggerName) => {
      let raw = originalFactory(methodName, level, loggerName);
      return (...args: unknown[]) => {
        lines.push({
          channel,
          level: methodName,
          message: args
            .map((arg) =>
              typeof arg === 'string' ? arg : inspect(arg, { depth: 10 }),
            )
            .join(' '),
        });
        raw(...args);
      };
    };
    log.setLevel('info');
    restore.push(() => {
      log.methodFactory = originalFactory;
      log.setLevel(originalLevel);
    });
  }
  try {
    await fn();
  } finally {
    for (let undo of restore) {
      undo();
    }
  }
  return lines;
}

// Runs `fn` with `channel`'s entry in the log definitions set to `level`. A
// logger fetched with `logger(channel)` takes its level from the definitions
// each time it is fetched (the request log fetches its logger once per
// request), so a level set on the logger alone does not hold for those.
export async function withLogDefinition<T>(
  channel: string,
  level: string,
  fn: () => Promise<T>,
): Promise<T> {
  let definitions = (globalThis as any)._logDefinitions as
    | Record<string, string>
    | undefined;
  if (!definitions) {
    return await fn();
  }
  let had = Object.prototype.hasOwnProperty.call(definitions, channel);
  let original = definitions[channel];
  definitions[channel] = level;
  try {
    return await fn();
  } finally {
    if (had) {
      definitions[channel] = original;
    } else {
      delete definitions[channel];
    }
    logger(channel);
  }
}
