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
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { isUserOfMatrixServer } from '@cardstack/runtime-common/matrix-server-name';
import {
  appendRealmToUserAccountData,
  fetchAccountData,
  fetchAccountDataAsAdmin,
  fetchDisplayName,
  MatrixHttpError,
  putAccountData,
  removeRealmFromUserAccountData,
  resolveAdminCreds,
  withImpersonatedUser,
  type MatrixAdmin,
} from '../synapse.ts';

const log = logger('realm-server:workspace-list');

// What reading a list needs. Editing one also takes the per-user lock, which
// lives in the database.
export interface WorkspaceListReadDeps {
  matrixClient: MatrixClient;
  matrixAdminUsername?: string;
  matrixAdminPassword?: string;
}

export interface WorkspaceListDeps extends WorkspaceListReadDeps {
  dbAdapter: DBAdapter;
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
// How many times one try of an edit writes the list when a writer that takes
// no lock keeps overwriting it in between.
const EDIT_ATTEMPTS = 3;

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
    let result = await asListOwner(
      deps,
      user,
      what,
      (accessToken, signal, deadline) =>
        whileEditing(deps, user, deadline, () => {
          writing = true;
          return appendRealmToUserAccountData({
            matrixURL: deps.matrixClient.matrixURL,
            userId: user,
            userAccessToken: accessToken,
            realmURL,
            signal,
          });
        }),
    );
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
    await asListOwner(deps, user, what, (accessToken, signal, deadline) =>
      whileEditing(deps, user, deadline, async () => {
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
      }),
    );
  } catch (e) {
    throw new WorkspaceListEditError(what, held, e);
  }
  return { changed: held };
}

// Adds and removes realms on the list for a caller that asks the realm server
// to make the edit (`PATCH /_user-realms`), so that it is serialized with the
// server's own edits. Answers which realms the edit actually added and
// removed, or undefined when this server keeps no list for the user. Throws
// `WorkspaceListEditError`.
export async function editWorkspaceList(
  deps: WorkspaceListDeps,
  user: string,
  { add, remove }: { add: string[]; remove: string[] },
): Promise<{ added: string[]; removed: string[] } | undefined> {
  let what = 'edit a list';
  let writing = false;
  // What the list held before any try wrote to it: a try that fails may have
  // written part of the edit already, so a later one can't tell from the
  // list what this edit changed.
  let initial: string[] | undefined;
  try {
    let result = await asListOwner(
      deps,
      user,
      what,
      (accessToken, signal, deadline) =>
        whileEditing(deps, user, deadline, async () => {
          // One read, one write of the whole edited list and one read-back,
          // however many realms the edit names. The read-back catches a
          // client that wrote the list straight to Matrix in between, which
          // the lock can't hold back, and the edit is made again on what it
          // left.
          for (let attempt = 1; ; attempt++) {
            let content = await read(deps, user, accessToken, signal);
            let before = realmsIn(content);
            initial ??= before;
            let after = [
              ...before.filter((r) => !remove.includes(r)),
              ...add.filter((r) => !before.includes(r)),
            ];
            if (
              after.length === before.length &&
              after.every((r, i) => r === before[i])
            ) {
              return true;
            }
            writing = true;
            await putAccountData(
              deps.matrixClient.matrixURL,
              user,
              accessToken,
              APP_BOXEL_REALMS_EVENT_TYPE,
              { ...content, realms: after },
              signal,
            );
            let written = realmsIn(await read(deps, user, accessToken, signal));
            if (
              add.every((r) => written.includes(r)) &&
              !remove.some((r) => written.includes(r))
            ) {
              return true;
            }
            if (attempt >= EDIT_ATTEMPTS) {
              throw new Error(
                `the edit lost to another writer of the list ${EDIT_ATTEMPTS} times`,
              );
            }
          }
        }),
    );
    if (!result || !initial) {
      return undefined;
    }
  } catch (e) {
    throw new WorkspaceListEditError(what, writing, e);
  }
  let held = initial;
  return {
    added: add.filter((r) => !held.includes(r)),
    removed: remove.filter((r) => held.includes(r)),
  };
}

