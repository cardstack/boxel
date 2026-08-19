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
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

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
    let serverURLObj = new URL(serverURL);
    // `realm=` may be a path relative to this server (a source realm) or
    // an absolute URL (a published realm, which lives on a different
    // domain — e.g. https://ctse.staging.boxel.dev/foo/ served by a
    // server whose own URL is https://realms-staging.stack.cards/).
    // `directoryURL` uses `new URL(local, base)`, so an absolute `local`
    // keeps its own origin and a relative one resolves under the server.
    // The resolved URL is not constrained to this server's origin: any
    // realm the server hosts — including published realms on their own
    // domains — must be reindexable. The authoritative gate is
    // `reconciler.lookupOrMount` below, which only resolves URLs present
    // as `realm_registry` rows (a parameterized `WHERE url = $1` lookup
    // that never fetches the input URL), so an off-registry `realm=`
    // value falls through to the "does not exist" 400. With that lookup
    // plus `grafanaAuthorization` gating the endpoint, accepting
    // cross-origin `realm=` values opens no SSRF surface.
    let realmURLObj: URL;
    try {
      realmURLObj = new RealmPaths(serverURLObj).directoryURL(realmPath);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `invalid "realm" value: ${e.message}`,
      );
      return;
    }
    let realmURL = realmURLObj.href;
    // Route through the reconciler so a non-pinned realm that hasn't been
    // touched on this process since the last restart still mounts on
    // demand, instead of failing with a confusing "does not exist on this
    // server" 400.
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
