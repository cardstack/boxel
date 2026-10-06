// How a realm controls the callers its policy admits without a session: the
// rate limit their invocations are counted against, and the addresses it
// refuses outright. Both are the governed realm's own settings, read from its
// `realm.json`, never from a policy card. A policy card can live in another
// realm, and its writers must not decide how hard this realm can be hit or
// who is kept out of it.
//
// Pure TypeScript, without Node's `net`, because the host compiles and
// explains policies in the browser as well as on the server.

export interface AnonymousRateLimit {
  // Invocations admitted per window, per client address.
  requests: number;
  windowSeconds: number;
}

// The limit a realm's anonymous callers get when its `realm.json` sets none.
// The realm server can replace it with `BOXEL_ANONYMOUS_RATE_LIMIT`; a realm
// overrides either with its own `anonymousRateLimit`.
export const DEFAULT_ANONYMOUS_RATE_LIMIT: AnonymousRateLimit = {
  requests: 300,
  windowSeconds: 60,
};

// Bounds on a limit anyone can write. A window over a day would keep a counter
// row alive far longer than any abuse pattern it is meant to catch, and a
// request count beyond a million in one window is no limit at all.
const MAX_WINDOW_SECONDS = 86_400;
const MAX_REQUESTS = 1_000_000;

// A limit as written in `realm.json`, or undefined when it is not one: both
// fields present, whole, and within the bounds above. Anything else is
// rejected whole rather than repaired, since a half-understood limit is a
// limit nobody wrote.
export function parseRateLimit(value: unknown): AnonymousRateLimit | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  let { requests, windowSeconds } = value as Record<string, unknown>;
  if (
    !Number.isInteger(requests) ||
    !Number.isInteger(windowSeconds) ||
    (requests as number) < 1 ||
    (requests as number) > MAX_REQUESTS ||
    (windowSeconds as number) < 1 ||
    (windowSeconds as number) > MAX_WINDOW_SECONDS
  ) {
    return undefined;
  }
  return {
    requests: requests as number,
    windowSeconds: windowSeconds as number,
  };
}

// The `requests/windowSeconds` spelling the realm server's environment uses,
// for example `300/60`.
export function parseRateLimitSpec(
  spec: string | undefined,
): AnonymousRateLimit | undefined {
  let match = spec?.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    return undefined;
  }
  return parseRateLimit({
    requests: Number(match[1]),
    windowSeconds: Number(match[2]),
  });
}

export type IPFamily = 4 | 6;

export interface IPAddress {
  family: IPFamily;
  value: bigint;
}

export interface AddressRange {
  family: IPFamily;
  base: bigint;
  prefixLength: number;
}

const IPV4_MAPPED_PREFIX = 0xffffn << 32n;

// An IPv4 or IPv6 address, or undefined when the text is not one. An
// IPv4-mapped IPv6 address (`::ffff:192.0.2.1`) is the IPv4 address it maps,
// so a blocklist entry and a counter key written either way name the same
// caller. A zone index (`fe80::1%eth0`) names an interface, not a caller, and
// is refused.
export function parseIP(text: string): IPAddress | undefined {
  let trimmed = text.trim();
  if (trimmed.includes(':')) {
    let value = parseIPv6(trimmed);
    if (value === undefined) {
      return undefined;
    }
    if (value >> 32n === 0xffffn) {
      return { family: 4, value: value - IPV4_MAPPED_PREFIX };
    }
    return { family: 6, value };
  }
  let value = parseIPv4(trimmed);
  return value === undefined ? undefined : { family: 4, value };
}

