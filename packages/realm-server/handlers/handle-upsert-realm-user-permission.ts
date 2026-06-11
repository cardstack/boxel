import type Koa from 'koa';
import {
  ensureTrailingSlash,
  insertPermissions,
  logger,
  type RealmAction,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  adminImpersonateUser,
  appendRealmToUserAccountData,
  loginAsMatrixAdmin,
  logoutMatrixAccessToken,
} from '../synapse.ts';

const log = logger('realm-server');

function parseBoolFlag(
  raw: string | null,
  name: string,
): { ok: true; value: boolean } | { ok: false; error: string } {
  if (raw === 'true') {
    return { ok: true, value: true };
  }
  if (raw === 'false') {
    return { ok: true, value: false };
  }
  if (raw == null) {
    return { ok: false, error: `${name} param must be specified` };
  }
  return {
    ok: false,
    error: `${name} param must be "true" or "false" (got "${raw}")`,
  };
}

// Only fully-qualified matrix user-ids can carry account_data. Wildcards
// (the public-read sentinel `*`) and bare localparts have no synapse
// account to write to, so we skip the matrix sync rather than 400 — the
// DB grant still stands.
function isMatrixUserId(user: string): boolean {
  return user.startsWith('@') && user.includes(':');
}

// Resolve admin credentials for the synapse admin-impersonate flow. When
// explicit env-derived values are present (any environment), use them.
// When both are absent AND the matrix homeserver is on a `.localhost`
// hostname (covers bare `localhost` and env-mode Traefik names like
// `matrix.<slug>.localhost`), fall back to the dev `admin`/`password`
// pair that register-matrix-users.ts seeds — keeps local dev and tests
// friction-free without baking the default into every other deployment.
function resolveAdminCreds(
  matrixURL: URL,
  username: string | undefined,
  password: string | undefined,
):
  | { ok: true; username: string; password: string }
  | { ok: false; reason: string } {
  if (username && password) {
    return { ok: true, username, password };
  }
  if (username || password) {
    return {
      ok: false,
      reason: `MATRIX_ADMIN_USERNAME and MATRIX_ADMIN_PASSWORD must be set together (got only ${username ? 'USERNAME' : 'PASSWORD'})`,
    };
  }
  let h = matrixURL.hostname;
  if (h === 'localhost' || h.endsWith('.localhost')) {
    return { ok: true, username: 'admin', password: 'password' };
  }
  return {
    ok: false,
    reason:
      'MATRIX_ADMIN_USERNAME / MATRIX_ADMIN_PASSWORD unset and MATRIX_URL is not a local homeserver',
  };
}

export default function handleUpsertRealmUserPermission({
  dbAdapter,
  matrixClient,
  matrixAdminUsername,
  matrixAdminPassword,
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

    let realmURL: URL;
    try {
      realmURL = new URL(realm);
    } catch {
      await sendResponseForBadRequest(ctxt, `realm "${realm}" is not a URL`);
      return;
    }
    // realm_user_permissions is keyed by exact `realm_url` string. Normalise
    // to the canonical realm-root form (no querystring or fragment, single
    // trailing slash) so a caller passing `https://h/r` and another passing
    // `https://h/r/?token=...` write to the same row instead of a stray
    // permission whose URL the realm runtime never consults.
    realmURL.search = '';
    realmURL.hash = '';
    let normalizedRealmHref = ensureTrailingSlash(realmURL.href);

    let readResult = parseBoolFlag(ctxt.URL.searchParams.get('read'), 'read');
    if (!readResult.ok) {
      await sendResponseForBadRequest(ctxt, readResult.error);
      return;
    }
    let writeResult = parseBoolFlag(
      ctxt.URL.searchParams.get('write'),
      'write',
    );
    if (!writeResult.ok) {
      await sendResponseForBadRequest(ctxt, writeResult.error);
      return;
    }
    let read = readResult.value;
    let write = writeResult.value;
    if (!read && !write) {
      await sendResponseForBadRequest(
        ctxt,
        `at least one of read or write must be true (use the realm-permissions delete flow to revoke)`,
      );
      return;
    }
    if (write && !read) {
      await sendResponseForBadRequest(
        ctxt,
        `write permission requires read permission`,
      );
      return;
    }

    let actions: RealmAction[] = [];
    if (read) {
      actions.push('read');
    }
    if (write) {
      actions.push('write');
    }
    await insertPermissions(dbAdapter, new URL(normalizedRealmHref), {
      [user]: actions,
    });

    // The granted user only learns about the realm on their next host
    // load if it's present in their matrix `app.boxel.realms`
    // account_data — that's what the host reads to render the workspace
    // list. Push the realm in here so the grant becomes visible without
    // the user manually adding it. Best-effort: a matrix failure logs a
    // warning and returns 200 so the DB grant doesn't roll back, and
    // re-running this endpoint is idempotent on both sides.
    let matrixAccountDataWarning: string | undefined;
    let appendedToAccountData = false;
    if (isMatrixUserId(user)) {
      let creds = resolveAdminCreds(
        matrixClient.matrixURL,
        matrixAdminUsername,
        matrixAdminPassword,
      );
      if (creds.ok) {
        let adminToken: string | undefined;
        let userToken: string | undefined;
        try {
          adminToken = await loginAsMatrixAdmin({
            matrixURL: matrixClient.matrixURL,
            adminUsername: creds.username,
            adminPassword: creds.password,
          });
          userToken = await adminImpersonateUser({
            matrixURL: matrixClient.matrixURL,
            adminAccessToken: adminToken,
            userId: user,
          });
          let { alreadyPresent } = await appendRealmToUserAccountData({
            matrixURL: matrixClient.matrixURL,
            userId: user,
            userAccessToken: userToken,
            realmURL: normalizedRealmHref,
          });
          appendedToAccountData = !alreadyPresent;
        } catch (e: any) {
          matrixAccountDataWarning = `account_data sync failed: ${e?.message ?? String(e)}`;
          log.warn(
            `[grafana-upsert-realm-user-permission] ${matrixAccountDataWarning}`,
          );
        } finally {
          // Synapse admin login + admin-impersonate both mint
          // non-expiring tokens by default. Invalidate them after the
          // sync so each grafana grant doesn't leave a long-lived
          // credential behind in synapse's access_tokens table.
          // Best-effort: a logout failure does not change the sync
          // result reported above.
          let cleanups: Promise<unknown>[] = [];
          if (userToken) {
            cleanups.push(
              logoutMatrixAccessToken({
                matrixURL: matrixClient.matrixURL,
                accessToken: userToken,
              }),
            );
          }
          if (adminToken) {
            cleanups.push(
              logoutMatrixAccessToken({
                matrixURL: matrixClient.matrixURL,
                accessToken: adminToken,
              }),
            );
          }
          let results = await Promise.allSettled(cleanups);
          for (let r of results) {
            if (r.status === 'rejected') {
              log.warn(
                `[grafana-upsert-realm-user-permission] token logout failed: ${
                  (r.reason as any)?.message ?? String(r.reason)
                }`,
              );
            }
          }
        }
      } else {
        matrixAccountDataWarning = `account_data sync skipped: ${creds.reason}`;
      }
    } else {
      matrixAccountDataWarning = `account_data sync skipped: "${user}" is not a fully-qualified matrix user-id`;
    }

    let responseBody: Record<string, unknown> = {
      message: `Set ${actions.join('+')} on ${normalizedRealmHref} for user "${user}"`,
      appendedToAccountData,
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
