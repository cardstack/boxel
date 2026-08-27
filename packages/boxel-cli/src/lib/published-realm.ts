import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

// MIME wire value, kept as a local literal so boxel-cli's type-check stays
// dependency-light (mirrors runtime-common's SupportedMimeType.CardJson —
// importing that module would drag base-realm types into the CLI's
// `lint:types`).
const CARD_JSON_MIME = 'application/vnd.card+json';

export interface AnonymousBrowseDeps {
  // Unauthenticated fetch used to confirm the URL really serves a Boxel card
  // without a session. Defaults to the global `fetch`.
  publicFetch?: typeof fetch;
}

/**
 * Return `cardPath` resolved to a no-sign-in browse URL, or `undefined` when
 * it isn't one (so the caller falls back to the authenticated login-token
 * flow).
 *
 * Only a *published* realm — a realm copy served on its own origin — renders
 * anonymously; the operator app on the realm server's origin always forces a
 * login, even for world-readable realms. Published and source cards live at
 * different URLs, so the URL itself states which one the user wants:
 *
 *   1. Resolve the path against the realm server. A relative path (or an
 *      absolute URL on the realm server's own origin) is operator-app
 *      territory and takes the token flow — the same origin test the host
 *      uses to decide host mode vs operator mode.
 *   2. Probe the resolved URL unauthenticated. A 2xx carrying the
 *      `x-boxel-realm-url` header (stamped on every realm response) proves a
 *      Boxel realm serves it anonymously; a non-Boxel URL that happens to
 *      return 200 doesn't qualify.
 */
export async function resolveAnonymousBrowseUrl(
  realmServerUrl: string,
  cardPath: string,
  deps: AnonymousBrowseDeps = {},
): Promise<string | undefined> {
  let publicFetch = deps.publicFetch ?? fetch;
  try {
    let serverBase = ensureTrailingSlash(realmServerUrl);
    let resolved = new URL(cardPath, serverBase);
    if (resolved.origin === new URL(serverBase).origin) {
      return undefined;
    }
    let response = await publicFetch(resolved.href, {
      headers: { Accept: CARD_JSON_MIME },
    });
    if (!response.ok || !response.headers.get('x-boxel-realm-url')) {
      return undefined;
    }
    return resolved.href;
  } catch {
    // Malformed path, unreachable origin, etc. — not the anonymous path; fall
    // back to the token flow.
    return undefined;
  }
}
