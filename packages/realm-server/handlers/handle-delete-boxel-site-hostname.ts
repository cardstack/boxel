import Koa from 'koa';
import { asExpressions, param, query, update } from '@cardstack/runtime-common';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
} from '../middleware';
import { RealmServerTokenClaim } from '../utils/jwt';
import { CreateRoutesArgs } from '../routes';

export default function handleDeleteBoxelSiteHostnameRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      const token = ctxt.state.token as RealmServerTokenClaim;
      if (!token) {
        await sendResponseForSystemError(
          ctxt,
          'token is required to delete site hostname',
        );
        return;
      }

      const { user: matrixUserId } = token;
      const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
      if (!user) {
        await sendResponseForNotFound(ctxt, 'user is not found');
        return;
      }

      const hostname = ctxt.params.hostname as string | undefined;
      if (!hostname) {
        await sendResponseForUnprocessableEntity(ctxt, 'hostname is required');
        return;
      }

      // Check if the user owns this hostname claim
      const claims = await query(dbAdapter, [
        `SELECT id, user_id FROM claimed_domains_for_sites WHERE hostname = `,
        param(hostname),
        ` AND removed_at IS NULL`,
      ]);

      if (claims.length === 0) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'No active hostname claim found for this hostname',
        );
        return;
      }

      const claim = claims[0];

      // Verify the user owns this claim
      if (claim.user_id !== user.id) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'You do not have permission to delete this hostname claim',
        );
        return;
      }

      // Soft delete by setting removed_at
      const { valueExpressions, nameExpressions } = asExpressions({
        removed_at: Math.floor(Date.now() / 1000),
      });
      await query(dbAdapter, [
        ...update(
          'claimed_domains_for_sites',
          nameExpressions,
          valueExpressions,
        ),
        ` WHERE id = `,
        param(claim.id),
      ]);

      // Return 204 No Content
      await setContextResponse(
        ctxt,
        new Response(null, {
          status: 204,
        }),
      );
    } catch (error) {
      console.error('Error deleting site hostname:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}
