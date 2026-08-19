// Resolves a typed publish target to the published-realm URL it maps to.
//
// Two target shapes are supported, mirroring the publish UI
// (`operator-mode/publish-realm-modal.gts`):
//
//   - 'subdirectory': a Boxel Space under the user's space domain. The URL is
//     `https://<matrixUsername>.<spaceDomain>/<realmName>/`, where `name` is the
//     realm-name path segment (defaults to the last segment of the source realm
//     URL when omitted).
//   - 'custom': a claimed custom domain. The URL is `https://<hostname>/`, where
//     `name` is the full hostname (e.g. "mysite.boxel.site" or
//     "mysite.localhost:4201").
//
// Keep this in sync with the modal — both must produce identical URLs.

export type PublishTargetType = 'subdirectory' | 'custom';

export interface PublishTargetSpec {
  type: PublishTargetType;
  // For 'subdirectory', the realm-name path segment (optional; derived from
  // `sourceRealmURL` when blank). For 'custom', the full hostname.
  name?: string;
}

export interface PublishedRealmUrlContext {
  // Required for 'subdirectory' targets.
  matrixUsername?: string;
  // Required for 'subdirectory' targets (e.g. config.publishedRealmBoxelSpaceDomain).
  spaceDomain?: string;
  // Used to derive the realm name for 'subdirectory' targets when `name` is blank.
  sourceRealmURL?: string;
  // Defaults to 'https'. The local dev stack and every deployed environment
  // serve published realms over https.
  protocol?: string;
}

const DEFAULT_PROTOCOL = 'https';

// Extracts the realm-name path segment from a realm URL: the last non-empty
// path segment, lowercased. Matches the modal's `getRealmName`.
export function deriveRealmName(realmURL: string): string {
  let url: URL;
  try {
    url = new URL(realmURL);
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse realm URL "${realmURL}": ${message}`);
  }
  let segments = url.pathname.split('/').filter((segment) => segment);
  let lastSegment = segments[segments.length - 1];
  if (!lastSegment) {
    throw new Error(`Could not extract realm name from URL path "${realmURL}"`);
  }
  return lastSegment.toLowerCase();
}

// Parses a custom-domain target's name into a bare host (with port when
// present). A custom target maps to `https://<host>/`, so anything beyond a
// hostname — credentials, a path, a query, or a fragment — means the caller
// passed a URL or made a mistake, and is rejected rather than silently
// producing a non-root published-realm URL. A leading protocol is tolerated so
// callers may pass either "host:port" or "https://host:port/".
function parseCustomHostname(value: string): string {
  let trimmed = value.trim();
  if (!trimmed) {
    throw new Error('A custom publish target requires a hostname in `name`');
  }
  let withProtocol = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error(`Invalid custom publish target hostname: "${value}"`);
  }
  if (url.username || url.password) {
    throw new Error(
      `A custom publish target hostname must not include credentials: "${value}"`,
    );
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error(
      `A custom publish target must be a bare hostname, not a URL with a path, query, or fragment: "${value}"`,
    );
  }
  return url.host; // host includes the port when present
}

// Normalizes a caller-supplied protocol to a bare scheme so a value like
// "https" or an accidental "https://" both yield "https".
function normalizeProtocol(protocol: string): string {
  return protocol.replace(/:\/*$/, '');
}

// Character set for the machine-generated path segment of an "unlisted link"
// publish target (`<username>.<spaceDomain>/<slug>/`). Lowercase letters and
// digits only — safe as a URL path segment with no escaping — with the visually
// ambiguous characters removed (i, l, o, 0, 1) so a link read aloud or copied by
// hand is less error-prone.
const OBSCURE_SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz';
const OBSCURE_SLUG_DIGITS = '23456789';
const OBSCURE_SLUG_CHARSET = OBSCURE_SLUG_ALPHABET + OBSCURE_SLUG_DIGITS;

// Length of a generated slug. 16 characters over a 31-symbol alphabet is ~79
// bits of entropy — unguessable in the "even if the page is public, the URL is
// the secret" sense (a la a Google Doc link).
export const OBSCURE_SLUG_LENGTH = 16;

function randomBytes(length: number): Uint8Array {
  let cryptoObj = (
    globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }
  ).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error(
      'A secure random source (crypto.getRandomValues) is required to generate an unlisted link',
    );
  }
  let bytes = new Uint8Array(length);
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

// Picks `count` characters uniformly from `charset` using rejection sampling so
// there is no modulo bias toward the earlier characters of the alphabet.
function randomChars(charset: string, count: number): string {
  let max = Math.floor(256 / charset.length) * charset.length;
  let out = '';
  while (out.length < count) {
    for (let byte of randomBytes(count - out.length)) {
      if (byte < max) {
        out += charset[byte % charset.length];
        if (out.length === count) {
          break;
        }
      }
    }
  }
  return out;
}

// Generates an unguessable path-segment slug for an "unlisted link" publish
// target. The whole string is drawn from a URL-path-safe alphabet so it needs no
// escaping in the published-realm URL.
export function generateObscureSlug(): string {
  return randomChars(OBSCURE_SLUG_CHARSET, OBSCURE_SLUG_LENGTH);
}

export function resolvePublishedRealmUrl(
  target: PublishTargetSpec,
  ctx: PublishedRealmUrlContext = {},
): string {
  let protocol = normalizeProtocol(ctx.protocol ?? DEFAULT_PROTOCOL);

  switch (target.type) {
    case 'custom': {
      let host = parseCustomHostname(target.name ?? '');
      return `${protocol}://${host}/`;
    }
    case 'subdirectory': {
      let realmName = (target.name ?? '').trim();
      if (!realmName) {
        if (!ctx.sourceRealmURL) {
          throw new Error(
            'A subdirectory publish target requires either `name` or a `sourceRealmURL` to derive it from',
          );
        }
        realmName = deriveRealmName(ctx.sourceRealmURL);
      } else {
        realmName = realmName.toLowerCase();
      }
      if (!ctx.matrixUsername) {
        throw new Error(
          'A subdirectory publish target requires `matrixUsername`',
        );
      }
      if (!ctx.spaceDomain) {
        throw new Error('A subdirectory publish target requires `spaceDomain`');
      }
      return `${protocol}://${ctx.matrixUsername}.${ctx.spaceDomain}/${realmName}/`;
    }
    default: {
      throw new Error(
        `Unknown publish target type: ${(target as PublishTargetSpec).type}`,
      );
    }
  }
}
