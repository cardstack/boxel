import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

// IPv4 addresses an outbound call must never reach: loopback, private and
// link-local networks (cloud metadata services live at 169.254.169.254),
// carrier-grade NAT, multicast, and reserved and documentation ranges.
//
// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d, dotted or hex) are checked
// against these same rules: BlockList treats the two forms as one address, so
// ::ffff:7f00:1 is refused like 127.0.0.1. That equivalence is also why no
// IPv6 rule here may cover ::ffff:0:0/96 — BlockList would apply it to every
// IPv4 address and refuse the whole public internet.
const blockedIPv4 = (() => {
  let list = new BlockList();
  for (let [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ] as const) {
    list.addSubnet(network, prefix, 'ipv4');
  }
  return list;
})();

const ipv4Mapped = (() => {
  let list = new BlockList();
  list.addSubnet('::ffff:0:0', 96, 'ipv6');
  return list;
})();

// A native IPv6 address is public only inside global unicast, 2000::/3.
// Everything outside it — loopback, unique local, link-local, multicast, the
// IPv4-compatible and IPv4-translated forms, NAT64, segment-routing SIDs, and
// whatever is assigned there later — is refused by default rather than
// listed. These ranges never contain ::ffff:0:0/96, so checking an IPv6
// address against them can't catch the IPv4 trap above.
const globalUnicastIPv6 = (() => {
  let list = new BlockList();
  list.addSubnet('2000::', 3, 'ipv6');
  return list;
})();

// The special-purpose blocks inside global unicast: IETF protocol assignments
// (Teredo, benchmarking, ORCHID, among others), documentation (2001:db8::/32
// and 3fff::/20), and 6to4, whose embedded IPv4 address could be any of the
// private ranges above.
const blockedGlobalUnicastIPv6 = (() => {
  let list = new BlockList();
  for (let [network, prefix] of [
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
  ] as const) {
    list.addSubnet(network, prefix, 'ipv6');
  }
  return list;
})();

// The cloud metadata services. Refused even for a host the development
// allowlist names: the allowlist lets a local host be reached, never the
// instance's credentials.
const metadataAddresses = (() => {
  let list = new BlockList();
  list.addAddress('169.254.169.254', 'ipv4');
  list.addAddress('fd00:ec2::254', 'ipv6');
  return list;
})();

const IPV4_MAPPED_RE = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

function normalizeAddress(
  address: string,
): { address: string; family: 'ipv4' | 'ipv6' } | undefined {
  let normalized = address.replace(/^\[|\]$/g, '');
  let mapped = IPV4_MAPPED_RE.exec(normalized);
  if (mapped) {
    normalized = mapped[1];
  }
  let family = isIP(normalized);
  if (family === 0) {
    return undefined;
  }
  return { address: normalized, family: family === 4 ? 'ipv4' : 'ipv6' };
}

// True when `address` (an IP literal, optionally bracketed) is on the public
// internet.
export function isPublicAddress(address: string): boolean {
  let normalized = normalizeAddress(address);
  if (!normalized) {
    return false;
  }
  if (normalized.family === 'ipv4') {
    return !blockedIPv4.check(normalized.address, 'ipv4');
  }
  if (ipv4Mapped.check(normalized.address, 'ipv6')) {
    // Hex-form IPv4-mapped: BlockList applies the IPv4 rules to it.
    return !blockedIPv4.check(normalized.address, 'ipv6');
  }
  return (
    globalUnicastIPv6.check(normalized.address, 'ipv6') &&
    !blockedGlobalUnicastIPv6.check(normalized.address, 'ipv6')
  );
}

// True when `address` is a cloud metadata service address, in either family
// or written as an IPv4-mapped IPv6 address.
export function isMetadataAddress(address: string): boolean {
  let normalized = normalizeAddress(address);
  if (!normalized) {
    return false;
  }
  return metadataAddresses.check(normalized.address, normalized.family);
}

// Whether a host may be reached at `address`. A host the development
// allowlist names may resolve to a local address; every other host must
// resolve to a public one.
export function isAllowedAddress(address: string, allowlisted: boolean) {
  if (isMetadataAddress(address)) {
    return false;
  }
  return allowlisted
    ? isIP(address.replace(/^\[|\]$/g, '')) !== 0
    : isPublicAddress(address);
}

export class BlockedAddressError extends Error {
  readonly code = 'ERR_OUTBOUND_BLOCKED_ADDRESS';
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

export async function defaultResolveHost(hostname: string): Promise<string[]> {
  let addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

// A socket lookup that resolves a hostname and refuses it unless every
// address it resolves to is allowed; the socket then connects to the vetted
// addresses and nothing resolves the name a second time. Vetting inside the
// lookup the socket itself uses means a DNS answer that changes between a
// check and the connection (DNS rebinding) can't slip a private address
// through.
export function guardedLookup({
  resolveHost = defaultResolveHost,
  isAllowlisted,
}: {
  resolveHost?: ResolveHost;
  isAllowlisted: (hostname: string) => boolean;
}): LookupFunction {
  return ((hostname: string, options: any, callback: any) => {
    resolveHost(hostname).then(
      (addresses) => {
        let allowlisted = isAllowlisted(hostname);
        let blocked = addresses.find(
          (address) => !isAllowedAddress(address, allowlisted),
        );
        if (addresses.length === 0 || blocked) {
          callback(
            new BlockedAddressError(
              `${hostname} resolves to a private or reserved address`,
            ),
          );
          return;
        }
        let entries = addresses.map((address) => ({
          address,
          family: isIP(address),
        }));
        if (options?.all) {
          callback(null, entries);
        } else {
          callback(null, entries[0].address, entries[0].family);
        }
      },
      (error: unknown) => callback(error),
    );
  }) as LookupFunction;
}
