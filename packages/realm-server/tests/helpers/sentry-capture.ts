import * as Sentry from '@sentry/node';
import { context, propagation, trace } from '@opentelemetry/api';
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
// event raised while the request is in flight, and its console integration,
// which keeps each log line written during the request as a breadcrumb. That needs an async context
// manager, so the request's scope survives into the handler's awaits, and the
// `http` module patched, which happens on the first `require` after `init`.
// Set `scrub: false` to see what the instrumentation records before the
// realm server's hook runs.
//
// With `tracing` as well, each incoming request is also recorded as a
// transaction whose server span carries the request's URL, as a deployed
// server records it once tracing is on. That needs OpenTelemetry's tracer
// provider and propagator, which are registered for that case only.
//
// Everything registered with OpenTelemetry's global API is removed again by
// `stop`. The HTTP instrumentation stays patched into `http` for the life of
// the process, as in a deployed server, and does nothing once `stop` has
// removed the client and the tracer provider.

export interface SentryCapture {
  envelopes: string[];
  // Every envelope sent once pending events are flushed, as one string.
  flushed(): Promise<string>;
  // The error events among them, parsed.
  flushedEvents(): Promise<SentryEvent[]>;
  // The transactions among them, parsed.
  flushedTransactions(): Promise<SentryEvent[]>;
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
  let incomingTransactions = tracing && incomingRequests;
  // `initOpenTelemetry` registers its own context manager along with the
  // tracer provider.
  if (incomingRequests && !incomingTransactions) {
    context.setGlobalContextManager(new Sentry.SentryContextManager().enable());
  }
  let client = Sentry.init({
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
            // The span instrumentation is installed even without `tracing`:
            // `http` is patched once per process, on the first `require` after
            // the first capture that asks for incoming requests, so a later
            // capture can't add it. Until a tracer provider is registered its
            // spans are no-ops.
            Sentry.httpIntegration({ spans: true }),
            Sentry.requestDataIntegration(),
            Sentry.consoleIntegration(),
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
  async function flushedItems(type: string): Promise<SentryEvent[]> {
    await Sentry.flush(2000);
    let items: SentryEvent[] = [];
    for (let envelope of envelopes) {
      let [, envelopeItems] = JSON.parse(envelope) as [
        unknown,
        [{ type: string }, SentryEvent][],
      ];
      for (let [header, payload] of envelopeItems) {
        if (header.type === type) {
          items.push(payload);
        }
      }
    }
    return items;
  }
  if (incomingTransactions && client) {
    Sentry.initOpenTelemetry(client);
  }
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
      return await flushedItems('event');
    },
    async flushedTransactions() {
      return await flushedItems('transaction');
    },
    async stop() {
      await Sentry.close(2000);
      Sentry.getCurrentScope().setClient(undefined);
      Sentry.getIsolationScope().setClient(undefined);
      Sentry.getGlobalScope().setClient(undefined);
      Sentry.getIsolationScope().clearBreadcrumbs();
      Sentry.getCurrentScope().clearBreadcrumbs();
      if (incomingTransactions) {
        trace.disable();
        propagation.disable();
      }
      if (incomingRequests) {
        context.disable();
      }
    },
  };
}
