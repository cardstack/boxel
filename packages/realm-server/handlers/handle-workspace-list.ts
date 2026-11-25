import type Koa from 'koa';
import * as Sentry from '@sentry/node';
import {
  fetchReachableRealms,
  logger,
  SupportedMimeType,
  type DBAdapter,
} from '@cardstack/runtime-common';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  requestUser,
  sendResponseForError,
  sendResponseForNotFound,
  sendResponseForUnauthorizedRequest,
  setContextResponse,
} from '../middleware/index.ts';
import {
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
// part of it the caller can still open, each marked archived or not, without
// the realms whose permission was revoked or that were deleted
// (`fetchReachableRealms`): what a caller that can't ask `_realm-auth` lists
// as the user's workspaces.
export function handleFetchWorkspaceList(
  deps: WorkspaceListDeps & { dbAdapter: DBAdapter },
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