// The user's list, or undefined when this server keeps none for them. A list
// that was never written is empty. The Matrix admin's own account has none
// here: Synapse won't mint the admin a token for itself, so nothing here can
// edit that list, and a read would show one that creates and deletes leave
// as it was.
export async function readWorkspaceList(
  deps: WorkspaceListReadDeps,
  user: string,
): Promise<string[] | undefined> {
  if (!keepsAccountOf(deps, user)) {
    return undefined;
  }
  let admin = matrixAdmin(deps);
  if (user === adminUserId(deps, admin)) {
    return undefined;
  }
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
  deps: WorkspaceListReadDeps,
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

// Runs `fn` as `user`, trying again as `withRetries` does. `fn` is handed
// the operation's deadline along with its signal.
async function asListOwner<T>(
  deps: WorkspaceListDeps,
  user: string,
  what: string,
  fn: (
    accessToken: string,
    signal: AbortSignal,
    deadline: number,
  ) => Promise<T>,
): Promise<T | undefined> {
  if (!keepsAccountOf(deps, user)) {
    return undefined;
  }
  let admin = matrixAdmin(deps);
  let deadline = Date.now() + DEADLINE_MS;
  return await withRetries(
    what,
    (signal) =>
      withImpersonatedUser(
        admin,
        user,
        (accessToken) => fn(accessToken, signal, deadline),
        (e: any) =>
          log.warn(
            `could not log out a workspace-list token: ${e?.message ?? e}`,
          ),
        { signal },
      ),
    deadline,
  );
}

// Runs one read-modify-write of the user's list holding their account-data
// lock, so it never overlaps another edit the realm server makes, on this
// instance or any other (see `DBAdapter.withAccountDataLock`). Only the read,
// write and read-back hold it: minting and logging out the token they use
// don't. The wait counts against the operation's deadline, and one that
// runs out fails before anything is written.
//
// What this doesn't cover: Matrix account data has no compare-and-set, and a
// client that writes the list straight to Matrix takes no lock. The app and
// boxel-cli ask the realm server to edit the list (`PATCH /_user-realms`)
// whenever it keeps one for the user, but a released boxel-cli that predates
// that endpoint, a user of another homeserver, and a client whose request to
// the realm server failed all write it themselves, and an edit of theirs
// that overlaps one of the server's can still drop the other's entry.
function whileEditing<T>(
  deps: WorkspaceListDeps,
  user: string,
  deadline: number,
  fn: () => Promise<T>,
): Promise<T> {
  return withWorkspaceListLock(deps.dbAdapter, user, fn, deadline);
}

// Runs `fn`, an edit of `user`'s account data that the realm server makes
// some other way than through this module, holding the same lock as the edits
// here, so the two never overlap. It waits for the lock until `deadline`, and
// then rejects with `AccountDataLockTimeoutError` without running `fn`. `fn`
// is handed a signal that aborts at the deadline, and must end its requests
// with it: the lock, and the pool connection it pins, are held until `fn`
// settles, and every other edit of the user's list waits on them.
export async function withWorkspaceListLock<T>(
  dbAdapter: DBAdapter,
  user: string,
  fn: (signal: AbortSignal) => Promise<T>,
  deadline = Date.now() + DEADLINE_MS,
): Promise<T> {
  let run = () => fn(AbortSignal.timeout(Math.max(0, deadline - Date.now())));
  let lock = dbAdapter.withAccountDataLock?.bind(dbAdapter);
  return lock ? await lock(user, run, { deadline }) : await run();
}

function keepsAccountOf(deps: WorkspaceListReadDeps, user: string): boolean {
  return isUserOfMatrixServer(user, deps.matrixClient.serverName);
}

// The admin's Matrix user id. Its username may be a localpart or a full id,
// as the Matrix login it signs in with accepts either.
function adminUserId(deps: WorkspaceListReadDeps, admin: MatrixAdmin): string {
  return admin.adminUsername.startsWith('@')
    ? admin.adminUsername
    : `@${admin.adminUsername}:${deps.matrixClient.serverName}`;
}

function matrixAdmin(deps: WorkspaceListReadDeps): MatrixAdmin {
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
// tries run out, all before `deadline` (by default `DEADLINE_MS` from now);
// `fn`'s requests end when the deadline does.
async function withRetries<T>(
  what: string,
  fn: (signal: AbortSignal) => Promise<T>,
  deadline = Date.now() + DEADLINE_MS,
): Promise<T> {
  let signal = AbortSignal.timeout(Math.max(0, deadline - Date.now()));
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
