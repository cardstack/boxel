import Koa from 'koa';
import { query, SupportedMimeType } from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware';
import { CreateRoutesArgs } from '../routes';

export default function handleQueueStatusRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let [{ pending_job_count }] = (await query(dbAdapter, [
      `SELECT COUNT(*) as pending_job_count FROM jobs WHERE status='unfulfilled'`,
    ])) as {
      pending_job_count: string;
    }[];
    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          data: {
            type: 'queue-status',
            id: 'queue-status',
            attributes: {
              pending: parseInt(pending_job_count, 10),
            },
          },
        }),
        {
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        },
      ),
    );
  };
}
