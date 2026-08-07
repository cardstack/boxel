import type Koa from 'koa';
import {
  logger,
  revokeUserSessions,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

const log = logger('realm-server');

// Retires every session token already issued to a user. Both token families are
// covered — the realm-server session and the per-realm sessions — because both
// are checked against the same recorded revocation instant.
//
// This does not end the user's access on its own. A client that still holds a
// valid matrix session re-authenticates and receives fresh tokens, by design:
// matrix is the authority on whether the person is still allowed in. To evict an
// active intruder, deactivate their matrix device in synapse first, then call
// this to retire the tokens they already minted. Called the other way round they
// simply re-mint. Against a bearer who copied a realm JWT and has no matrix
// session, this alone is a permanent cutoff.
export default function handleRevokeUserSessions({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let user = ctxt.URL.searchParams.get('user');
    if (!user) {
      await sendResponseForBadRequest(ctxt, `user param must be specified`);
      return;
    }
    if (!user.startsWith('@') || !user.includes(':')) {
      await sendResponseForBadRequest(
        ctxt,
        `user param must be a fully-qualified matrix user id (got "${user}")`,
      );
      return;
    }

    let revokedAt = await revokeUserSessions(dbAdapter, user);
    log.info(
      `[revoke-user-sessions] revoked sessions for ${user} issued before ${revokedAt}`,
    );

    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          message:
            `Revoked all sessions for user '${user}' issued before ` +
            `${new Date(revokedAt * 1000).toISOString()}. A client with a ` +
            `valid matrix session will re-authenticate; deactivate the ` +
            `matrix device first if the intent is to evict it.`,
          revokedAt,
        }),
        {
          headers: { 'content-type': SupportedMimeType.JSON },
        },
      ),
    );
  };
}
