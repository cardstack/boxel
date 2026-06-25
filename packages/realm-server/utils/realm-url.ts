import { ensureTrailingSlash } from '@cardstack/runtime-common';

// Canonical realm-root form used as the lookup key for realm_user_permissions
// and realm_registry: no querystring or fragment, exactly one trailing slash.
// Returns null when the input isn't a valid URL so callers can answer 400.
//
// Every realm-URL keying path must go through here. Those rows are matched by
// this exact string, so a second normalizer that drifts would silently miss
// rows — e.g. a permission written under `https://h/r/` but looked up as
// `https://h/r`.
export function normalizeRealmURL(realmURL: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(realmURL);
  } catch {
    return null;
  }
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = ensureTrailingSlash(parsed.pathname);
  return parsed;
}
