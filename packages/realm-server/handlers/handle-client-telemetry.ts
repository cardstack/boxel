import type Koa from 'koa';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import {
  CLIENT_IP_HEADER,
  counterKey,
  isRateLimitUnavailable,
  logger,
  parseIP,
  rateLimitKey,
  type DBAdapter,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForError,
  setContextResponse,
} from '../middleware/index.ts';
import {
  retrieveUserSessionClaim,
  type RealmServerTokenClaim,
} from '../utils/jwt.ts';

// Nothing caps the request body server-side, so this handler enforces its own
// small ceiling to reject abusive telemetry beacons.
const MAX_TELEMETRY_BODY_BYTES = 256 * 1024;
// Upper bound on events accepted in a single beacon batch — headroom above the
// host instrument's 400-event flush chunk, not a contract the client relies on.
const MAX_TELEMETRY_EVENTS = 500;

// The apps that beacon here. Every line names the one its batch came from as
// `client_app`, so a dashboard can tell the host's events from the secure
// origin's. A batch that names none, or one not on this list, is the host's.
const CLIENT_APPS = new Set(['host', 'secure-origin']);
const DEFAULT_CLIENT_APP = 'host';

// The events of beacons without a session are counted against the sender's
// network (an IPv4 address, or an IPv6 /64), so an anonymous caller can't
// flood the log. The secure origin's pages send at most about one event a
// second each while busy: registration polls the Matrix server every second
// while it waits for the email link, and each poll is a `server-request`.
// That is about 60 events a minute a window, so this admits about five busy
// windows behind one network, and a burst of one full batch (the realm
// server takes at most 500 events in one).
const ANONYMOUS_EVENT_LIMIT = { burst: 600, refillPerMinute: 300 };

// Each accepted event is emitted as one line on this channel. alloy scrapes
// stdout into Loki, where Grafana's `| json` parser reads each line.
const perfLog = logger('boxel:client-perf');
const log = logger('realm-server');

