import type Koa from 'koa';
import {
  createResponse,
  isRealmArchived,
  logger,
  SupportedMimeType,
  systemInitiatedPriority,
  unarchiveRealm,
  type Realm,
} from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import {
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { resolveAndAuthorizeArchiveTarget } from './archive-realm-utils.ts';

const log = logger('handle-unarchive');

export default function handleUnarchiveRealm({
  dbAdapter,
  queue,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let target = await resolveAndAuthorizeArchiveTarget(
      ctxt,
      dbAdapter,
      'unarchive',
    );
    if (!target) {
      return;
    }
    let { realmURL, permissions } = target;

    try {
      // Capture archived state before clearing it: only a realm that was
      // actually archived needs its index rebuilt. Unarchiving an already-active
      // realm is a no-op and must not kick off an expensive full reindex.
      let wasArchived = await isRealmArchived(dbAdapter, new URL(realmURL));

      await unarchiveRealm(dbAdapter, new URL(realmURL));

      if (wasArchived) {
        // A realm's index is left to rot while it is archived, so restoring it
        // requires a full reindex to rebuild boxel_index from disk. Enqueue
        // (rather than awaiting) so the response returns promptly; the indexer
        // owns how a restored realm is brought back into the index sweep.
        await queue.publish<void>({
          jobType: `full-reindex`,
          concurrencyGroup: `full-reindex-group`,
          timeout: 6 * 60,
          priority: systemInitiatedPriority,
          args: { realmUrls: [realmURL] },
        });
      }

      let response = createResponse({
        body: JSON.stringify(
          {
            data: {
              type: 'realm',
              id: realmURL,
              attributes: { archived: false },
            },
          },
          null,
          2,
        ),
        init: {
          status: 200,
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        },
        requestContext: {
          realm: { url: realmURL } as Realm,
          permissions,
        },
      });
      await setContextResponse(ctxt, response);
    } catch (error: any) {
      log.error(`Error unarchiving realm ${realmURL}:`, error);
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
