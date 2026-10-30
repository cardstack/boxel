import type Koa from 'koa';
import {
  getMatrixUsername,
  isBotAccount,
  logger,
  shareARealmGrant,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForError,
  setContextResponse,
  sharedSecretAuthorization,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

const log = logger('realm-server');

// Answers the homeserver's invite module: may `inviter` invite `invitee` to
// a room? ADR 011 §1.5 lets two end users share a room only when §1.2 lets
// each see the other's Matrix id, which is when each holds a permission row
// naming them in the same realm. Only the realm server knows those rows, so
// the module asks here on every invite, and treats anything but a 200 as a
// denial.
//
// A service user (`isBotAccount` on the paired homeserver, which includes
// this server's own account) may invite anyone and be invited by anyone: a
// room may hold one end user and any number of service users. The realm server inviting a user to their
// session room, or the host inviting the AI bot into a chat, is answered
// without reading the database.
//
// The answer is read fresh from the database on each call, like every
// permission check, so a removed grant stops counting at once.
export default function handleInviteCheck({
  dbAdapter,
  matrixClient,
  matrixInviteCheckSecret,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let isServiceUser = (userId: string) =>
    isBotAccount(userId, matrixClient.serverName) ||
    getMatrixUsername(userId) === matrixClient.username;

  async function answer(ctxt: Koa.Context) {
    let inviter = ctxt.URL.searchParams.get('inviter');
    let invitee = ctxt.URL.searchParams.get('invitee');
    if (!inviter || !invitee) {
      await sendResponseForBadRequest(
        ctxt,
        `inviter and invitee params must be specified`,
      );
      return;
    }
    for (let userId of [inviter, invitee]) {
      if (!userId.startsWith('@') || !userId.includes(':')) {
        await sendResponseForBadRequest(
          ctxt,
          `inviter and invitee must be fully-qualified matrix user ids (got "${userId}")`,
        );
        return;
      }
    }

    let allowed =
      isServiceUser(inviter) ||
      isServiceUser(invitee) ||
      (await shareARealmGrant(dbAdapter, inviter, invitee));
    if (!allowed) {
      log.info(
        `[invite-check] ${inviter} may not invite ${invitee}: they share no realm grant`,
      );
    }
    return setContextResponse(
      ctxt,
      new Response(JSON.stringify({ allowed }), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  }

  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (!matrixInviteCheckSecret) {
      // Without the shared secret nothing can authenticate as the homeserver,
      // so the endpoint is off. The module reads this as a denial.
      await sendResponseForError(
        ctxt,
        503,
        'Service Unavailable',
        'Invite check endpoint is not configured',
      );
      return;
    }
    await sharedSecretAuthorization(matrixInviteCheckSecret)(ctxt, () =>
      answer(ctxt),
    );
  };
}