// Accepts batched client performance beacons and re-emits each event as a
// single structured JSON log line. The route is schema-agnostic beyond a light
// envelope check: it validates size and shape and does not interpret event
// types.
//
// A beacon with a realm-server session (the host's, or the secure window's
// own) is attributed to that session's user. One without a valid session is
// still accepted, since the secure origin's pages report what happens before
// anyone signs in, but it is attributed to nobody: the body's self-reported
// user is never believed, it is always the secure origin's, and its events
// are rate limited by the sender's network.
export default function handleClientTelemetry({
  realmSecretSeed,
  dbAdapter,
  rateLimitStore,
}: {
  realmSecretSeed: string;
  dbAdapter: DBAdapter;
  rateLimitStore: RateLimitStore;
}): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      let token = await sessionClaim(ctxt, realmSecretSeed, dbAdapter);

      // The body is read fully into memory below, so bound it by the declared
      // Content-Length before reading. A telemetry beacon is always a
      // materialized JSON string, so a well-formed client always declares a
      // length; require one (rather than buffer an unbounded or chunked body)
      // and reject an oversized declaration up front.
      let declaredLength = Number(ctxt.req.headers['content-length'] ?? '');
      if (!Number.isFinite(declaredLength) || declaredLength <= 0) {
        await sendResponseForError(
          ctxt,
          411,
          'Length Required',
          'Telemetry payload must declare a Content-Length',
        );
        return;
      }
      if (declaredLength > MAX_TELEMETRY_BODY_BYTES) {
        await sendResponseForError(
          ctxt,
          413,
          'Payload Too Large',
          `Telemetry payload exceeds maximum allowed size (${MAX_TELEMETRY_BODY_BYTES} bytes)`,
        );
        return;
      }

      let request = await fetchRequestFromContext(ctxt);
      let body = await request.text();

      // Defense in depth against a Content-Length that under-reports the actual
      // body (multi-byte UTF-8, a lying header).
      if (
        new TextEncoder().encode(body).byteLength > MAX_TELEMETRY_BODY_BYTES
      ) {
        await sendResponseForError(
          ctxt,
          413,
          'Payload Too Large',
          `Telemetry payload exceeds maximum allowed size (${MAX_TELEMETRY_BODY_BYTES} bytes)`,
        );
        return;
      }

      let json: Record<string, any>;
      try {
        json = JSON.parse(body);
      } catch (e) {
        await sendResponseForBadRequest(
          ctxt,
          'Telemetry payload is not valid JSON',
        );
        return;
      }

      let events = json?.events;
      if (!Array.isArray(events)) {
        await sendResponseForBadRequest(
          ctxt,
          'Telemetry payload must include an "events" array',
        );
        return;
      }
      if (events.length > MAX_TELEMETRY_EVENTS) {
        await sendResponseForBadRequest(
          ctxt,
          `Telemetry payload exceeds maximum allowed event count (${MAX_TELEMETRY_EVENTS})`,
        );
        return;
      }

      if (!token) {
        let address = parseIP(String(ctxt.req.headers[CLIENT_IP_HEADER] ?? ''));
        if (!address) {
          // No session and no address to count it against: nothing to admit
          // it under.
          await setContextResponse(ctxt, new Response(null, { status: 204 }));
          return;
        }
        // Charged per event, not per beacon, since an event is what becomes a
        // log line.
        let outcome = await rateLimitStore.take(
          counterKey('client-telemetry', rateLimitKey(address)),
          ANONYMOUS_EVENT_LIMIT,
          Math.max(1, events.length),
        );
        if (!outcome.admitted) {
          if (isRateLimitUnavailable(outcome)) {
            await sendResponseForError(
              ctxt,
              503,
              'Service Unavailable',
              'Telemetry rate limit unavailable',
            );
          } else {
            ctxt.set('Retry-After', String(outcome.retryAfterSeconds));
            await sendResponseForError(
              ctxt,
              429,
              'Too Many Requests',
              'Too many telemetry events',
            );
          }
          return;
        }
      }

      // The user is the session's, never the body's self-reported value,
      // which is client-supplied and untrusted. Only the secure origin
      // beacons without a session, so a beacon without one is the secure
      // origin's whatever it names, and unauthenticated input never reaches
      // the host's lines.
      let matrixUserId = token?.user ?? null;
      let clientApp = !token
        ? 'secure-origin'
        : CLIENT_APPS.has(json.client_app)
          ? json.client_app
          : DEFAULT_CLIENT_APP;
      let sessionId = json.session_id;
      let env = json.env;
      let appVersion = json.app_version;

      for (let event of events) {
        if (event == null || typeof event !== 'object') {
          continue;
        }
        // One event = one JSON line. The whole line must be the JSON object so
        // Grafana's `| json` parser reads it directly, hence no prefix/format.
        // The trusted envelope fields are spread last so a per-event field can
        // never spoof the channel discriminator or the authenticated user id.
        perfLog.info(
          JSON.stringify({
            ...event,
            channel: 'boxel:client-perf',
            client_app: clientApp,
            session_id: sessionId,
            matrix_user_id: matrixUserId,
            env,
            app_version: appVersion,
          }),
        );
      }

      await setContextResponse(ctxt, new Response(null, { status: 204 }));
    } catch (e) {
      // Telemetry ingestion must never 500-spam: log the unexpected error and
      // acknowledge so the client stops retrying.
      log.error(`Error handling client telemetry: ${(e as Error).message}`);
      await setContextResponse(ctxt, new Response(null, { status: 204 }));
    }
  };
}

// The session the beacon was sent with, or undefined when it carries none or
// one the server doesn't honour (expired, ended, forged): either way the
// beacon is anonymous.
async function sessionClaim(
  ctxt: Koa.Context,
  realmSecretSeed: string,
  dbAdapter: DBAdapter,
): Promise<RealmServerTokenClaim | undefined> {
  let authorization = ctxt.req.headers['authorization'];
  if (!authorization) {
    return undefined;
  }
  try {
    return await retrieveUserSessionClaim(
      authorization,
      realmSecretSeed,
      dbAdapter,
    );
  } catch (e) {
    if (e instanceof AuthenticationError) {
      return undefined;
    }
    throw e;
  }
}
