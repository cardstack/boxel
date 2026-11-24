// A user's workspace list: the realms the app lists for them, kept in their
// Matrix account data (`app.boxel.realms`). The realm server reads and edits
// it through the Synapse admin API, as the user whose list it is and no one
// else, so a caller that holds no Matrix token (boxel-cli signed in with
// OAuth) still has the list kept in step with the workspaces it creates and
// deletes, and can read it.
//
// The admin API reaches only the users of the realm server's own homeserver
// (ADR 004 §4), so a user of any other server has no list here: reads answer
// undefined and edits change nothing. So does a user with no Matrix account.

import { setTimeout as delay } from 'timers/promises';
import { logger } from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { isUserOfMatrixServer } from '@cardstack/runtime-common/matrix-server-name';
import {
  appendRealmToUserAccountData,
  fetchAccountData,
  fetchDisplayName,
  MatrixHttpError,
  removeRealmFromUserAccountData,
  resolveAdminCreds,
  withImpersonatedUser,
  type MatrixAdmin,
} from '../synapse.ts';

const log = logger('realm-server:workspace-list');

export interface WorkspaceListDeps {
  matrixClient: MatrixClient;
  matrixAdminUsername?: string;
  matrixAdminPassword?: string;
}

// A step that may fail only for a while (the network, a 5xx, a 429) is tried
// this many times in all, waiting between tries, so one blip doesn't fail a
// workspace's create or delete.
const ATTEMPTS = 3;
const RETRY_DELAYS_MS = [250, 750];

export async function addToWorkspaceList(
  deps: WorkspaceListDeps,
  user: string,
  realmURL: string,
): Promise<{ changed: boolean }> {
  let result = await asListOwner(
    deps,
    user,
    'add a workspace to a list',
    (accessToken) =>
      appendRealmToUserAccountData({
        matrixURL: deps.matrixClient.matrixURL,
        userId: user,
        userAccessToken: accessToken,
        realmURL,
      }),
  );
  return { changed: result ? !result.alreadyPresent : false };
}

export async function removeFromWorkspaceList(
  deps: WorkspaceListDeps,
  user: string,
  realmURL: string,
): Promise<{ changed: boolean }> {
  let result = await asListOwner(
    deps,
    user,
    'remove a workspace from a list',
    (accessToken) =>
      removeRealmFromUserAccountData({
        matrixURL: deps.matrixClient.matrixURL,
        userId: user,
        userAccessToken: accessToken,
        realmURL,
      }),
  );
  return { changed: result ? result.wasPresent : false };
}

// The user's list, or undefined when this server keeps none for them. A list
// that was never written is empty.
export async function readWorkspaceList(
  deps: WorkspaceListDeps,
  user: string,
): Promise<string[] | undefined> {
  let content = await asListOwner(deps, user, 'read a list', (accessToken) =>
    fetchAccountData(
      deps.matrixClient.matrixURL,
      user,
      accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
    ),
  );
  if (!content) {
    return undefined;
  }
  let { realms } = content;
  return Array.isArray(realms)
    ? realms.filter((realm): realm is string => typeof realm === 'string')
    : [];
}

// The user's display name: null when they have none, undefined when this
// server has no account for them.
export async function readDisplayName(
  deps: WorkspaceListDeps,
  user: string,
): Promise<string | null | undefined> {
  if (!keepsAccountOf(deps, user)) {
    return undefined;
  }
  let admin = matrixAdmin(deps);
  return await withRetries('read a display name', () =>
    fetchDisplayName(admin, user),
  );
}

async function asListOwner<T>(
  deps: WorkspaceListDeps,
  user: string,
  what: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T | undefined> {
  if (!keepsAccountOf(deps, user)) {
    return undefined;
  }
  let admin = matrixAdmin(deps);
  return await withRetries(what, () =>
    withImpersonatedUser(admin, user, fn, (e: any) =>
      log.warn(`could not log out a workspace-list token: ${e?.message ?? e}`),
    ),
  );
}

function keepsAccountOf(deps: WorkspaceListDeps, user: string): boolean {
  return isUserOfMatrixServer(user, deps.matrixClient.serverName);
}

function matrixAdmin(deps: WorkspaceListDeps): MatrixAdmin {
  let creds = resolveAdminCreds(
    deps.matrixClient.matrixURL,
    deps.matrixAdminUsername,
    deps.matrixAdminPassword,
  );
  if (!creds.ok) {
    throw new Error(`workspace lists are unavailable: ${creds.reason}`);
  }
  return {
    matrixURL: deps.matrixClient.matrixURL,
    adminUsername: creds.username,
    adminPassword: creds.password,
  };
}

async function withRetries<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (attempt >= ATTEMPTS || !mayPass(e)) {
        throw e;
      }
      log.info(
        `could not ${what} (attempt ${attempt} of ${ATTEMPTS}), trying again: ${e?.message ?? e}`,
      );
      await delay(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
}

// Whether a failure may pass if tried again: the Matrix server answered 429
// or 5xx, or never answered (`fetch` rejects with a `TypeError`).
function mayPass(e: unknown): boolean {
  if (e instanceof MatrixHttpError) {
    return e.status === 429 || e.status >= 500;
  }
  return e instanceof TypeError;
}