function parseIPv4(text: string): bigint | undefined {
  let parts = text.split('.');
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0n;
  for (let part of parts) {
    // Leading zeros are refused: some parsers read `010` as octal, so the
    // same text would name two different addresses.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return undefined;
    }
    let octet = Number(part);
    if (octet > 255) {
      return undefined;
    }
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIPv6(text: string): bigint | undefined {
  if (text.startsWith('[') && text.endsWith(']')) {
    text = text.slice(1, -1);
  }
  if (text.includes('%')) {
    return undefined;
  }
  let halves = text.split('::');
  if (halves.length > 2) {
    return undefined;
  }
  // An embedded IPv4 address can only be the address's last 32 bits, so it is
  // read only at the end of the last half: `::ffff:192.0.2.1` and
  // `64:ff9b::192.0.2.1`, never `192.0.2.1::`.
  let groupsOf = (
    half: string,
    mayEndInIPv4: boolean,
  ): bigint[] | undefined => {
    if (half === '') {
      return [];
    }
    let groups: bigint[] = [];
    let parts = half.split(':');
    for (let [index, part] of parts.entries()) {
      if (mayEndInIPv4 && index === parts.length - 1 && part.includes('.')) {
        let v4 = parseIPv4(part);
        if (v4 === undefined) {
          return undefined;
        }
        groups.push(v4 >> 16n, v4 & 0xffffn);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
        return undefined;
      }
      groups.push(BigInt(parseInt(part, 16)));
    }
    return groups;
  };
  let head = groupsOf(halves[0], halves.length === 1);
  let tail = halves.length === 2 ? groupsOf(halves[1], true) : [];
  if (!head || !tail) {
    return undefined;
  }
  let missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return undefined;
  }
  let groups = [...head, ...Array<bigint>(missing).fill(0n), ...tail];
  return groups.reduce((value, group) => (value << 16n) | group, 0n);
}

// The canonical text of an address: dotted-quad for IPv4 (including a mapped
// IPv6 one), and the RFC 5952 compressed lower-case form for IPv6. What the
// realm counts, blocks and records under, so one caller is one key however
// the address reached it.
export function formatIP(address: IPAddress): string {
  if (address.family === 4) {
    return [24n, 16n, 8n, 0n]
      .map((shift) => String((address.value >> shift) & 0xffn))
      .join('.');
  }
  let groups = Array.from({ length: 8 }, (_, i) =>
    Number((address.value >> BigInt((7 - i) * 16)) & 0xffffn),
  );
  // The longest run of two or more zero groups collapses to `::`, the first
  // one when two runs tie.
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) {
      j++;
    }
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  let hex = (gs: number[]) => gs.map((g) => g.toString(16)).join(':');
  if (bestStart === -1) {
    return hex(groups);
  }
  return `${hex(groups.slice(0, bestStart))}::${hex(
    groups.slice(bestStart + bestLength),
  )}`;
}

// The key a caller's invocations are counted under. An IPv4 caller is counted
// by their address. An IPv6 caller is counted by the /64 their address is in,
// since a single network is routinely handed a whole /64 and could otherwise
// spread its invocations over as many budgets as it has addresses.
export function rateLimitKey(address: IPAddress): string {
  if (address.family === 4) {
    return formatIP(address);
  }
  let prefix = (address.value >> 64n) << 64n;
  return `${formatIP({ family: 6, value: prefix })}/64`;
}

// The canonical text of an address given as text, or undefined when it is not
// an address.
export function normalizeIP(text: string): string | undefined {
  let address = parseIP(text);
  return address ? formatIP(address) : undefined;
}

// A single address or a CIDR range (`192.0.2.0/24`, `2001:db8::/32`), or
// undefined when the text is neither. A range whose address has bits set
// below its prefix (`192.0.2.1/24`) is refused rather than masked: the author
// either meant the single address or a different range, and guessing which
// would block the wrong callers.
export function parseAddressRange(text: string): AddressRange | undefined {
  let [addressText, prefixText, ...rest] = text.trim().split('/');
  if (rest.length > 0) {
    return undefined;
  }
  let address = parseIP(addressText);
  if (!address) {
    return undefined;
  }
  let width = address.family === 4 ? 32 : 128;
  if (prefixText === undefined) {
    return { family: address.family, base: address.value, prefixLength: width };
  }
  if (!/^\d{1,3}$/.test(prefixText)) {
    return undefined;
  }
  let prefixLength = Number(prefixText);
  // A mapped IPv6 range is an IPv4 range whose prefix counts the 96 bits of
  // the mapping prefix as well.
  if (address.family === 4 && addressText.includes(':')) {
    prefixLength -= 96;
  }
  if (prefixLength < 0 || prefixLength > width) {
    return undefined;
  }
  let hostBits = BigInt(width - prefixLength);
  if (address.value & ((1n << hostBits) - 1n)) {
    return undefined;
  }
  return { family: address.family, base: address.value, prefixLength };
}

