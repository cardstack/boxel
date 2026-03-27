import type Koa from 'koa';
import {
  findJobIdForReservationId,
  forceCancelJobById,
} from '@cardstack/runtime-common';
import { sendResponseForBadRequest, setContextResponse } from '../middleware';
import type { CreateRoutesArgs } from '../routes';

export default function handleRemoveJob({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let jobId = ctxt.URL.searchParams.get('job_id');
    let jobReservationId = ctxt.URL.searchParams.get('reservation_id');
    if (!jobId && !jobReservationId) {
      await sendResponseForBadRequest(
        ctxt,
        'Request missing "job_id" or "reservation_id" query param',
      );
      return;
    }

    if (jobReservationId) {
      jobId = await findJobIdForReservationId(dbAdapter, jobReservationId);
      if (!jobId) {
        await sendResponseForBadRequest(
          ctxt,
          `Cannot find job id for reservation id "${jobReservationId}"`,
        );
        return;
      }
      await forceCancelJobById(dbAdapter, jobId);
    } else if (jobId) {
      await forceCancelJobById(dbAdapter, jobId);
    }
    return setContextResponse(ctxt, new Response(null, { status: 204 }));
  };
}
