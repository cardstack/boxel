import './setup-logger.ts'; // This should be first
import * as Sentry from '@sentry/node';
import { setErrorReporter } from '@cardstack/runtime-common/realm';
import { scrubSecureOriginEvent } from './lib/secure-origin-telemetry.ts';

if (process.env.REALM_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.REALM_SENTRY_DSN,
    environment: process.env.REALM_SENTRY_ENVIRONMENT || 'development',
    maxValueLength: 8192, // this prevents error messages reported in sentry from being truncated
    // An event raised while a request to the secure origin is in flight
    // must not carry what was sent to it.
    beforeSend: (event) => scrubSecureOriginEvent(event),
    beforeSendTransaction: (event) => scrubSecureOriginEvent(event),
  });

  setErrorReporter(Sentry.captureException);
}
