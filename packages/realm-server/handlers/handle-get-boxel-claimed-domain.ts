import type Koa from 'koa';
import { param, query, SupportedMimeType } from '@cardstack/runtime-common';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  sendResponseForBadRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware/index.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { normalizeRealmURL } from '../utils/realm-url.ts';

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

      const rawSourceRealmURL = ctxt.query.source_realm_url as
        | string
        | undefined;

      if (!rawSourceRealmURL) {
        await sendResponseForBadRequest(
          ctxt,
          'source_realm_url query parameter is required',
        );
        return;
      }

      const parsedSourceRealmURL = normalizeRealmURL(rawSourceRealmURL);
      if (!parsedSourceRealmURL) {
        await sendResponseForBadRequest(
          ctxt,
          'source_realm_url query parameter must be a valid URL',
        );
        return;
      }
      const sourceRealmURL = parsedSourceRealmURL.href;

      // The request names the realm by its URL. The claim names it by its
      // registry id, so the URL is resolved to the id through the registry,
      // and the response carries the realm's URL as the registry has it.
      const claims = await query(dbAdapter, [
        `SELECT c.id, c.hostname, r.url AS realm_url, c.claimed_at
         FROM claimed_domains_for_sites c
         JOIN realm_registry r ON r.id = c.realm_id
         WHERE c.user_id = `,
        param(user.id),
        ` AND r.url = `,
        param(sourceRealmURL),
        ` AND c.removed_at IS NULL`,
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
                type: 'claimed-domain',
                id: claim.id,
                attributes: {
                  hostname,
                  subdomain,
                  sourceRealmURL: String(claim.realm_url),
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
