import type Koa from 'koa';
import {
  type Expression,
  query as _query,
  param,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { sendResponseForBadRequest, setContextResponse } from '../middleware';
import type { CreateRoutesArgs } from '../routes';

export default function handleAddCredit({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  async function query(expression: Expression) {
    return await _query(dbAdapter, expression);
  }

  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let user = ctxt.URL.searchParams.get('user');
    if (!user) {
      await sendResponseForBadRequest(ctxt, `user param must be specified`);
      return;
    }

    let creditStr = ctxt.URL.searchParams.get('credit') ?? '0';
    let credit = parseInt(creditStr);
    if (Number.isNaN(credit)) {
      await sendResponseForBadRequest(
        ctxt,
        `Credit amount must be a number "${creditStr}"`,
      );
      return;
    }

    let result = await query([
      `INSERT INTO credits_ledger (user_id, credit_amount, credit_type)`,
      `SELECT u.id as user_id,`,
      param(credit),
      `as credit_amount, 'extra_credit' as credit_type`,
      `FROM users u`,
      `WHERE u.matrix_user_id =`,
      param(user),
      `RETURNING id`,
    ]);

    if (result.length === 0) {
      await sendResponseForBadRequest(ctxt, `user "${user}" does not exist`);
      return;
    }

    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          message: `Added ${creditStr} credits to user '${user}'`,
        }),
        {
          headers: { 'content-type': SupportedMimeType.JSON },
        },
      ),
    );
  };
}
