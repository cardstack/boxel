import type Koa from 'koa';
import { SupportedMimeType } from '@cardstack/runtime-common';
import { prefixRealmsDocument } from '@cardstack/runtime-common/prefix-realm-network';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

// Where this server serves the realm behind each registered prefix, read off
// its own VirtualNetwork: the one place the URL behind a prefix lives (ADR 002
// §1.4). A client with no network of its own builds one from this document
// (ADR 002 §1.2), and the served index HTML carries the same map to the host.
// Unauthenticated: the index HTML is public, and so is everything here.
export default function handlePrefixRealmsRequest({
  virtualNetwork,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    return setContextResponse(
      ctxt,
      new Response(JSON.stringify(prefixRealmsDocument(virtualNetwork)), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}
