import * as Sentry from '@sentry/node';
import { isGuardedCall } from './guarded-call-context.ts';

// Sentry's fetch instrumentation, set to skip every request the outbound
// client sends: no breadcrumb, no span and no trace headers, since a guarded
// request's URL can carry a credential. Every other fetch is instrumented as
// usual.
export function guardedFetchIntegration() {
  return Sentry.nativeNodeFetchIntegration({
    ignoreOutgoingRequests: () => isGuardedCall(),
  });
}
