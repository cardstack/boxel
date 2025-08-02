import Koa from 'koa';
import {
  type FromScratchResult,
  type FromScratchArgs,
  type QueuePublisher,
  type Job,
  type Expression,
  type Realm,
  query as _query,
  param,
  userInitiatedPriority,
  SupportedMimeType,
  RealmPaths,
  DBAdapter,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { type CreateRoutesArgs } from '../routes';

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
}: {
  realm: Realm;
  queue: QueuePublisher;
  dbAdapter: DBAdapter;
}) {
  let realmUsername = await realm.getRealmOwnerUsername();
  let args: FromScratchArgs = {
    realmURL: realm.url,
    realmUsername,
  };
  await query(dbAdapter, [
    `UPDATE boxel_index SET last_modified = NULL WHERE realm_url =`,
    param(realm.url),
  ]);
  let job = await queue.publish<FromScratchResult>({
    jobType: `from-scratch-index`,
    concurrencyGroup: `indexing:${realm.url}`,
    timeout: 3 * 60,
    priority: userInitiatedPriority,
    args,
  });
  return job;
}

async function query(dbAdapter: DBAdapter, expression: Expression) {
  return await _query(dbAdapter, expression);
}
