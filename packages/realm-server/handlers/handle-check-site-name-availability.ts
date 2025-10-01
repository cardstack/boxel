import Koa from 'koa';
import { query, param } from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForSystemError,
  setContextResponse,
} from '../middleware';
import { CreateRoutesArgs } from '../routes';
import { validateSubdomain } from '../lib/user-subdomain-validation';

type CheckSiteNameAvailabilityResponse = {
  available: boolean;
  hostname: string;
  error?: string;
};

function getEnvironmentDomain(): string {
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv === 'production') {
    return 'boxel.site';
  } else if (nodeEnv === 'staging') {
    return 'staging.boxel.build';
  } else {
    return 'boxel.dev.localhost';
  }
}

export default function handleCheckSiteNameAvailabilityRequest({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      const subdomain = ctxt.query.subdomain as string;

      if (subdomain === undefined) {
        await sendResponseForBadRequest(
          ctxt,
          'subdomain query parameter is required',
        );
        return;
      }

      const validation = validateSubdomain(subdomain);
      const environmentDomain = getEnvironmentDomain();
      const hostname = `${subdomain}.${environmentDomain}`;

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

      const response: CheckSiteNameAvailabilityResponse = {
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
      console.error('Error checking site name availability:', error);
      await sendResponseForSystemError(ctxt, 'Internal server error');
    }
  };
}
