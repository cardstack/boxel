import { AsyncLocalStorage } from 'node:async_hooks';

// Marks the async context of a request the outbound client sends, so Sentry's
// fetch instrumentation can leave it alone. Left to itself that
// instrumentation records each outgoing URL, query string included, as a
// breadcrumb when tracing is on, and adds `sentry-trace` and `baggage`
// headers to the request when it is off. A guarded request's URL can carry a
// credential, and its headers are exactly what the caller declared, so it gets
// neither.

const guardedCall = new AsyncLocalStorage<true>();

export function runAsGuardedCall<T>(fn: () => T): T {
  return guardedCall.run(true, fn);
}

export function isGuardedCall(): boolean {
  return guardedCall.getStore() === true;
}
