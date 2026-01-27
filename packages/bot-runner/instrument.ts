import * as Sentry from '@sentry/node';

if (process.env.BOT_RUNNER_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.BOT_RUNNER_SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
    maxValueLength: 8192, // prevents error messages reported in sentry from being truncated
  });
}
