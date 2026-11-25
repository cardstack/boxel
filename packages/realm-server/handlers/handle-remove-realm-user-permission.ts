import type Koa from 'koa';
import {
  fetchRealmPermissions,
  insertPermissions,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { REALMS_LIST_UPDATED_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import {
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';
import { realmEventDispatcher } from '../realm-event-dispatcher.ts';
import { retireRealmEventRoom } from '../realm-event-rooms.ts';
import {
  impersonateAsMatrixAdmin,
  logoutMatrixAccessToken,
  removeRealmFromUserAccountData,
  resolveAdminCreds,
} from '../synapse.ts';
import { withWorkspaceListLock } from '../lib/workspace-list.ts';

const log = logger('realm-server');

function isMatrixUserId(user: string): boolean {
  return user.startsWith('@') && user.includes(':');
}

// Takes one user's `read` / `write` row off a realm. The `*` and `users` rows
// are refused: those grants are realm-wide, and deleting one changes the
// realm's visibility for everyone rather than one user's access. The realm
// owner's row is refused: a row delete can't keep the owner's `read` and
// `realm-owner`, which every permission endpoint must preserve (ADR 006
// §1.2).
//
// No session is revoked here. A per-realm session token names the permission
// set it was minted with, and the realm compares that set against the user's
// effective permissions on every request, so the first request after the row
// is gone fails as a permission mismatch and the host re-authenticates
// against the realm's current grants.
export default function handleRemoveRealmUserPermission({
  dbAdapter,
  matrixClient,
  matrixAdminUsername,
  matrixAdminPassword,
  sendEvent,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realm = ctxt.URL.searchParams.get('realm');
    if (!realm) {
      await sendResponseForBadRequest(ctxt, `realm param must be specified`);
      return;
    }
    let user = ctxt.URL.searchParams.get('user');
    if (!user) {
      await sendResponseForBadRequest(ctxt, `user param must be specified`);
      return;
    }
    if (!isMatrixUserId(user)) {
      await sendResponseForBadRequest(
        ctxt,
        `user param must be a fully-qualified matrix user id (got "${user}"); the "*" and "users" grants are realm-wide and are changed through the realm's permissions endpoint`,
      );
      return;
    }

    // realm_user_permissions is keyed by the exact `realm_url` string, and
    // the grant endpoint writes the canonical realm-root form, so the removal
    // normalises the same way to reach the row the grant wrote.
    let normalizedRealmURL = normalizeRealmURL(realm);
    if (!normalizedRealmURL) {
      await sendResponseForBadRequest(ctxt, `realm "${realm}" is not a URL`);
      return;
    }
    let normalizedRealmHref = normalizedRealmURL.href;

    let currentPermissions = await fetchRealmPermissions(
      dbAdapter,
      new URL(normalizedRealmHref),
    );
    if (currentPermissions[user]?.includes('realm-owner')) {
      await sendResponseForBadRequest(
        ctxt,
        `cannot remove permissions of the realm owner ${user}`,
      );
      return;
    }
    let hadPermissionRow = currentPermissions[user] != null;

    // An empty permission list deletes the user's row for the realm.
    await insertPermissions(dbAdapter, new URL(normalizedRealmHref), {
      [user]: [],
    });

    // The realm's event room holds exactly the users its grants name, so a
    // revoked grant retires the room before this answers: the realm's events
    // stop going to the room at once, in every process, the room is emptied
    // in the background, and the remaining grantees are told to ask for a
    // new one. Through the realm server's own matrix client, the one every
    // realm it serves sends its events with.
    if (hadPermissionRow) {
      await retireRealmEventRoom({
        realmURL: normalizedRealmHref,
        matrixClient,
        dbAdapter,
        dispatcher: realmEventDispatcher(),
      });
    }

    // A running session re-derives its realm list from `_realm-auth` on this
    // signal, so the realm leaves the workspace chooser without a reload.
    // Best-effort: a delivery failure must not fail the removal, and
    // `sendEvent` is a no-op when the user has no session room.
    try {
      await sendEvent(user, REALMS_LIST_UPDATED_EVENT_TYPE);
    } catch (e: any) {
      log.warn(
        `[grafana-remove-realm-user-permission] failed to send ${REALMS_LIST_UPDATED_EVENT_TYPE} to ${user}: ${e?.message ?? String(e)}`,
      );
    }

    // A legacy session lists its workspaces from the user's matrix
    // `app.boxel.realms` account_data, so the realm is taken out of that list
    // too. Best-effort: a matrix failure logs a warning and returns 200, the
    // DB row stays deleted, and re-running this endpoint is idempotent on
    // both sides.
    let matrixAccountDataWarning: string | undefined;
    let removedFromAccountData = false;
    {
      let creds = resolveAdminCreds(
        matrixClient.matrixURL,
        matrixAdminUsername,
        matrixAdminPassword,
      );
      if (creds.ok) {
        let userToken: string | undefined;
        try {
          userToken = await impersonateAsMatrixAdmin({
            matrixURL: matrixClient.matrixURL,
            adminUsername: creds.username,
            adminPassword: creds.password,
            userId: user,
          });
          let token = userToken;
          let { wasPresent } = await withWorkspaceListLock(
            dbAdapter,
            user,
            (signal) =>
              removeRealmFromUserAccountData({
                matrixURL: matrixClient.matrixURL,
                userId: user,
                userAccessToken: token,
                realmURL: normalizedRealmHref,
                signal,
              }),
          );
          removedFromAccountData = wasPresent;
        } catch (e: any) {
          matrixAccountDataWarning = `account_data sync failed: ${e?.message ?? String(e)}`;
          log.warn(
            `[grafana-remove-realm-user-permission] ${matrixAccountDataWarning}`,
          );
        } finally {
          // The impersonation token never expires by default, so it is logged
          // out once the sync is done rather than left behind per removal.
          // It has no device, so this deletes only the token; the admin token
          // is shared across requests and stays logged in. Best-effort: a
          // logout failure does not change the sync result reported above.
          if (userToken) {
            try {
              await logoutMatrixAccessToken({
                matrixURL: matrixClient.matrixURL,
                accessToken: userToken,
              });
            } catch (e: any) {
              log.warn(
                `[grafana-remove-realm-user-permission] token logout failed: ${
                  e?.message ?? String(e)
                }`,
              );
            }
          }
        }
      } else {
        matrixAccountDataWarning = `account_data sync skipped: ${creds.reason}`;
      }
    }

    let responseBody: Record<string, unknown> = {
      message: hadPermissionRow
        ? `Removed access to ${normalizedRealmHref} for user "${user}"`
        : `User "${user}" holds no permission on ${normalizedRealmHref}; nothing to remove`,
      removedPermission: hadPermissionRow,
      removedFromAccountData,
    };
    if (matrixAccountDataWarning) {
      responseBody.matrixAccountDataWarning = matrixAccountDataWarning;
    }

    return setContextResponse(
      ctxt,
      new Response(JSON.stringify(responseBody), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
