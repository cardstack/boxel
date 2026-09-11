import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import {
  getMatrixUsername,
  type MatrixClient,
} from '@cardstack/runtime-common/matrix-client';
import { REALMS_LIST_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { PERSONAL_REALM_ENDPOINT } from '@cardstack/runtime-common/realm-display-defaults';
import { createRealm, type CreateRealmDeps } from './create-realm.ts';
import type { SendEvent } from './send-event.ts';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';

const log = logger('realm-server');

// Only a fully-qualified matrix user id names a realm owner and a session room.
function isMatrixUserId(user: string): boolean {
  return user.startsWith('@') && user.includes(':');
}

// Provision a personal workspace for a user who has none. Batch-created
// accounts (e.g. registered straight on Synapse via the shared secret) never
// go through the host sign-up flow that creates one, so ops runs this per
// account to complete them. Idempotent: `createRealm` rejects a pre-existing
// realm, which we treat as success.
export default function handleEnsurePersonalRealm(
  deps: CreateRealmDeps,
  {
    matrixClient,
    sendEvent,
  }: { matrixClient: MatrixClient; sendEvent: SendEvent },
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let user = ctxt.URL.searchParams.get('user');
    if (!user) {
      await sendResponseForBadRequest(ctxt, `user param must be specified`);
      return;
    }
    if (!isMatrixUserId(user)) {
      await sendResponseForBadRequest(
        ctxt,
        `user "${user}" is not a fully-qualified matrix user id`,
      );
      return;
    }

    let username = getMatrixUsername(user);
    // The personal realm URL is deterministic from the owner + endpoint (see
    // createRealm); precompute it so we can answer with it on the idempotent
    // "already exists" path too.
    let expectedURL = new URL(
      `${deps.serverURL.pathname.replace(/\/$/, '')}/${username}/${PERSONAL_REALM_ENDPOINT}/`,
      deps.serverURL,
    ).href;

    // A nicer name when the account has a display name; the localpart otherwise.
    let displayName: string | undefined;
    try {
      displayName = (await matrixClient.getProfile(user))?.displayname;
    } catch {
      // best-effort: fall back to the username below
    }
    let name = `${displayName ?? username}'s Workspace`;

    let url = expectedURL;
    let alreadyExisted = false;
    try {
      let result = await createRealm(deps, {
        ownerUserId: user,
        endpoint: PERSONAL_REALM_ENDPOINT,
        name,
      });
      url = result.url;
    } catch (e: any) {
      if (e?.status === 400 && /already exists/.test(String(e?.message))) {
        alreadyExisted = true;
      } else {
        log.error(`Failed to ensure personal realm for ${user}`, e);
        await sendResponseForSystemError(
          ctxt,
          `Failed to ensure personal realm for ${user}: ${e?.message ?? String(e)}`,
        );
        return;
      }
    }

    // Tell a running session its realm list changed so the new workspace shows
    // without a reload. Nothing to announce when it already existed. Best-effort
    // and a no-op when the user has no session room to deliver to.
    if (!alreadyExisted) {
      try {
        await sendEvent(user, REALMS_LIST_UPDATED_EVENT_TYPE);
      } catch (e: any) {
        log.warn(
          `[grafana-ensure-personal-realm] failed to send ${REALMS_LIST_UPDATED_EVENT_TYPE} to ${user}: ${e?.message ?? String(e)}`,
        );
      }
    }

    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          message: alreadyExisted
            ? `Personal realm already exists for "${user}"`
            : `Provisioned personal realm ${url} for "${user}"`,
          url,
          alreadyExisted,
        }),
        { headers: { 'content-type': SupportedMimeType.JSON } },
      ),
    );
  };
}
