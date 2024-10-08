import './setup-logger'; // This should be first
import * as Sentry from '@sentry/node';
import { setErrorReporter } from '@cardstack/runtime-common/realm';

if (process.env.REALM_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.REALM_SENTRY_DSN,
    environment: process.env.REALM_SENTRY_ENVIRONMENT || 'development',
    maxValueLength: 8192, // this prevents error messages reported in sentry from being truncated
  });

  setErrorReporter(Sentry.captureException);
}
