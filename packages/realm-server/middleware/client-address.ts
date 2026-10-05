import type Koa from 'koa';
import {
  CLIENT_CLASS_HEADER,
  CLIENT_IP_HEADER,
  INFRA_CLIENT_CLASS,
  formatIP,
  parseAddressRanges,
  parseIP,
  rangesContain,
  type AddressRange,
} from '@cardstack/runtime-common';

// Works out the address of the caller behind each request, and whether that
// caller is the platform's own infrastructure, and hands both to the realm as
// headers. A realm limits and blocks the callers its policy admits without a
// session by this address, so it must be the caller's and nobody else's:
// neither something the caller wrote, nor the address of a proxy of ours that
// every caller shares.
//
// Deployed, a request reaches this process through exactly one proxy, the
// load balancer. It appends the address that connected to it to
// `X-Forwarded-For`, and the task admits connections from nothing else. So the
// last entry is the caller's, written by the load balancer, and every entry
// before it is whatever the caller sent. `trustedProxyHops` is how many
// entries from the end were written by proxies of ours: one behind the load
// balancer, and zero where nothing sits in front of this process, in which
// case the socket's peer is the caller. Only the entry the outermost trusted
// proxy wrote is read. When that entry is missing or isn't an address, the
// caller's address is unknown, and the realm treats an unknown address as a
// blocked one.
//
// `infraAddresses` are where the platform's own services reach the realm
// server from (the NAT gateway they leave the network through). A caller at
// one of them is marked as infrastructure, which a realm counts and records
// but never limits or blocks. The mark admits nothing: such a caller still
// needs a grant, as any anonymous caller does. Card code a prerender server
// runs leaves through the same gateway, so it too goes unlimited, but it gains
// nothing a signed-in caller doesn't already have, since rate limits apply to
// no signed-in caller and anyone can sign in.
export function clientAddress({
  trustedProxyHops,
  infraAddresses,
}: {
  trustedProxyHops: number;
  infraAddresses: readonly AddressRange[];
}): Koa.Middleware {
  return async function clientAddressMiddleware(ctxt, next) {
    let headers = ctxt.req.headers;
    delete headers[CLIENT_IP_HEADER];
    delete headers[CLIENT_CLASS_HEADER];
    let address = callerAddress(ctxt, trustedProxyHops);
    if (address) {
      headers[CLIENT_IP_HEADER] = formatIP(address);
      if (rangesContain(infraAddresses, address)) {
        headers[CLIENT_CLASS_HEADER] = INFRA_CLIENT_CLASS;
      }
    }
    await next();
  };
}

function callerAddress(ctxt: Koa.Context, trustedProxyHops: number) {
  if (trustedProxyHops <= 0) {
    let peer = ctxt.req.socket?.remoteAddress;
    return peer ? parseIP(peer) : undefined;
  }
  let forwarded = ctxt.req.headers['x-forwarded-for'];
  let entries = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries || entries.length < trustedProxyHops) {
    return undefined;
  }
  return parseIP(entries[entries.length - trustedProxyHops]);
}

// The settings, from the realm server's environment:
// `BOXEL_TRUSTED_PROXY_HOPS` (a whole number, unset meaning zero) and
// `BOXEL_INFRA_EGRESS_IPS` (comma-separated addresses and CIDR ranges). A
// malformed hop count or infrastructure entry is a deploy error and stops the
// server from starting, rather than quietly counting every caller as one
// address or our own services as strangers.
export function clientAddressSettingsFromEnv(env: NodeJS.ProcessEnv): {
  trustedProxyHops: number;
  infraAddresses: AddressRange[];
} {
  let hopsText = env.BOXEL_TRUSTED_PROXY_HOPS?.trim();
  let trustedProxyHops = hopsText ? Number(hopsText) : 0;
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0) {
    throw new Error(
      `BOXEL_TRUSTED_PROXY_HOPS must be a whole number of proxies, not "${hopsText}"`,
    );
  }
  let entries = (env.BOXEL_INFRA_EGRESS_IPS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  let { ranges, invalid } = parseAddressRanges(entries);
  if (invalid.length > 0) {
    throw new Error(
      `BOXEL_INFRA_EGRESS_IPS has entries that are not an IP address or CIDR range: ${invalid.join(', ')}`,
    );
  }
  return { trustedProxyHops, infraAddresses: ranges };
}
