// Advisory validators for the host routing rule editor. These do not
// reject input — they produce a human-readable warning the UI shows
// next to the offending rule. Server-side enforcement is intentionally
// out of scope for the MVP.

const VALID_PATH_PATTERN = /^\/(?:[A-Za-z0-9._~/-]|%[0-9A-Fa-f]{2})*$/;

/**
 * Returns a warning message for a routing rule path that is non-empty
 * but malformed. Empty / whitespace-only / null / undefined input
 * returns `undefined` so an in-progress rule never shows the warning.
 *
 * Rules:
 * - Must start with `/`.
 * - Otherwise composed of the unreserved character set
 *   (letters, numbers, `-`, `_`, `.`, `~`), `/` separators, or
 *   percent-encoded `%XX` sequences (`X` is a hex digit).
 * - A trailing slash is stripped when the route is matched, so it is
 *   advised against (with the normalized form shown) rather than
 *   rejected. The realm root `/` is exempt.
 */
export function validateRoutingPath(
  path: string | null | undefined,
): string | undefined {
  if (path == null) return undefined;
  let trimmed = path.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('/')) {
    return 'Path must start with /';
  }
  if (!VALID_PATH_PATTERN.test(trimmed)) {
    return 'Path may only contain letters, numbers, /, -, _, ., ~, or %XX-encoded characters';
  }
  // A trailing slash is stripped when the route is matched (see
  // Realm.getHostRoutingMap), so '/pricing/' behaves exactly like
  // '/pricing'. Surface that instead of silently normalizing the author's
  // input. The root '/' is the realm root, not a trailing slash, so it is
  // exempt.
  if (trimmed !== '/' && trimmed.endsWith('/')) {
    let normalized = trimmed.replace(/\/+$/, '') || '/';
    return `Trailing slash is ignored; this route matches "${normalized}"`;
  }
  return undefined;
}

/**
 * Returns the set of non-empty paths that appear on more than one
 * routing rule, in insertion order. Empty paths are ignored — they
 * represent rules whose path field hasn't been filled in yet.
 */
export function findDuplicateRoutingPaths(
  rules: ReadonlyArray<{ path?: string | null }> | null | undefined,
): string[] {
  if (!rules) return [];
  let counts = new Map<string, number>();
  for (let rule of rules) {
    let path = rule?.path?.trim();
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  let dups: string[] = [];
  for (let [path, count] of counts) {
    if (count > 1) dups.push(path);
  }
  return dups;
}
