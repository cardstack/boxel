/* eslint-env browser */
// How long each request a page makes takes, and how it ends, for the secure
// origin's telemetry. `session.js` and `matrix.js` make every request through
// `timedFetch`. Until the shell starts its telemetry (`observeRequests`),
// nothing watches and a request goes out exactly as given; the credential
// fields load `session.js` too and never start it.
//
// The observer is told the request's URL, method, status, duration and
// response size, and the correlation id it was sent with. Never its headers or
// body, nor the response's: the telemetry reduces the URL to a fixed label
// before it records anything.

// The realm server writes this id on its `realm:requests` log line, so a
// request's telemetry joins to the server's record of it. Only the realm
// server is sent one: the Matrix server's CORS doesn't allow the header, so a
// browser would refuse to send the request at all.
export const CORRELATION_ID_HEADER = 'X-Boxel-Logging-Correlation-Id';

let observer;

// Calls `observe` with each request's outcome. Answers a function that stops.
export function observeRequests(observe) {
  observer = observe;
  return () => {
    if (observer === observe) {
      observer = undefined;
    }
  };
}

// `fetch`, timed. `server` is 'realm-server' or 'matrix'. A request that
// never reaches the server is reported with status 0, and rethrown.
export async function timedFetch(url, init, server) {
  let observe = observer;
  if (!observe) {
    return await fetch(url, init);
  }
  let correlationId = null;
  if (server === 'realm-server') {
    correlationId = crypto.randomUUID();
    init = {
      ...init,
      headers: { ...init.headers, [CORRELATION_ID_HEADER]: correlationId },
    };
  }
  let method = init.method ?? 'GET';
  let start = performance.now();
  let report = (status, respBytes) => {
    try {
      observe({
        url: String(url),
        method,
        status,
        durationMs: performance.now() - start,
        respBytes,
        correlationId,
      });
    } catch {
      // Telemetry never fails the request it watches.
    }
  };
  let response;
  try {
    response = await fetch(url, init);
  } catch (e) {
    report(0, 0);
    throw e;
  }
  let length = Number(response.headers.get('content-length'));
  report(response.status, Number.isFinite(length) ? length : 0);
  return response;
}
