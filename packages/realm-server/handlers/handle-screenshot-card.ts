import type Koa from 'koa';

import { enqueueScreenshotCardJob } from '@cardstack/runtime-common/jobs/screenshot-card';
import { userInitiatedPriority } from '@cardstack/runtime-common/queue';

import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';

/**
 * Handler for `POST /_screenshot-card`.
 *
 * Enqueues a screenshot-card job via the queue system, waits for the result,
 * and returns it. The job runs in a worker which calls
 * `prerenderer.prerenderScreenshot(...)` after fetching the caller's
 * realm permissions.
 *
 * Request body (JSON:API):
 * ```json
 * {
 *   "data": {
 *     "type": "screenshot-card",
 *     "attributes": {
 *       "realmURL": "https://realm.example/user/workspace/",
 *       "cardId": "https://realm.example/user/workspace/Person/fadhlan",
 *       "format": "isolated"
 *     }
 *   }
 * }
 * ```
 *
 * The `runAs` user is derived from the authenticated JWT.
 */
export default function handleScreenshotCard({
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

    let { realmURL, cardId, format } = attrs;
    if (!realmURL || typeof realmURL !== 'string') {
      return sendResponseForBadRequest(ctxt, 'realmURL is required');
    }
    if (!cardId || typeof cardId !== 'string') {
      return sendResponseForBadRequest(ctxt, 'cardId is required');
    }
    if (format !== 'isolated' && format !== 'embedded') {
      return sendResponseForBadRequest(
        ctxt,
        'format must be "isolated" or "embedded"',
      );
    }

    let token = ctxt.state.token as RealmServerTokenClaim;
    if (!token?.user) {
      return sendResponseForBadRequest(
        ctxt,
        'Authenticated user not found in JWT',
      );
    }
    let userId = token.user;

    try {
      let job = await enqueueScreenshotCardJob(
        {
          realmURL,
          realmUsername: userId,
          runAs: userId,
          cardId,
          format,
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
              type: 'screenshot-card-result',
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
      console.error('Failed to execute screenshot-card job:', error);
      return sendResponseForSystemError(ctxt, 'Screenshot job failed');
    }
  };
}
