import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

// MIME wire value, kept as a local literal so boxel-cli's type-check stays
// dependency-light (mirrors runtime-common's SupportedMimeType.CardJson —
// importing that module would drag base-realm types into the CLI's
// `lint:types`).
const CARD_JSON_MIME = 'application/vnd.card+json';

// The one Boxel signature the published-realm HTML shell always carries: the
// host reads its build-time config from this meta tag. A routed/vanity path
// (see the text/html fallback below) is served as this shell and stamps no
// `x-boxel-realm-url` header, so the tag is what proves the origin is a Boxel
// host rather than an unrelated site that happens to return 200.
const HOST_CONFIG_META = '@cardstack/host/config/environment';

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
 *   1. Resolve the path. With a `realmServerUrl` in hand, a relative path (or
 *      an absolute URL on the realm server's own origin) is operator-app
 *      territory and takes the token flow — the same origin test the host uses
 *      to decide host mode vs operator mode. Without one (a fresh install with
 *      no profile), only an absolute URL can name a published realm, so a
 *      relative path falls through to the token flow.
 *   2. Probe the resolved URL unauthenticated. A card+json HEAD that returns
 *      2xx with the `x-boxel-realm-url` header (stamped on every realm
 *      response) proves a Boxel realm serves the card anonymously.
 *   3. If that 404s, the path may be a host-routed/vanity URL (e.g. `/pricing`
 *      mapped to `/pages/pricing`) that is not itself an indexed card, so the
 *      card+json probe bypasses the routing map the realm server only applies
 *      to browser navigations. Re-probe the way a browser would — a text/html
 *      GET — and confirm the response is the Boxel host shell.
 */
export async function resolveAnonymousBrowseUrl(
  realmServerUrl: string | undefined,
  cardPath: string,
  deps: AnonymousBrowseDeps = {},
): Promise<string | undefined> {
  let publicFetch = deps.publicFetch ?? fetch;
  try {
    let resolved: URL;
    if (realmServerUrl) {
      let serverBase = ensureTrailingSlash(realmServerUrl);
      resolved = new URL(cardPath, serverBase);
      if (resolved.origin === new URL(serverBase).origin) {
        return undefined;
      }
    } else {
      // No realm server to resolve a relative path against, so only an
      // absolute URL can be a published realm. `new URL` throws for a relative
      // path, which the catch below turns into the token-flow fallback.
      resolved = new URL(cardPath);
    }

    if (
      (await servesPublishedCard(resolved, publicFetch)) ||
      (await servesPublishedShell(resolved, publicFetch))
    ) {
      return resolved.href;
    }
    return undefined;
  } catch {
    // Malformed path, unreachable origin, etc. — not the anonymous path; fall
    // back to the token flow.
    return undefined;
  }
}

// A published card serves its card+json representation anonymously and stamps
// the realm header. HEAD is enough — we only read the status and the header,
// never the body — and it's the common case (a direct card URL), so keep it
// cheap.
async function servesPublishedCard(
  url: URL,
  publicFetch: typeof fetch,
): Promise<boolean> {
  let response = await publicFetch(url.href, {
    method: 'HEAD',
    headers: { Accept: CARD_JSON_MIME },
  });
  return response.ok && response.headers.get('x-boxel-realm-url') != null;
}

// A host-routed/vanity path is served as the Boxel host shell, which carries
// no `x-boxel-realm-url` header, so the shell's config meta tag is the only
// signal that the origin is a Boxel host. That means reading the body, hence a
// GET rather than a HEAD — but only on this fallback, after the cheap card
// probe has already missed.
async function servesPublishedShell(
  url: URL,
  publicFetch: typeof fetch,
): Promise<boolean> {
  let response = await publicFetch(url.href, {
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) {
    return false;
  }
  let body = await response.text();
  return body.includes(HOST_CONFIG_META);
}
