import type Koa from 'koa';
import {
  archiveRealm,
  cancelAllJobsInLaneFamily,
  createResponse,
  logger,
  SupportedMimeType,
  type Realm,
  namedRealmUsers,
  ri,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import { pauseRealmAutomations } from '@cardstack/runtime-common/automations';
import * as Sentry from '@sentry/node';
import {
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  notifyRealmsListUpdated,
  resolveAndAuthorizeArchiveTarget,
} from './archive-realm-utils.ts';

const log = logger('handle-archive');

export default function handleArchiveRealm({
  dbAdapter,
  matrixClient,
  sendEvent,
  serverURL,
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let target = await resolveAndAuthorizeArchiveTarget(
      ctxt,
      dbAdapter,
      'archive',
      matrixClient.serverName,
      serverURL,
    );
    if (!target) {
      return;
    }
    let { realmURL, permissions } = target;

    try {
      // An archived realm's automations stop with it: each is paused, and its
      // pending run canceled, until a direct writer resumes it. They pause
      // before the realm is marked archived, so a failure in between leaves
      // the realm visible with its automations stopped, never archived with
      // them running, and a retry archives it.
      await pauseRealmAutomations(
        dbAdapter,
        ri(virtualNetwork.unresolveURL(realmURL)),
      );
      await archiveRealm(dbAdapter, new URL(realmURL));
      // Stop the realm's indexer: cancel any in-flight from-scratch /
      // incremental-index job and drop the pending queue in every lane of
      // this realm's index lane family. Mirrors the realm-level cancel-jobs endpoint
      // (Realm.handleCancelJobsRequest). `cancelAllJobsInLaneFamily`
      // marks jobs rejected and emits NOTIFY jobs_finished so peer
      // replicas evict job-scoped search-cache rows. The unarchive flow
      // rebuilds boxel_index from disk via the full-reindex enqueue, so
      // any partial work left behind by an in-flight cancellation is
      // discarded on restore.
      await cancelAllJobsInLaneFamily(
        dbAdapter,
        indexingConcurrencyGroup(realmURL),
      );

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

      // Tell everyone the realm names that their realm list changed so a session
      // viewing the workspace chooser drops the realm from Your Workspaces —
      // and, if that session already has the Archived section open, moves it
      // into Archived — without a reload. Best-effort: the realm is already
      // archived, so a failed notify must not turn a successful archive into an
      // error.
      try {
        await notifyRealmsListUpdated(sendEvent, namedRealmUsers(permissions));
      } catch (error) {
        Sentry.captureException(error);
      }
    } catch (error: any) {
      log.error(`Error archiving realm ${realmURL}:`, error);
      Sentry.captureException(error);
      await sendResponseForSystemError(ctxt, error.message);
    }
  };
}
