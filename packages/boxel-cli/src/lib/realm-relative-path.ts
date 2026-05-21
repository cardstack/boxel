/**
 * Validate that an agent- or user-supplied `path` is a safe
 * realm-relative path. Returns an error message if rejected, or null
 * if the path is acceptable.
 *
 * Rejects:
 * - empty / whitespace-only paths
 * - absolute URLs with a scheme (`http:`, `file:`, etc.)
 * - paths starting with `/`
 * - backslash characters (ambiguous across URL/path handling layers;
 *   e.g. `foo\..\bar` never splits on `/` so the `..` check below
 *   misses it)
 * - percent-encoded traversal segments — decodes once and rejects any
 *   `..` segment after decoding, so `%2e%2e`, `%2E%2E`, `%2e.`, etc.
 *   all collapse to a `..` and fail
 * - malformed percent-encoded escapes
 *
 * Mirrors `packages/software-factory/src/realm-relative-path.ts` so
 * both the SDK orchestrator and the boxel-cli validators apply the
 * same gate before a path reaches realm-server URL handling.
 */
export function validateRealmRelativePath(path: string): string | null {
  if (path.trim() === '') {
    return `Path must be a non-empty realm-relative file path.`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return `Path "${path}" must be realm-relative — absolute URLs (with a scheme) are not accepted.`;
  }
  if (path.startsWith('/')) {
    return `Path "${path}" must be realm-relative — paths starting with "/" are not accepted.`;
  }
  if (path.includes('\\')) {
    return `Path "${path}" must not contain backslash characters.`;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return `Path "${path}" contains an invalid percent-encoded escape.`;
  }
  let segments = decoded.split('/');
  if (segments.some((seg) => seg === '..')) {
    return `Path "${path}" must not contain ".." segments — the path must stay inside the target realm.`;
  }
  return null;
}
