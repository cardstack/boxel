import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

// MIME wire values, kept as local literals so boxel-cli's type-check stays
// dependency-light (these mirror runtime-common's SupportedMimeType.CardJson
// and .RealmInfo — importing that module would drag base-realm types into the
// CLI's `lint:types`).
const CARD_JSON_MIME = 'application/vnd.card+json';
const REALM_INFO_MIME = 'application/vnd.api+json';

// The published-origin map carried on a realm's RealmInfo:
// `{ <publishedRealmURL>: <epoch-ms timestamp> }`. Older realms may report a
// bare string or `null`; only the object form names published origins.
export type LastPublishedAt =
  | string
  | Record<string, string>
  | null
  | undefined;

// A published realm is served on its own origin, which the host renders
// anonymously (host mode) — unlike the operator app, which always forces a
// login. So a card in a published realm can be opened with no sign-in.
//
// Pick the most-recently published origin from a realm's `lastPublishedAt`,
// mirroring the host's own newest-first ordering
// (host-mode-service.ts `publishedRealmMetadata` / `parsePublishedAt`).
export function pickLatestPublishedOrigin(
  lastPublishedAt: LastPublishedAt,
): string | undefined {
  if (!lastPublishedAt || typeof lastPublishedAt !== 'object') {
    return undefined;
  }
  let entries = Object.entries(lastPublishedAt);
  if (entries.length === 0) {
    return undefined;
  }
  entries.sort((a, b) => publishedAtValue(b[1]) - publishedAtValue(a[1]));
  return entries[0][0];
}

function publishedAtValue(value: unknown): number {
  let n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Build the host-mode (published-origin) URL for a card, mirroring the host's
// `host-mode-service.ts` `fullURL`: the published origin plus the card id taken
// relative to its source realm, with a trailing `index` stripped (the realm's
// index card lives at the origin root).
export function resolvePublishedCardUrl(opts: {
  publishedOrigin: string;
  sourceRealmUrl: string;
  cardId: string;
}): string | undefined {
  let base = ensureTrailingSlash(opts.publishedOrigin);
  let sourceRealmUrl = ensureTrailingSlash(opts.sourceRealmUrl);
  if (!opts.cardId.startsWith(sourceRealmUrl)) {
    // The card id should be absolute under its own realm; if it isn't we can't
    // rebase it onto the published origin, so signal "no anonymous URL".
    return undefined;
  }
  let relative = opts.cardId.slice(sourceRealmUrl.length);
  let full = base + relative;
  if (full === `${base}index`) {
    full = base;
  }
  return full;
}

export interface AnonymousBrowseDeps {
  // Authed fetch against the realm server (the CLI authenticating to discover
  // the card's realm and its published origins — not the browser signing in).
  authedRealmFetch: (input: string, init?: RequestInit) => Promise<Response>;
  // Unauthenticated fetch used to confirm the published URL really renders
  // without a session. Defaults to the global `fetch`.
  publicFetch?: typeof fetch;
}

/**
 * Resolve a no-sign-in browse URL for a card, or `undefined` when there isn't
 * one (so the caller falls back to the authenticated login-token flow).
 *
 * Returns a URL only when the card lives in a *published* realm — the one case
 * the host renders anonymously. The steps, all best-effort (any failure yields
 * `undefined`):
 *   1. Fetch the card (authed) to learn its source realm (`x-boxel-realm-url`
 *      header) and canonical id (`data.id`).
 *   2. Read the realm's `_info` (authed) for its `lastPublishedAt` origins.
 *   3. Rebase the card id onto the newest published origin.
 *   4. Confirm that published URL returns content *without* auth.
 */
export async function resolveAnonymousBrowseUrl(
  realmServerUrl: string,
  cardPath: string,
  deps: AnonymousBrowseDeps,
): Promise<string | undefined> {
  let publicFetch = deps.publicFetch ?? fetch;
  try {
    let cardUrl = new URL(cardPath, ensureTrailingSlash(realmServerUrl)).href;
    let cardResponse = await deps.authedRealmFetch(cardUrl, {
      headers: { Accept: CARD_JSON_MIME },
    });
    if (!cardResponse.ok) {
      return undefined;
    }
    let sourceRealmUrl = cardResponse.headers.get('x-boxel-realm-url');
    let cardJson = (await cardResponse.json()) as { data?: { id?: string } };
    let cardId = cardJson?.data?.id;
    if (!sourceRealmUrl || !cardId) {
      return undefined;
    }
    sourceRealmUrl = ensureTrailingSlash(sourceRealmUrl);

    let infoResponse = await deps.authedRealmFetch(`${sourceRealmUrl}_info`, {
      method: 'QUERY',
      headers: { Accept: REALM_INFO_MIME, 'Content-Type': 'application/json' },
      body: JSON.stringify({ realms: [sourceRealmUrl] }),
    });
    if (!infoResponse.ok) {
      return undefined;
    }
    let infoJson = (await infoResponse.json()) as {
      data?:
        | { attributes?: { lastPublishedAt?: LastPublishedAt } }
        | { attributes?: { lastPublishedAt?: LastPublishedAt } }[];
    };
    let realmData = Array.isArray(infoJson?.data)
      ? infoJson.data[0]
      : infoJson?.data;
    let publishedOrigin = pickLatestPublishedOrigin(
      realmData?.attributes?.lastPublishedAt,
    );
    if (!publishedOrigin) {
      return undefined;
    }

    let publishedUrl = resolvePublishedCardUrl({
      publishedOrigin,
      sourceRealmUrl,
      cardId,
    });
    if (!publishedUrl) {
      return undefined;
    }

    // The published copy is world-readable; confirm it actually serves without
    // a token (guards a stale `lastPublishedAt` after an unpublish, or a card
    // absent from the published copy).
    let verify = await publicFetch(publishedUrl, {
      headers: { Accept: CARD_JSON_MIME },
    });
    if (!verify.ok) {
      return undefined;
    }
    return publishedUrl;
  } catch {
    // Unreachable published origin, missing realm token, unparseable body, etc.
    // — none of these are the anonymous path; fall back to the token flow.
    return undefined;
  }
}
