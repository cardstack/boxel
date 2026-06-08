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

// Strips a leading protocol and any trailing slash from a hostname so a caller
// may pass either "host:port" or "https://host:port/".
function normalizeHostname(value: string): string {
  return value.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

export function resolvePublishedRealmUrl(
  target: PublishTargetSpec,
  ctx: PublishedRealmUrlContext = {},
): string {
  let protocol = ctx.protocol ?? DEFAULT_PROTOCOL;

  switch (target.type) {
    case 'custom': {
      let hostname = normalizeHostname((target.name ?? '').trim());
      if (!hostname) {
        throw new Error(
          'A custom publish target requires a hostname in `name`',
        );
      }
      return `${protocol}://${hostname}/`;
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
