import Koa from 'koa';
import {
  asExpressions,
  insert,
  param,
  query,
  SupportedMimeType,
} from '@cardstack/runtime-common';
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

interface ClaimedBoxelDomainJSON {
  data: {
    type: 'claimed-domain';
    attributes: {
      source_realm_url: string;
      hostname: string;
    };
  };
}

export default function handleClaimBoxelDomainRequest({
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
          'token is required to claim domain',
        );
        return;
      }

      const { user: matrixUserId } = token;
      const user = await getUserByMatrixUserId(dbAdapter, matrixUserId);
      if (!user) {
        await sendResponseForNotFound(ctxt, 'user is not found');
        return;
      }

      const request = await fetchRequestFromContext(ctxt);
      const rawBody = await request.text();

      let json: Record<string, any>;
      try {
        json = JSON.parse(rawBody);
      } catch (_error) {
        await sendResponseForBadRequest(
          ctxt,
          'Request body is not valid JSON-API - invalid JSON',
        );
        return;
      }

      try {
        assertIsClaimBoxelClaimedDomainJSON(json);
      } catch (e: any) {
        await sendResponseForBadRequest(
          ctxt,
          `Request body is not valid JSON-API - ${e.message}`,
        );
        return;
      }

      const { source_realm_url: sourceRealmURL, hostname } =
        json.data.attributes;

      const trimmedHostname = hostname.trim();
      const normalizedHostname = trimmedHostname.toLowerCase();

      // Reject if hostname contains uppercase letters
      if (trimmedHostname !== normalizedHostname) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'Hostname must be lowercase',
        );
        return;
      }
      const suffix = `.${boxelSiteDomain}`;

      if (normalizedHostname === boxelSiteDomain) {
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

      const result = await query(
        dbAdapter,
        insert('claimed_domains_for_sites', nameExpressions, valueExpressions),
      );

      const claimId = result[0]?.id;

      await setContextResponse(
        ctxt,
        new Response(
          JSON.stringify(
            {
              data: {
                type: 'claimed-domain',
                id: claimId,
                attributes: {
                  hostname: normalizedHostname,
                  subdomain,
                  sourceRealmURL,
                },
              },
            },
            null,
            2,
          ),
          {
            status: 201,
            headers: {
              'content-type': SupportedMimeType.JSONAPI,
            },
          },
        ),
      );
    } catch (error) {
      console.error('Error claiming domain:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}

function assertIsClaimBoxelClaimedDomainJSON(
  json: any,
): asserts json is ClaimedBoxelDomainJSON {
  if (typeof json !== 'object') {
    throw new Error(`json must be an object`);
  }
  if (!('data' in json) || typeof json.data !== 'object') {
    throw new Error(`json is missing "data" object`);
  }
  let { data } = json;
  if (!('type' in data) || data.type !== 'claimed-domain') {
    throw new Error('json.data.type must be "claimed-domain"');
  }
  if (!('attributes' in data) || typeof data.attributes !== 'object') {
    throw new Error(`json.data is missing "attributes" object`);
  }
  let { attributes } = data;
  if (
    !('source_realm_url' in attributes) ||
    typeof attributes.source_realm_url !== 'string'
  ) {
    throw new Error(
      `json.data.attributes.source_realm_url is required and must be a string`,
    );
  }
  if (!('hostname' in attributes) || typeof attributes.hostname !== 'string') {
    throw new Error(
      `json.data.attributes.hostname is required and must be a string`,
    );
  }
}
