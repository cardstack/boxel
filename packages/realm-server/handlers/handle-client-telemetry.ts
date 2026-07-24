import type Koa from 'koa';
import { logger } from '@cardstack/runtime-common';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

// Nothing caps the request body server-side, so this handler enforces its own
// small ceiling to reject abusive telemetry beacons.
const MAX_TELEMETRY_BODY_BYTES = 256 * 1024;
// Upper bound on events accepted in a single beacon batch — headroom above the
// host instrument's 400-event flush chunk, not a contract the client relies on.
const MAX_TELEMETRY_EVENTS = 500;

// Each accepted event is emitted as one line on this channel. alloy scrapes
// stdout into Loki, where Grafana's `| json` parser reads each line.
const perfLog = logger('boxel:client-perf');
const log = logger('realm-server');

// Accepts batched client performance beacons and re-emits each event as a
// single structured JSON log line. The route is schema-agnostic beyond a light
// envelope check: it validates size and shape and does not interpret event
// types.
export default function handleClientTelemetry(): (
  ctxt: Koa.Context,
  next: Koa.Next,
) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      // Reject on the declared size before buffering the whole request body.
      let declaredLength = Number(ctxt.req.headers['content-length'] ?? '');
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_TELEMETRY_BODY_BYTES
      ) {
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

      // Fallback byte check for requests without (or with a lying) Content-Length.
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

      // Prefer the authenticated matrix user id from the JWT (set by
      // jwtMiddleware) over the body's self-reported value, which is
      // client-supplied and untrusted.
      let token = ctxt.state.token as RealmServerTokenClaim | undefined;
      let authedUser = token?.user ?? null;
      let matrixUserId = authedUser ?? json.matrix_user_id ?? null;
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
