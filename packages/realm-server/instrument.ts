import './setup-logger.ts'; // This should be first
import * as Sentry from '@sentry/node';
import { setErrorReporter } from '@cardstack/runtime-common/realm';
import { scrubRequestTelemetry } from './lib/request-telemetry.ts';
import { guardedFetchIntegration } from './lib/outbound/sentry.ts';

if (process.env.REALM_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.REALM_SENTRY_DSN,
    environment: process.env.REALM_SENTRY_ENVIRONMENT || 'development',
    maxValueLength: 8192, // this prevents error messages reported in sentry from being truncated
    // An event carries only as much of the incoming request as is safe to
    // store: see `lib/request-telemetry.ts`.
    beforeSend: (event) => scrubRequestTelemetry(event),
    beforeSendTransaction: (event) => scrubRequestTelemetry(event),
    integrations: [guardedFetchIntegration()],
  });

  setErrorReporter(Sentry.captureException);
}
