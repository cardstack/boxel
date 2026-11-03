import type Koa from 'koa';
import { z } from 'zod';
import type { DBAdapter } from '@cardstack/runtime-common';
import { fetchRequestFromContext } from '../middleware/index.ts';
import handleRequestForward from './handle-request-forward.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import {
  publishedProxyOwner,
  type PublishedProxyPolicies,
} from '../lib/published-proxy-policy.ts';

const input = z
  .object({
    realmURL: z.string().url(),
    url: z.string().url(),
    method: z.enum(['GET', 'POST']),
    requestBody: z.string().max(16384),
    headers: z.record(z.string(), z.string()).optional(),
    stream: z.literal(false).optional(),
    multipart: z.literal(false).optional(),
  })
  .strict();
export default function handlePublishedRequestForward({
  dbAdapter,
  policies,
}: {
  dbAdapter: DBAdapter;
  policies: PublishedProxyPolicies;
}) {
  return async function (ctxt: Koa.Context, next: Koa.Next) {
    let request = await fetchRequestFromContext(ctxt);
    let parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      ctxt.status = 400;
      ctxt.body = 'Invalid published resource request';
      return;
    }
    let { realmURL, ...body } = parsed.data;
    let permitted = await publishedProxyOwner(
      dbAdapter,
      realmURL,
      body.url,
      body.method,
      policies,
    );
    if (!permitted) {
      ctxt.status = 403;
      ctxt.body = 'This published site cannot use that resource';
      return;
    }
    let destination = await AllowedProxyDestinations.getInstance(
      dbAdapter,
    ).getDestinationConfig(body.url);
    if (
      !destination ||
      destination.creditStrategy.name !== 'no-credit-strategy'
    ) {
      ctxt.status = 403;
      ctxt.body = 'This resource is unavailable to published sites';
      return;
    }
    let previousToken = ctxt.state.token;
    ctxt.state.token = { user: permitted };
    try {
      await handleRequestForward({ dbAdapter, bodyOverride: body })(ctxt, next);
    } finally {
      ctxt.state.token = previousToken;
    }
  };
}
