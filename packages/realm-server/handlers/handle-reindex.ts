import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  type FromScratchResult,
  type QueuePublisher,
  type Job,
  type Realm,
  userInitiatedPriority,
  SupportedMimeType,
  RealmPaths,
} from '@cardstack/runtime-common';
import { enqueueReindexRealmJob } from '@cardstack/runtime-common/jobs/reindex-realm';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';

export default function handleReindex({
  queue,
  serverURL,
  dbAdapter,
  realms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realmPath = ctxt.URL.searchParams.get('realm')?.replace(/\/$/, '');
    if (!realmPath) {
      await sendResponseForBadRequest(
        ctxt,
        'Request missing "realm" query param',
      );
      return;
    }
    let realmURL = new RealmPaths(new URL(serverURL)).directoryURL(
      realmPath,
    ).href;
    let realm = realms.find((r) => r.url === realmURL);
    if (!realm) {
      await sendResponseForBadRequest(
        ctxt,
        `realm ${realmURL} does not exist on this server`,
      );
      return;
    }

    let job: Job<FromScratchResult>;
    try {
      job = await reindex({
        queue,
        dbAdapter,
        realm,
      });
    } catch (e: any) {
      await sendResponseForSystemError(ctxt, e.message);
      return;
    }
    let { stats } = await job.done;
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(stats, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}

export async function reindex({
  realm,
  queue,
  dbAdapter,
  priority = userInitiatedPriority,
}: {
  realm: Realm;
  queue: QueuePublisher;
  dbAdapter: DBAdapter;
  priority?: number;
}) {
  return await enqueueReindexRealmJob(
    realm.url,
    await realm.getRealmOwnerUsername(),
    queue,
    dbAdapter,
    priority,
  );
}
