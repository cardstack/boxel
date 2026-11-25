// A user's workspace list: the realms the app lists for them, kept in their
// Matrix account data (`app.boxel.realms`). The realm server reads and edits
// it for a caller that holds no Matrix token of its own (an app with an OAuth
// Boxel API token, such as boxel-cli), only ever the list of the user the
// request is for. It reads with the shared admin token, and edits as that
// user, with a token the Synapse admin API mints for them, since the admin
// API can't write another user's account data.
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
  fetchAccountDataAsAdmin,
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
// How long one list operation may take, all its tries together. It holds a
// create or delete request open, so a Matrix server that stops answering
// fails it rather than hanging it.
const DEADLINE_MS = 15_000;

// A list edit that failed. Matrix may have taken a write whose answer, or
// every read after it, never came back, so the list may hold the edit even so.
// `mayHaveChanged` is false only when no write can have reached it.
export class WorkspaceListEditError extends Error {
  readonly mayHaveChanged: boolean;
  constructor(what: string, mayHaveChanged: boolean, cause: unknown) {
    super(`could not ${what}: ${(cause as any)?.message ?? cause}`, { cause });
    this.name = 'WorkspaceListEditError';
    this.mayHaveChanged = mayHaveChanged;
  }
}

// Throws `WorkspaceListEditError`.
export async function addToWorkspaceList(
  deps: WorkspaceListDeps,
  user: string,
  realmURL: string,
): Promise<{ changed: boolean }> {
  let what = 'add a workspace to a list';
  let writing = false;
  try {
    let result = await asListOwner(deps, user, what, (accessToken, signal) => {
      writing = true;
      return appendRealmToUserAccountData({
        matrixURL: deps.matrixClient.matrixURL,
        userId: user,
        userAccessToken: accessToken,
        realmURL,
        signal,
      });
    });
    return { changed: result ? !result.alreadyPresent : false };
  } catch (e) {
    throw new WorkspaceListEditError(what, writing, e);
  }
}

// `changed` says whether the list held the realm when this began, even when a
// try that removed it failed after its write and a later try found it gone.
// Throws `WorkspaceListEditError`, which says the list may have changed when
// a try found the realm there.
export async function removeFromWorkspaceList(
  deps: WorkspaceListDeps,
  user: string,
  realmURL: string,
): Promise<{ changed: boolean }> {
  let what = 'remove a workspace from a list';
  let held = false;
  try {
    await asListOwner(deps, user, what, async (accessToken, signal) => {
      // A try that fails may have written the removal already, so the next
      // one can't tell from the list whether the realm was ever on it: each
      // try records first whether the realm is there.
      let content = await read(deps, user, accessToken, signal);
      if (realmsIn(content).includes(realmURL)) {
        held = true;
      }
      await removeRealmFromUserAccountData({
        matrixURL: deps.matrixClient.matrixURL,
        userId: user,
        userAccessToken: accessToken,
        realmURL,
        signal,
      });
    });
  } catch (e) {
    throw new WorkspaceListEditError(what, held, e);
  }
  return { changed: held };
}

// The user's list, or undefined when this server keeps none for them. A list
// that was never written is empty.
export async function readWorkspaceList(
  deps: WorkspaceListDeps,
  user: string,
): Promise<string[] | undefined> {
  if (!keepsAccountOf(deps, user)) {
    return undefined;
  }
  let admin = matrixAdmin(deps);
  let content = await withRetries('read a list', (signal) =>
    fetchAccountDataAsAdmin(admin, user, APP_BOXEL_REALMS_EVENT_TYPE, {
      signal,
    }),
  );
  return content ? realmsIn(content) : undefined;
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
  return await withRetries('read a display name', (signal) =>
    fetchDisplayName(admin, user, { signal }),
  );
}

function read(
  deps: WorkspaceListDeps,
  user: string,
  accessToken: string,
  signal: AbortSignal,
) {
  return fetchAccountData(
    deps.matrixClient.matrixURL,
    user,
    accessToken,
    APP_BOXEL_REALMS_EVENT_TYPE,
    signal,
  );
}

function realmsIn(content: Record<string, unknown>): string[] {
  let { realms } = content;
  return Array.isArray(realms)
    ? realms.filter((realm): realm is string => typeof realm === 'string')
    : [];
}

// Runs `fn` as `user`, trying again as `withRetries` does.
async function asListOwner<T>(
  deps: WorkspaceListDeps,
  user: string,
  what: string,
  fn: (accessToken: string, signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  if (!keepsAccountOf(deps, user)) {
    return undefined;
  }
  let admin = matrixAdmin(deps);
  return await withRetries(what, (signal) =>
    withImpersonatedUser(
      admin,
      user,
      (accessToken) => fn(accessToken, signal),
      (e: any) =>
        log.warn(
          `could not log out a workspace-list token: ${e?.message ?? e}`,
        ),
      { signal },
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

// Tries `fn` until it succeeds, it fails in a way that won't pass, or the
// tries run out, all within `DEADLINE_MS`; `fn`'s requests end when the
// deadline does.
async function withRetries<T>(
  what: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let signal = AbortSignal.timeout(DEADLINE_MS);
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(signal);
    } catch (e: any) {
      if (attempt >= ATTEMPTS || signal.aborted || !mayPass(e)) {
        throw e;
      }
      log.info(
        `could not ${what} (attempt ${attempt} of ${ATTEMPTS}), trying again: ${e?.message ?? e}`,
      );
      await delay(RETRY_DELAYS_MS[attempt - 1], undefined, { signal });
    }
  }
}

// Whether a failure may pass if tried again: the Matrix server, or its admin
// login, answered 429 or 5xx, or never answered (`fetch` rejects with a
// `TypeError`).
function mayPass(e: unknown): boolean {
  if (e instanceof MatrixHttpError) {
    return e.status === 429 || e.status >= 500;
  }
  return e instanceof TypeError;
}
