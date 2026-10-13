import * as Sentry from '@sentry/node';
import { guardedFetchIntegration } from '../../lib/outbound/sentry.ts';

// A live Sentry client for a test, sending to an in-memory transport instead
// of the network, with the realm server's fetch instrumentation installed.
// `envelopes` holds each envelope sent, serialized, so a test can assert what
// would have reached Sentry. `tracing` turns on the span path, the one where
// the fetch instrumentation records breadcrumbs; with it off, the
// instrumentation instead adds trace headers to outgoing requests.
//
// OpenTelemetry setup is skipped so nothing global outlives the test beyond
// the instrumentation itself, which does nothing once `stop` has removed the
// client.

export interface SentryCapture {
  envelopes: string[];
  // Every envelope sent once pending events are flushed, as one string.
  flushed(): Promise<string>;
  stop(): Promise<void>;
}

export function startSentryCapture({
  tracing,
}: {
  tracing: boolean;
}): SentryCapture {
  let envelopes: string[] = [];
  Sentry.init({
    dsn: 'https://public@sentry.example.invalid/1',
    defaultIntegrations: false,
    skipOpenTelemetrySetup: true,
    ...(tracing ? { tracesSampleRate: 1 } : {}),
    maxValueLength: 8192,
    integrations: [guardedFetchIntegration()],
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(JSON.stringify(envelope));
        return {};
      },
      flush: async () => true,
    }),
  });
  return {
    envelopes,
    async flushed() {
      await Sentry.flush(2000);
      return envelopes.join('\n');
    },
    async stop() {
      await Sentry.close(2000);
      Sentry.getCurrentScope().setClient(undefined);
      Sentry.getIsolationScope().setClient(undefined);
      Sentry.getGlobalScope().setClient(undefined);
      Sentry.getIsolationScope().clearBreadcrumbs();
      Sentry.getCurrentScope().clearBreadcrumbs();
    },
  };
}
