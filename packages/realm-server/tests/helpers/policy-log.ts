import { logger } from '@cardstack/runtime-common';

// Every warning logged on `realm:policy` while `fn` runs. The gate, the policy
// compiler and a suite share the named logger, so a tap on its method factory
// sees exactly what they write. The level is held at `warn` or louder for the
// duration, so a quieter LOG_LEVELS setting cannot hide the line a test is
// looking for.
export async function policyWarningsDuring(
  fn: () => Promise<void>,
): Promise<string[]> {
  let log = logger('realm:policy');
  let warnings: string[] = [];
  let originalFactory = log.methodFactory;
  let originalLevel = log.getLevel();
  log.methodFactory = (methodName, level, loggerName) => {
    let raw = originalFactory(methodName, level, loggerName);
    return (...args: unknown[]) => {
      if (methodName === 'warn') {
        warnings.push(args.map(String).join(' '));
      }
      raw(...args);
    };
  };
  // Rebinds the logger's methods, which is what puts the tap in place.
  log.setLevel(originalLevel > log.levels.WARN ? 'warn' : originalLevel);
  try {
    await fn();
  } finally {
    log.methodFactory = originalFactory;
    log.setLevel(originalLevel);
  }
  return warnings;
}