export function rangeContains(range: AddressRange, address: IPAddress) {
  if (range.family !== address.family) {
    return false;
  }
  let width = range.family === 4 ? 32n : 128n;
  let hostBits = width - BigInt(range.prefixLength);
  return address.value >> hostBits === range.base >> hostBits;
}

export function rangesContain(
  ranges: readonly AddressRange[],
  address: IPAddress,
) {
  return ranges.some((range) => rangeContains(range, address));
}

// A list of addresses and ranges, split into the entries that parse and the
// ones that don't, so a caller can decide what a malformed entry costs.
export function parseAddressRanges(entries: readonly unknown[]): {
  ranges: AddressRange[];
  invalid: string[];
} {
  let ranges: AddressRange[] = [];
  let invalid: string[] = [];
  for (let entry of entries) {
    let range =
      typeof entry === 'string' ? parseAddressRange(entry) : undefined;
    if (range) {
      ranges.push(range);
    } else {
      invalid.push(typeof entry === 'string' ? entry : JSON.stringify(entry));
    }
  }
  return { ranges, invalid };
}

// Whether a written limit says nothing: absent, or the shape a saved
// RealmConfig card gives a limit field nobody filled in, every value null.
export function isUnsetLimit(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.values(value as Record<string, unknown>).every((v) => v == null))
  );
}

// What the realm's `realm.json` says about anonymous callers, resolved
// against the platform default.
export interface AnonymousAccessSettings {
  limit: AnonymousRateLimit;
  // Whether the limit is the realm's own or the platform's.
  limitFrom: 'realm' | 'platform';
  blocklist: AddressRange[];
  // Entries that are not an address or a range, as written. A realm with any
  // admits no anonymous caller at all: dropping an entry would let in the
  // address its author meant to keep out.
  invalidBlocklistEntries: string[];
}

export function resolveAnonymousAccess(
  written: { rateLimit?: unknown; blocklist?: unknown },
  platformLimit: AnonymousRateLimit = DEFAULT_ANONYMOUS_RATE_LIMIT,
): AnonymousAccessSettings {
  let realmLimit = isUnsetLimit(written.rateLimit)
    ? undefined
    : parseRateLimit(written.rateLimit);
  let entries = Array.isArray(written.blocklist) ? written.blocklist : [];
  let { ranges, invalid } = parseAddressRanges(entries);
  if (written.blocklist != null && !Array.isArray(written.blocklist)) {
    invalid.push(JSON.stringify(written.blocklist));
  }
  return {
    limit: realmLimit ?? platformLimit,
    limitFrom: realmLimit ? 'realm' : 'platform',
    blocklist: ranges,
    invalidBlocklistEntries: invalid,
  };
}

// The headers the realm server sets on every request it hands a realm, naming
// the caller's address as the server worked it out and, for our own
// infrastructure, that it is ours. The server removes any copy a client sent
// before setting them, so a realm can rely on them; nothing else may set them.
export const CLIENT_IP_HEADER = 'x-boxel-client-ip';
export const CLIENT_CLASS_HEADER = 'x-boxel-client-class';
// The value of `CLIENT_CLASS_HEADER` for a request from the platform's own
// services: measured like any other caller, never rate-limited or blocked.
export const INFRA_CLIENT_CLASS = 'infra';
