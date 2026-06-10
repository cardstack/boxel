import type Koa from 'koa';
import {
  SupportedMimeType,
  systemInitiatedPriority,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';
import { getFullReindexRealmUrls } from '../lib/full-reindex-realm-urls.ts';
import type { CreateRoutesArgs } from '../routes.ts';

export default function handleFullReindex({
  dbAdapter,
  queue,
  definitionLookup,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realmUrls = await getFullReindexRealmUrls(dbAdapter);

    await definitionLookup.clearAllDefinitions();

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
