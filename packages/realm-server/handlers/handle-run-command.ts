import type Koa from 'koa';
import * as Sentry from '@sentry/node';

import type {
  DBAdapter,
  Prerenderer,
  RealmPermissions,
  RunCommandResponse,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { prepareRunCommand } from '@cardstack/runtime-common/run-command-request';
import { userInitiatedPriority } from '@cardstack/runtime-common/queue';
import type { CreateOAuthTabAuth } from '@cardstack/runtime-common/oauth-tab-token';
import { realmPermissionCeiling } from '@cardstack/runtime-common/oauth-route-admission';

import type { BoxelApi } from '../lib/oauth-provider/boxel-api.ts';
import type { OAuthCaller } from '../lib/oauth-provider/lookup.ts';

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  sendResponseForSystemError,
  setContextResponse,
  requestUser,
} from '../middleware/index.ts';

/**
 * Handler for `POST /_run-command`.
 *
 * Drives the prerenderer directly from the web tier and answers with the
 * command's result. This is the public endpoint for executing host commands.
 *
 * A synchronous caller gets its answer without a worker being held on its
 * behalf, which matches the three sibling prerender endpoints
 * (`/_prerender-card`, `/_prerender-module`, `/_prerender-file-extract`).
 * That keeps a slow command from competing with indexing for worker capacity;
 * what keeps a card-writing command from deadlocking against indexing is the
 * deferred write path a prerender tab gets (see `DURING_PRERENDER_HEADER`).
 *
 * Request body (JSON:API):
 * ```json
 * {
 *   "data": {
 *     "type": "run-command",
 *     "attributes": {
 *       "realmURL": "https://realm.example/user/workspace/",
 *       "command": "@cardstack/boxel-host/commands/get-card-type-schema/default",
 *       "commandInput": { ... }
 *     }
 *   }
 * }
 * ```
 *
 * The `runAs` user is derived from the authenticated JWT, or from the grant
 * of the Boxel API OAuth token the request was admitted with. The command's
 * tab runs code the caller chose, so for an OAuth caller it holds tab tokens
 * (`runtime-common/oauth-tab-token.ts`), bounded by the caller's grant, and
 * never the user's sessions (ADR 021 §1.5).
 */
export default function handleRunCommand({
  dbAdapter,
  matrixClient,
  prerenderer,
  createPrerenderAuth,
  createOAuthTabAuth,
  boxelApi,
}: {
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  prerenderer?: Prerenderer;
  createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;
  createOAuthTabAuth: CreateOAuthTabAuth;
  // The Boxel API, whose scopes bound an OAuth caller's tab tokens. Unset,
  // no OAuth caller reaches this route.
  boxelApi?: BoxelApi;
}): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (!prerenderer) {
      return sendResponseForSystemError(
        ctxt,
        'Prerenderer is not configured on this realm server',
      );
    }

    let request = await fetchRequestFromContext(ctxt);
    let body: any;
    try {
      body = await request.json();
    } catch {
      return sendResponseForBadRequest(ctxt, 'Invalid JSON body');
    }

    let attrs = body?.data?.attributes;
    if (!attrs) {
      return sendResponseForBadRequest(
        ctxt,
        'Missing data.attributes in request body',
      );
    }

    let { realmURL, command, commandInput } = attrs;
    if (!realmURL || typeof realmURL !== 'string') {
      return sendResponseForBadRequest(ctxt, 'realmURL is required');
    }
    if (!command || typeof command !== 'string') {
      return sendResponseForBadRequest(ctxt, 'command is required');
    }

    // The authenticated user from JWT middleware
    let user = requestUser(ctxt);
    if (!user) {
      return sendResponseForBadRequest(
        ctxt,
        'Authenticated user not found in JWT',
      );
    }
    let userId = user;

    // An OAuth caller's tab holds tab tokens for the realms the user's own
    // sessions would have covered, held to what the grant's scopes allow.
    let oauthCaller = ctxt.state.oauthCaller as OAuthCaller | undefined;
    let createAuth = createPrerenderAuth;
    if (oauthCaller) {
      let permissionCeiling = boxelApi
        ? realmPermissionCeiling(boxelApi.resource.scopes, oauthCaller.scopes)
        : undefined;
      // The route map admits only a scope that allows writing here, so this
      // refuses only a caller the map would have refused.
      if (!permissionCeiling) {
        return sendResponseForForbiddenRequest(
          ctxt,
          'This OAuth token does not allow running commands',
        );
      }
      let { grantId, scopes } = oauthCaller;
      createAuth = (authUserId, permissions) =>
        createOAuthTabAuth({
          userId: authUserId,
          permissions,
          grantId,
          scopes,
          purpose: 'run-command',
          permissionCeiling,
        });
    }

    let result: RunCommandResponse;
    try {
      let outcome = await prepareRunCommand({
        dbAdapter,
        matrixServerName: matrixClient.serverName,
        createPrerenderAuth: createAuth,
        realmURL,
        runAs: userId,
        command,
        commandInput: commandInput ?? null,
      });
      if (outcome.ok) {
        result = await prerenderer.runCommand({
          userId: outcome.prepared.userId,
          auth: outcome.prepared.auth,
          command: outcome.prepared.command,
          commandInput: outcome.prepared.commandInput,
          priority: userInitiatedPriority,
        });
      } else {
        // A rejected invocation is the command's result, not a transport
        // failure: the caller asked a well-formed question and the answer is
        // that it can't run. Reporting it in the result payload is what lets
        // a composing command handle it — and logging it keeps a rejection
        // legible server-side, since a 201 leaves no other trace.
        console.error(
          `run-command rejected: ${outcome.error}`,
          outcome.context,
        );
        result = { status: 'error', error: outcome.error };
      }
    } catch (error) {
      // The prerenderer's own errors quote the internal manager endpoint and
      // its raw response body, so the message stays server-side. Sentry is
      // the alerting path for this: a swallowed throw never reaches Koa's
      // app-level error hook, so an outage that breaks every invocation would
      // otherwise be visible only in logs.
      console.error('Failed to run command:', error);
      Sentry.captureException(error);
      return sendResponseForSystemError(ctxt, 'Run command failed');
    }

    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          data: {
            type: 'run-command-result',
            attributes: result,
          },
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/vnd.api+json' },
        },
      ),
    );
  };
}
