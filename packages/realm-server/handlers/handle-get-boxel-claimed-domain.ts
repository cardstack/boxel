import Koa from 'koa';
import { param, query, SupportedMimeType } from '@cardstack/runtime-common';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  sendResponseForBadRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { RealmServerTokenClaim } from '../utils/jwt';
import { CreateRoutesArgs } from '../routes';

export default function handleGetBoxelClaimedDomainRequest({
  dbAdapter,
  domainsForPublishedRealms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let boxelSiteDomain = domainsForPublishedRealms?.boxelSite;

  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      if (!boxelSiteDomain) {
        throw new Error('domainsForPublishedRealms.boxelSite is required');
      }

      const token = ctxt.state.token as RealmServerTokenClaim;
      if (!token) {
        await sendResponseForSystemError(
          ctxt,
          'token is required to get claimed domain',
        );
        return;
      }

      const { user: matrixUserId } = token;
      const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
      if (!user) {
        await sendResponseForNotFound(ctxt, 'user is not found');
        return;
      }

      const sourceRealmURL = ctxt.query.source_realm_url as string | undefined;

      if (!sourceRealmURL) {
        await sendResponseForBadRequest(
          ctxt,
          'source_realm_url query parameter is required',
        );
        return;
      }

      const claims = await query(dbAdapter, [
        `SELECT id, hostname, source_realm_url, claimed_at FROM claimed_domains_for_sites WHERE user_id = `,
        param(user.id),
        ` AND source_realm_url = `,
        param(sourceRealmURL),
        ` AND removed_at IS NULL`,
      ]);

      if (claims.length === 0) {
        await sendResponseForNotFound(
          ctxt,
          'No hostname claim found for this realm',
        );
        return;
      }

      const claim = claims[0];
      const hostname = String(claim.hostname);
      const suffix = `.${boxelSiteDomain}`;
      const subdomain = hostname.slice(0, hostname.length - suffix.length);

      await setContextResponse(
        ctxt,
        new Response(
          JSON.stringify(
            {
              data: {
                type: 'claimed-site-hostname',
                id: claim.id,
                attributes: {
                  hostname,
                  subdomain,
                  sourceRealmURL: String(claim.source_realm_url),
                },
              },
            },
            null,
            2,
          ),
          {
            status: 200,
            headers: {
              'content-type': SupportedMimeType.JSONAPI,
            },
          },
        ),
      );
    } catch (error) {
      console.error('Error getting claimed domain:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}
