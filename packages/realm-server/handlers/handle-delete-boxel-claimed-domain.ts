import type Koa from 'koa';
import { asExpressions, param, update } from '@cardstack/runtime-common';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  sendResponseForError,
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';

export default function handleDeleteBoxelClaimedDomainRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      const token = ctxt.state.token as RealmServerTokenClaim;
      if (!token) {
        await sendResponseForSystemError(
          ctxt,
          'token is required to delete claimed domain',
        );
        return;
      }

      const { user: matrixUserId } = token;
      const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
      if (!user) {
        await sendResponseForNotFound(ctxt, 'user is not found');
        return;
      }

      const claimedDomainId = ctxt.params.claimedDomainId as string | undefined;
      if (!claimedDomainId) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'claimedDomainId is required',
        );
        return;
      }

      // The claim is read and released in one transaction, holding the
      // claim's row, so a mount at its site name can't slip in between the
      // check and the release.
      const refusal = await dbAdapter.withTransaction(
        async (q): Promise<{ status: 409 | 422; message: string } | null> => {
          const [claim] = (await q([
            `SELECT id, user_id, hostname FROM claimed_domains_for_sites WHERE id = `,
            param(claimedDomainId),
            ` AND removed_at IS NULL FOR UPDATE`,
          ])) as { id: string; user_id: string; hostname: string }[];

          if (!claim) {
            return {
              status: 422,
              message:
                'No active hostname claim found for this claimed domain ID',
            };
          }

          if (claim.user_id !== user.id) {
            return {
              status: 422,
              message:
                'You do not have permission to delete this hostname claim',
            };
          }

          // A site name a realm is mounted at belongs to that realm until
          // the realm's administrators unmount it (ADR 033 §1.6), which also
          // frees the name. Releasing the claim here would leave the host
          // URL serving a name anyone could claim.
          const mounted = await q([
            `SELECT 1 AS found FROM realm_host_urls WHERE kind = 'site-name' AND split_part(host, ':', 1) = `,
            param(claim.hostname),
            ` LIMIT 1`,
          ]);
          if (mounted.length > 0) {
            return {
              status: 409,
              message: `A realm is mounted at ${claim.hostname}. Unmount it from the realm before you release the site name.`,
            };
          }

          // Soft delete by setting removed_at
          const { valueExpressions, nameExpressions } = asExpressions({
            removed_at: Math.floor(Date.now() / 1000),
          });
          await q([
            ...update(
              'claimed_domains_for_sites',
              nameExpressions,
              valueExpressions,
            ),
            ` WHERE id = `,
            param(claim.id),
          ]);
          return null;
        },
      );

      if (refusal?.status === 409) {
        await sendResponseForError(ctxt, 409, 'Conflict', refusal.message);
        return;
      }
      if (refusal) {
        await sendResponseForUnprocessableEntity(ctxt, refusal.message);
        return;
      }

      // Return 204 No Content
      await setContextResponse(
        ctxt,
        new Response(null, {
          status: 204,
        }),
      );
    } catch (error) {
      console.error('Error deleting claimed domain:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}
