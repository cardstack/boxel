import Koa from 'koa';
import { asExpressions, insert, param, query } from '@cardstack/runtime-common';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnprocessableEntity,
  setContextResponse,
} from '../middleware';
import { RealmServerTokenClaim } from '../utils/jwt';
import { CreateRoutesArgs } from '../routes';
import { validateSubdomain } from '../lib/user-subdomain-validation';
import { getEnvironmentDomain } from '../lib/environment-domain';

type ClaimBoxelSiteHostnameRequestBody = {
  source_realm_url: string;
  hostname: string;
};

type ClaimBoxelSiteHostnameResponseBody = {
  hostname: string;
  subdomain: string;
  sourceRealmURL: string;
};

export default function handleClaimBoxelSiteHostnameRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      const token = ctxt.state.token as RealmServerTokenClaim;
      if (!token) {
        await sendResponseForSystemError(
          ctxt,
          'token is required to claim site hostname',
        );
        return;
      }

      const { user: matrixUserId } = token;
      const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
      if (!user) {
        await sendResponseForNotFound(ctxt, 'user is not found');
        return;
      }

      let parsedBody: ClaimBoxelSiteHostnameRequestBody;

      if (ctxt.request?.body !== undefined) {
        let requestBody = ctxt.request.body;
        if (typeof requestBody === 'string') {
          try {
            parsedBody = JSON.parse(requestBody);
          } catch (_error) {
            await sendResponseForBadRequest(
              ctxt,
              'Request body is not valid JSON',
            );
            return;
          }
        } else {
          parsedBody = requestBody as ClaimBoxelSiteHostnameRequestBody;
        }
      } else {
        const request = await fetchRequestFromContext(ctxt);
        const rawBody = await request.text();

        try {
          parsedBody = JSON.parse(rawBody);
        } catch (_error) {
          await sendResponseForBadRequest(
            ctxt,
            'Request body is not valid JSON',
          );
          return;
        }
      }

      const { source_realm_url: sourceRealmURL, hostname } = parsedBody ?? {};

      if (typeof sourceRealmURL !== 'string' || !sourceRealmURL.trim()) {
        await sendResponseForBadRequest(
          ctxt,
          'source_realm_url is required and must be a non-empty string',
        );
        return;
      }

      if (typeof hostname !== 'string' || !hostname.trim()) {
        await sendResponseForBadRequest(
          ctxt,
          'hostname is required and must be a non-empty string',
        );
        return;
      }

      const environmentDomain = getEnvironmentDomain();
      const normalizedHostname = hostname.trim().toLowerCase();
      const suffix = `.${environmentDomain}`;

      if (normalizedHostname === environmentDomain) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'Hostname must include a subdomain',
        );
        return;
      }

      if (!normalizedHostname.endsWith(suffix)) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          `Hostname must end with ${suffix}`,
        );
        return;
      }

      const subdomain = normalizedHostname.slice(
        0,
        normalizedHostname.length - suffix.length,
      );

      if (!subdomain) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'Hostname must include a subdomain',
        );
        return;
      }

      const validation = validateSubdomain(subdomain);
      if (!validation.valid) {
        await sendResponseForUnprocessableEntity(ctxt, validation.error ?? '');
        return;
      }

      const existingClaims = await query(dbAdapter, [
        `SELECT id FROM claimed_domains_for_sites WHERE hostname = `,
        param(normalizedHostname),
        ` AND removed_at IS NULL`,
      ]);

      if (existingClaims.length > 0) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'Hostname is already claimed',
        );
        return;
      }

      const { valueExpressions, nameExpressions } = asExpressions({
        user_id: user.id,
        hostname: normalizedHostname,
        source_realm_url: sourceRealmURL,
        claimed_at: Math.floor(Date.now() / 1000),
      });

      await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const responseBody: ClaimBoxelSiteHostnameResponseBody = {
        hostname: normalizedHostname,
        subdomain,
        sourceRealmURL,
      };

      await setContextResponse(
        ctxt,
        new Response(JSON.stringify(responseBody), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (error) {
      console.error('Error claiming site hostname:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}
