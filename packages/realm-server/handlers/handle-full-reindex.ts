import Koa from 'koa';
import { SupportedMimeType } from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware';
import { type CreateRoutesArgs } from '../routes';
import { reindex } from './handle-reindex';

export default function handleFullReindex({
  queue,
  dbAdapter,
  realms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    for (let realm of realms) {
      await reindex({ realm, queue, dbAdapter });
    }
    await setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({ realms: realms.map((r) => r.url) }, null, 2),
        {
          headers: { 'content-type': SupportedMimeType.JSON },
        },
      ),
    );
  };
}
