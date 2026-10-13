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
