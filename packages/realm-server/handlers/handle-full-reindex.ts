import type Koa from 'koa';
import {
  SupportedMimeType,
  systemInitiatedPriority,
  normalizeFullReindexBatchSize,
  normalizeFullReindexCooldownSeconds,
} from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware';
import type { CreateRoutesArgs } from '../routes';

export default function handleFullReindex({
  queue,
  realms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let batchSize = normalizeFullReindexBatchSize();
    let cooldownSeconds = normalizeFullReindexCooldownSeconds();
    await queue.publish<void>({
      jobType: `full-reindex`,
      concurrencyGroup: `full-reindex-group`,
      timeout: 6 * 60,
      priority: systemInitiatedPriority,
      args: {
        realmUrls: realms.map((r) => r.url),
        batchSize,
        cooldownSeconds,
      },
    });
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
