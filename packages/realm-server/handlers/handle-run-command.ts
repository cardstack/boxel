import type Koa from 'koa';

import { enqueueRunCommandJob } from '@cardstack/runtime-common/jobs/run-command';
import { userInitiatedPriority } from '@cardstack/runtime-common/queue';

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';
import type { RealmServerTokenClaim } from '../utils/jwt';

/**
 * Handler for `POST /_run-command`.
 *
 * Enqueues a run-command job via the queue system, waits for the result,
 * and returns it. This is the public endpoint for executing host commands
 * through the prerenderer.
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
  queue,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
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

    try {
      let job = await enqueueRunCommandJob(
        {
          realmURL,
          realmUsername: userId,
          runAs: userId,
          command,
          commandInput: commandInput ?? null,
        },
        queue,
        dbAdapter,
        userInitiatedPriority,
      );

      let result = await job.done;

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
    } catch (error) {
      console.error('Failed to execute run-command job:', error);
      return sendResponseForSystemError(ctxt, 'Run command failed');
    }
  };
}
