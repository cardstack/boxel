import * as Sentry from '@sentry/node';
import { context } from '@opentelemetry/api';
import { createRequire } from 'module';
import { guardedFetchIntegration } from '../../lib/outbound/sentry.ts';
import { scrubRequestTelemetry } from '../../lib/request-telemetry.ts';

// A live Sentry client for a test, sending to an in-memory transport instead
// of the network, with the realm server's fetch instrumentation and
// `beforeSend` / `beforeSendTransaction` hook installed. `envelopes` holds
// each envelope sent, serialized, so a test can assert what would have
// reached Sentry. `tracing` turns on the span path, the one where the fetch
// instrumentation records breadcrumbs; with it off, the instrumentation
// instead adds trace headers to outgoing requests.
//
// `incomingRequests` also installs Sentry's HTTP instrumentation, which
// attaches the incoming request (body, headers, cookies, query string) to an
// event raised while the request is in flight. That needs an async context
// manager, so the request's scope survives into the handler's awaits, and the
// `http` module patched, which happens on the first `require` after `init`.
// Set `scrub: false` to see what the instrumentation records before the
// realm server's hook runs.
//
// OpenTelemetry's tracer provider and propagator are never registered, and the
// context manager is removed again by `stop`. The HTTP instrumentation stays
// patched into `http` for the life of the process, as in a deployed server,
// and does nothing once `stop` has removed the client.

export interface SentryCapture {
  envelopes: string[];
  // Every envelope sent once pending events are flushed, as one string.
  flushed(): Promise<string>;
  // The error events among them, parsed.
  flushedEvents(): Promise<SentryEvent[]>;
  stop(): Promise<void>;
}

export interface SentryEvent {
  request?: Record<string, unknown>;
  [key: string]: unknown;
}

export function startSentryCapture({
  tracing,
  incomingRequests = false,
  scrub = true,
}: {
  tracing: boolean;
  incomingRequests?: boolean;
  scrub?: boolean;
}): SentryCapture {
  let envelopes: string[] = [];
  if (incomingRequests) {
    context.setGlobalContextManager(new Sentry.SentryContextManager().enable());
  }
  Sentry.init({
    dsn: 'https://public@sentry.example.invalid/1',
    defaultIntegrations: false,
    skipOpenTelemetrySetup: true,
    ...(tracing ? { tracesSampleRate: 1 } : {}),
    maxValueLength: 8192,
    ...(scrub
      ? {
          beforeSend: (event) => scrubRequestTelemetry(event),
          beforeSendTransaction: (event) => scrubRequestTelemetry(event),
        }
      : {}),
    integrations: [
      guardedFetchIntegration(),
      ...(incomingRequests
        ? [
            Sentry.httpIntegration({ spans: false }),
            Sentry.requestDataIntegration(),
          ]
        : []),
    ],
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(JSON.stringify(envelope));
        return {};
      },
      flush: async () => true,
    }),
  });
  if (incomingRequests) {
    createRequire(import.meta.url)('http');
  }
  return {
    envelopes,
    async flushed() {
      await Sentry.flush(2000);
      return envelopes.join('\n');
    },
    async flushedEvents() {
      await Sentry.flush(2000);
      let events: SentryEvent[] = [];
      for (let envelope of envelopes) {
        let [, items] = JSON.parse(envelope) as [
          unknown,
          [{ type: string }, SentryEvent][],
        ];
        for (let [header, payload] of items) {
          if (header.type === 'event') {
            events.push(payload);
          }
        }
      }
      return events;
    },
    async stop() {
      await Sentry.close(2000);
      Sentry.getCurrentScope().setClient(undefined);
      Sentry.getIsolationScope().setClient(undefined);
      Sentry.getGlobalScope().setClient(undefined);
      Sentry.getIsolationScope().clearBreadcrumbs();
      Sentry.getCurrentScope().clearBreadcrumbs();
      if (incomingRequests) {
        context.disable();
      }
    },
  };
}
