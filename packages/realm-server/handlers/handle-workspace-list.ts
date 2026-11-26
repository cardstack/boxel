import type Koa from 'koa';
import * as Sentry from '@sentry/node';
import {
  fetchReachableRealms,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  fetchRequestFromContext,
  requestUser,
  sendResponseForBadRequest,
  sendResponseForError,
  sendResponseForNotFound,
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware/index.ts';
import {
  editWorkspaceList,
  readDisplayName,
  readWorkspaceList,
  type WorkspaceListDeps,
} from '../lib/workspace-list.ts';

const log = logger('realm-server');

// `GET /_user-realms`: the caller's workspace list (`app.boxel.realms`), for
// a caller that holds no Matrix token of its own. Only ever the caller's: the
// user comes from the request's token, and nothing in the request names one.
//
// `realms` is the list as the account stores it. `reachableRealms` is the
// part of it the caller can still open on this realm server, each marked
// archived or not (`fetchReachableRealms`): not the realms whose permission
// was revoked, that were deleted, or that another realm server serves. It is
// what a caller that can't ask `_realm-auth`, and whose token reaches only
// this server, lists as the user's workspaces.
export function handleFetchWorkspaceList(
  deps: WorkspaceListDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    await answer(ctxt, 'workspace list', async (user) => {
      let realms = await readWorkspaceList(deps, user);
      if (realms === undefined) {
        return undefined;
      }
      let reachableRealms = await fetchReachableRealms(deps.dbAdapter, {
        userId: user,
        realmURLs: [...new Set(realms.map(ensureTrailingSlash))],
        matrixServerName: deps.matrixClient.serverName,
      });
      return {
        type: 'user-realms',
        id: user,
        attributes: { realms, reachableRealms },
      };
    });
  };
}

// How many realms one edit may name, added and removed together.
const MAX_EDIT_REALMS = 100;

// `PATCH /_user-realms`: adds realms to the caller's workspace list and
// removes realms from it, for a client that would otherwise write the list
// to Matrix itself. The realm server makes the edit holding the user's
// account-data lock, so it never overlaps an edit the server makes for a
// create, a delete or a permission change. Answers which realms the edit
// actually added and removed; 404 when this server keeps no list for the
// caller (a user of another homeserver), who then writes the list
// themselves; 503 when the list couldn't be edited.
//
// Body: `{ data: { type: 'user-realms', attributes: { add?: string[],
// remove?: string[] } } }`, each entry an http(s) URL.
export function handleEditWorkspaceList(
  deps: WorkspaceListDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let user = requestUser(ctxt);
    if (!user) {
      await sendResponseForUnauthorizedRequest(ctxt, 'a token is required');
      return;
    }
    let edit = parseEdit(await (await fetchRequestFromContext(ctxt)).text());
    if (typeof edit === 'string') {
      await sendResponseForBadRequest(ctxt, edit);
      return;
    }
    let result: { added: string[]; removed: string[] } | undefined;
    try {
      result = await editWorkspaceList(deps, user, edit);
    } catch (e: any) {
      log.error(`could not edit ${user}'s workspace list: ${e?.message ?? e}`);
      Sentry.captureException(e);
      await sendResponseForError(
        ctxt,
        503,
        'Service Unavailable',
        'Your workspace list could not be updated. Try again.',
      );
      return;
    }
    if (!result) {
      await sendResponseForNotFound(
        ctxt,
        `This server has no workspace list for ${user}`,
      );
      return;
    }
    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          data: { type: 'user-realms-edit', id: user, attributes: result },
        }),
        {
          status: 200,
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        },
      ),
    );
  };
}

// The edit a request body asks for, or why it can't be made.
function parseEdit(body: string): { add: string[]; remove: string[] } | string {
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    return 'the request body is not JSON';
  }
  if (json?.data?.type !== 'user-realms') {
    return "the request body's data must have type 'user-realms'";
  }
  let attributes = json.data.attributes ?? {};
  let add = realmList(attributes.add);
  let remove = realmList(attributes.remove);
  if (add === undefined || remove === undefined) {
    return '`add` and `remove` must each be a list of http or https URLs';
  }
  if (add.length + remove.length === 0) {
    return 'the edit names no realm to add or remove';
  }
  if (add.length + remove.length > MAX_EDIT_REALMS) {
    return `an edit may name at most ${MAX_EDIT_REALMS} realms`;
  }
  if (add.some((realm) => remove.includes(realm))) {
    return 'an edit may not add and remove the same realm';
  }
  return { add, remove };
}

function realmList(value: unknown): string[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isHttpURL)) {
    return undefined;
  }
  return [...new Set(value)];
}

function isHttpURL(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    let { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// `GET /_user-display-name`: the caller's display name, null when they have
// none.
export function handleFetchDisplayName(
  deps: WorkspaceListDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    await answer(ctxt, 'display name', async (user) => {
      let displayName = await readDisplayName(deps, user);
      return displayName === undefined
        ? undefined
        : { type: 'user-display-name', id: user, attributes: { displayName } };
    });
  };
}

// Answers with what `read` finds for the caller: 404 when this server keeps
// no account for them, and 503 when the Matrix server or the database can't
// be read, never an empty answer that a caller could take for the real one.
async function answer(
  ctxt: Koa.Context,
  what: string,
  read: (user: string) => Promise<Record<string, unknown> | undefined>,
) {
  let user = requestUser(ctxt);
  if (!user) {
    await sendResponseForUnauthorizedRequest(ctxt, 'a token is required');
    return;
  }
  let data: Record<string, unknown> | undefined;
  try {
    data = await read(user);
  } catch (e: any) {
    log.error(`could not read ${user}'s ${what}: ${e?.message ?? e}`);
    Sentry.captureException(e);
    await sendResponseForError(
      ctxt,
      503,
      'Service Unavailable',
      `Your ${what} could not be read. Try again.`,
    );
    return;
  }
  if (!data) {
    await sendResponseForNotFound(
      ctxt,
      `This server has no ${what} for ${user}`,
    );
    return;
  }
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': SupportedMimeType.JSONAPI },
    }),
  );
}
