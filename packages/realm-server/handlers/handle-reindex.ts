import type Koa from 'koa';
import type { DBAdapter, DefinitionLookup } from '@cardstack/runtime-common';
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
  definitionLookup,
  reconciler,
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
    // CS-11271: route through the reconciler so a non-pinned realm that
    // hasn't been touched on this process since the last restart still
    // mounts on demand, instead of failing with a confusing
    // "does not exist on this server" 400.
    let realm: Realm | undefined;
    try {
      realm = await reconciler.lookupOrMount(realmURL);
    } catch (e: any) {
      await sendResponseForSystemError(ctxt, e.message);
      return;
    }
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
        definitionLookup,
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
  definitionLookup,
  priority = userInitiatedPriority,
}: {
  realm: Realm;
  queue: QueuePublisher;
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  priority?: number;
}) {
  await definitionLookup.clearRealmDefinitions(realm.url);
  return await enqueueReindexRealmJob(
    realm.url,
    await realm.getRealmOwnerUsername(),
    queue,
    dbAdapter,
    priority,
    {
      clearLastModified: true,
    },
  );
}
