import type Koa from 'koa';
import { randomUUID } from 'crypto';
import {
  fetchRealmPermissions,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import type { CreateRoutesArgs } from '../routes.ts';
import { createJWT } from '../jwt.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForError,
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware/index.ts';
import {
  DELEGATED_REALM_SESSION_SIGNATURE_HEADER,
  DELEGATED_REALM_SESSION_TIMESTAMP_HEADER,
  verifyDelegatedRealmSessionRequest,
} from '@cardstack/runtime-common/user-delegated-realm-server-session';

// Token lifetime per the v1 security design (CS-11551): 30 minutes. Long
// enough to span a tool call, short enough to bound how stale a revoked
// realm permission can be when read through a delegated session.
const DELEGATED_TOKEN_TTL = '30m';

const log = logger('realm:delegate-session');

// Mints a realm session JWT scoped to a named user's read access on a single
// realm (CS-11552). Shared-secret authenticated (HMAC over the request body +
// timestamp, see @cardstack/runtime-common/user-delegated-realm-server-session).
// The minted token carries only ['read']
// and is flagged `delegated` so the realm accepts it read-only regardless of
// the user's broader permissions; it can never read anything the user
// couldn't, and can never write.
export default function handleDelegateSession({
  dbAdapter,
  matrixClient,
  realmSecretSeed,
  serverURL,
  aiBotDelegationSecret,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (!aiBotDelegationSecret) {
      // No shared secret configured: the delegation endpoint is disabled.
      await sendResponseForError(
        ctxt,
        503,
        'Service Unavailable',
        'Delegation endpoint is not configured',
      );
      return;
    }

    let request = await fetchRequestFromContext(ctxt);
    let rawBody = await request.text();

    let auth = verifyDelegatedRealmSessionRequest({
      secret: aiBotDelegationSecret,
      timestamp: ctxt.get(DELEGATED_REALM_SESSION_TIMESTAMP_HEADER),
      signature: ctxt.get(DELEGATED_REALM_SESSION_SIGNATURE_HEADER),
      rawBody,
      now: Date.now(),
    });
    if (!auth.ok) {
      log.warn(`delegation request rejected: ${auth.reason}`);
      await sendResponseForUnauthorizedRequest(ctxt, auth.reason);
      return;
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(rawBody);
    } catch {
      await sendResponseForBadRequest(ctxt, 'Request body is not valid JSON');
      return;
    }

    let onBehalfOf = json?.onBehalfOf;
    if (typeof onBehalfOf !== 'string' || onBehalfOf.length === 0) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body must include a non-empty "onBehalfOf" string',
      );
      return;
    }
    let realm = json?.realm;
    if (typeof realm !== 'string' || realm.length === 0) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body must include a non-empty "realm" string',
      );
      return;
    }

    // Normalise to the canonical realm-root form so the permission lookup hits
    // the same realm_user_permissions row a write through other endpoints
    // produced (they key by the trailing-slash href; see normalizeRealmURL).
    let normalizedRealmURL = normalizeRealmURL(realm);
    if (!normalizedRealmURL) {
      await sendResponseForBadRequest(
        ctxt,
        `"realm" is not a valid URL: ${realm}`,
      );
      return;
    }
    let normalizedRealmHref = normalizedRealmURL.href;

    // Forensic audit record (security design CS-11551): every delegation
    // request is logged with a correlation id, requester, and outcome.
    let auditId = randomUUID();

    // Mirror the realm's own authorizer (RealmPermissionChecker): the user can
    // read if an exact permission row, the public `*` grant, or the `users`
    // grant (any user with a Matrix profile) gives them read. Using the raw
    // realm_user_permissions rows alone would 403 a user who can really read
    // via a `users` grant, diverging from what the realm would accept.
    let realmPermissions = await fetchRealmPermissions(
      dbAdapter,
      normalizedRealmURL,
    );
    let permissionChecker = new RealmPermissionChecker(
      realmPermissions,
      matrixClient,
    );
    if (!(await permissionChecker.can(onBehalfOf, 'read'))) {
      log.warn(
        `[delegate-session ${auditId}] denied: user ${onBehalfOf} has no read access to ${normalizedRealmHref}`,
      );
      await sendResponseForError(
        ctxt,
        403,
        'Forbidden',
        `User ${onBehalfOf} has no read access to ${normalizedRealmHref}`,
      );
      return;
    }

    let token = createJWT(
      {
        user: onBehalfOf,
        realm: normalizedRealmHref,
        permissions: ['read'],
        sessionRoom: undefined,
        realmServerURL: serverURL,
        delegated: true,
      },
      DELEGATED_TOKEN_TTL,
      realmSecretSeed,
    );

    log.info(
      `[delegate-session ${auditId}] granted: read-only session for ${onBehalfOf} on ${normalizedRealmHref}`,
    );

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify(
          {
            token,
            realm: normalizedRealmHref,
            permissions: ['read'],
          },
          null,
          2,
        ),
        { headers: { 'content-type': SupportedMimeType.JSON } },
      ),
    );
  };
}
