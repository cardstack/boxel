import type Koa from 'koa';
import {
  type Expression,
  query as _query,
  param,
  separatedByCommas,
} from '@cardstack/runtime-common';
import { sendResponseForBadRequest, setContextResponse } from '../middleware';
import type { CreateRoutesArgs } from '../routes';

export default function handleReindex({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  async function query(expression: Expression) {
    return await _query(dbAdapter, expression);
  }

  async function forceJobCompletion(jobId: string, jobReservationId?: string) {
    async function query(expression: Expression) {
      return await _query(dbAdapter, expression);
    }

    await query([
      `UPDATE jobs SET `,
      ...separatedByCommas([
        [
          `result =`,
          param({
            status: 418,
            message: `User initiated job cancellation`,
          }),
        ],
        [`status = 'rejected'`],
        [`finished_at = NOW()`],
      ]),
      'WHERE id =',
      param(jobId),
    ] as Expression);
    if (jobReservationId) {
      await query([
        `UPDATE job_reservations SET completed_at = NOW() WHERE id =`,
        param(jobReservationId),
      ]);
    }
    await query([`NOTIFY jobs_finished`]);
  }

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
      let [{ job_id: jobId }] = (await query([
        `SELECT job_id FROM job_reservations WHERE id =`,
        param(jobReservationId),
      ])) as [{ job_id: string }];
      if (!jobId) {
        await sendResponseForBadRequest(
          ctxt,
          `Cannot find job id for reservation id "${jobReservationId}"`,
        );
        return;
      }
      await forceJobCompletion(jobId, jobReservationId);
    } else if (jobId) {
      let results = (await query([
        'SELECT id FROM job_reservations WHERE job_id =',
        param(jobId),
        'AND completed_at IS NULL',
      ])) as { id: string }[];
      let reservationId: string | undefined;
      if (results.length > 0) {
        reservationId = results[0].id;
      }
      await forceJobCompletion(jobId, reservationId);
    }
    return setContextResponse(ctxt, new Response(null, { status: 204 }));
  };
}
