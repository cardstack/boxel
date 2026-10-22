import type Koa from 'koa';
import {
  fetchPublicRealmSummaries,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// The public realms on this server a signed-in user may add to the Catalogs
// section of their dashboard. Each one's display fields come from its indexed
// `realm.json`, so answering mounts none of them.
export default function handleFetchPublicRealmsRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realms = await fetchPublicRealmSummaries(dbAdapter);
    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          data: realms.map(({ url, name, iconURL, backgroundURL }) => ({
            type: 'public-realm',
            id: url,
            attributes: { name, iconURL, backgroundURL },
          })),
        }),
        { headers: { 'content-type': SupportedMimeType.JSONAPI } },
      ),
    );
  };
}
