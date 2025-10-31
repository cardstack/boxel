import type Koa from 'koa';
import { query, param } from '@cardstack/runtime-common';
import {
  sendResponseForUnprocessableEntity,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import type { CreateRoutesArgs } from '../routes';
import { validateSubdomain } from '../lib/user-subdomain-validation';

type CheckBoxelDomainAvailabilityResponse = {
  available: boolean;
  hostname: string;
  error?: string;
};

export function handleCheckBoxelDomainAvailabilityRequest({
  dbAdapter,
  domainsForPublishedRealms,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let boxelSiteDomain = domainsForPublishedRealms?.boxelSite;

  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      if (!boxelSiteDomain) {
        throw new Error('domainsForPublishedRealms.boxelSite is required');
      }

      const subdomain = ctxt.query.subdomain as string;

      if (subdomain === undefined) {
        await sendResponseForUnprocessableEntity(
          ctxt,
          'subdomain query parameter is required',
        );
        return;
      }

      const validation = validateSubdomain(subdomain);
      const hostname = `${subdomain}.${boxelSiteDomain}`;

      let available = false;
      let error: string | undefined;

      if (!validation.valid) {
        error = validation.error;
      } else {
        const results = await query(dbAdapter, [
          `SELECT id FROM claimed_domains_for_sites WHERE hostname = `,
          param(hostname),
          ` AND removed_at IS NULL`,
        ]);
        available = results.length === 0;
      }

      const response: CheckBoxelDomainAvailabilityResponse = {
        available,
        hostname,
        error,
      };

      await setContextResponse(
        ctxt,
        new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (error) {
      console.error('Error checking boxel domain availability:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}
