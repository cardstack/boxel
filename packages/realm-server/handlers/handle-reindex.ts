import Koa from 'koa';
import {
  type FromScratchResult,
  type FromScratchArgs,
  fetchUserPermissions,
  userInitiatedPriority,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { type CreateRoutesArgs } from '../routes';

export default function handleReindex({
  queue,
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realm = ctxt.URL.searchParams.get('realm');
    if (!realm) {
      await sendResponseForBadRequest(
        ctxt,
        'Request missing "realm" query param',
      );
      return;
    }

    let permissions = await fetchUserPermissions(dbAdapter, new URL(realm));
    let owners = Object.entries(permissions)
      .filter(([_, permissions]) => permissions?.includes('realm-owner'))
      .map(([userId]) => userId);
    let realmUserId =
      owners.length === 1
        ? owners[0]
        : owners.find((userId) => userId.startsWith('@realm/'));
    let realmUsername = realmUserId?.startsWith('@')
      ? getMatrixUsername(realmUserId)
      : realmUserId;
    if (!realmUsername) {
      await sendResponseForSystemError(
        ctxt,
        `Could not determine user to index as for realm ${realm}`,
      );
      return;
    }

    let args: FromScratchArgs = {
      realmURL: realm,
      realmUsername,
    };

    let job = await queue.publish<FromScratchResult>({
      jobType: `from-scratch-index`,
      concurrencyGroup: `indexing:${realm}`,
      timeout: 3 * 60,
      priority: userInitiatedPriority,
      args,
    });
    let { stats } = await job.done;

    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(stats, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
