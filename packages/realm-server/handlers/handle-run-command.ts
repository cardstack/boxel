import type Koa from 'koa';

import type {
  DBAdapter,
  Prerenderer,
  RealmPermissions,
  RunCommandResponse,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { prepareRunCommand } from '@cardstack/runtime-common/run-command-request';
import { userInitiatedPriority } from '@cardstack/runtime-common/queue';

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

/**
 * Handler for `POST /_run-command`.
 *
 * Drives the prerenderer directly from the web tier and answers with the
 * command's result. This is the public endpoint for executing host commands.
 *
 * Running the command here rather than from a queue job is what lets a
 * command write cards. The realm's JSON-API card write indexes synchronously:
 * it awaits an `incremental-index` job, which needs a worker. A command that
 * held a worker of its own for the duration of its browser-side run would
 * therefore wait on a job that cannot be claimed until the command releases
 * the worker — a deadlock the command can neither observe nor recover from,
 * since it surfaces as the enclosing job's timeout rather than as an error
 * the command's own `try`/`catch` can see. The web tier holds no worker, so
 * the write's index job is claimed while the command is still running.
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
 * The `runAs` user is derived from the authenticated JWT.
 */
export default function handleRunCommand({
  dbAdapter,
  matrixClient,
  prerenderer,
  createPrerenderAuth,
}: {
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  prerenderer?: Prerenderer;
  createPrerenderAuth: (
    userId: string,
    permissions: RealmPermissions,
  ) => string;
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
    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token?.user) {
      return sendResponseForBadRequest(
        ctxt,
        'Authenticated user not found in JWT',
      );
    }
    let userId = token.user;

    let result: RunCommandResponse;
    try {
      let outcome = await prepareRunCommand({
        dbAdapter,
        matrixURL: matrixClient.matrixURL.href,
        createPrerenderAuth,
        realmURL,
        runAs: userId,
        command,
        commandInput: commandInput ?? null,
      });
      // A rejected invocation is the command's result, not a transport
      // failure: the caller asked a well-formed question and the answer is
      // that it can't run. Reporting it in the result payload is what lets a
      // composing command handle it.
      result = outcome.ok
        ? await prerenderer.runCommand({
            userId: outcome.prepared.userId,
            auth: outcome.prepared.auth,
            command: outcome.prepared.command,
            commandInput: outcome.prepared.commandInput,
            priority: userInitiatedPriority,
          })
        : { status: 'error', error: outcome.error };
    } catch (error) {
      console.error('Failed to run command:', error);
      return sendResponseForSystemError(
        ctxt,
        `Run command failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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
