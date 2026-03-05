import type Koa from 'koa';
import {
  fetchAllRealmsWithOwners,
  SupportedMimeType,
  systemInitiatedPriority,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware';
import type { CreateRoutesArgs } from '../routes';

export default function handleFullReindex({
  queue,
  dbAdapter,
  definitionLookup,
  realms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realmUrls = realms.map((r) => r.url);
    let realmOwners = await fetchAllRealmsWithOwners(dbAdapter);
    let ownerMap = new Map(
      realmOwners.map((realmOwner) => [
        realmOwner.realm_url,
        realmOwner.owner_username,
      ]),
    );

    for (let realmUrl of realmUrls) {
      let ownerUsername = ownerMap.get(realmUrl);
      if (!ownerUsername || ownerUsername.startsWith('realm/')) {
        continue;
      }
      await definitionLookup.clearRealmCache(realmUrl);
    }

    await queue.publish<void>({
      jobType: `full-reindex`,
      concurrencyGroup: `full-reindex-group`,
      timeout: 6 * 60,
      priority: systemInitiatedPriority,
      args: {
        realmUrls,
      },
    });
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify({ realms: realmUrls }, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSON },
      }),
    );
  };
}
