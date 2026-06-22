import * as Sentry from '@sentry/node';

// Indirection over Sentry so tests can replace `captureException`. Under native
// ESM, `import * as Sentry` is a sealed module namespace whose bindings are
// read-only, so tests can't stub `Sentry.captureException` directly. Calling
// through this mutable object lets a test swap the method and restore it.
export const errorReporter = {
  captureException(
    ...args: Parameters<typeof Sentry.captureException>
  ): ReturnType<typeof Sentry.captureException> {
    return Sentry.captureException(...args);
  },
};
