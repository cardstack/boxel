import type Koa from 'koa';
import {
  archiveRealm,
  cancelAllJobsInConcurrencyGroup,
  createResponse,
  logger,
  SupportedMimeType,
  type Realm,
} from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import {
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { resolveAndAuthorizeArchiveTarget } from './archive-realm-utils.ts';

const log = logger('handle-archive');

export default function handleArchiveRealm({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let target = await resolveAndAuthorizeArchiveTarget(
      ctxt,
      dbAdapter,
      'archive',
    );
    if (!target) {
      return;
    }
    let { realmURL, permissions } = target;

    try {
      await archiveRealm(dbAdapter, new URL(realmURL));
      // Stop the realm's indexer: cancel any in-flight from-scratch /
      // incremental-index job and drop the pending queue for this realm's
      // concurrency group. Mirrors the realm-level cancel-jobs endpoint
      // (Realm.handleCancelJobsRequest). `cancelAllJobsInConcurrencyGroup`
      // marks jobs rejected and emits NOTIFY jobs_finished so peer
      // replicas evict job-scoped search-cache rows. The unarchive flow
      // rebuilds boxel_index from disk via the full-reindex enqueue, so
      // any partial work left behind by an in-flight cancellation is
      // discarded on restore.
      await cancelAllJobsInConcurrencyGroup(dbAdapter, `indexing:${realmURL}`);

      let response = createResponse({
        body: JSON.stringify(
          {
            data: {
              type: 'realm',
              id: realmURL,
              attributes: { archived: true },
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
      log.error(`Error archiving realm ${realmURL}:`, error);
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
