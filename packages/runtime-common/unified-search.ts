import { isScopedCSSRequest } from './scoped-css.ts';
import { cssResourceId, type CssResource } from './resource-types.ts';
import type { CodeRef } from './code-ref.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';

// Pure helpers shared by the search result mappers (no SQL, no realm state, so
// they can be unit-tested directly): render-type parsing, scoped-CSS dep
// extraction, and the first-class `css` resource builder.

// The SQL `used_render_type` column carries the resolved render type as a
// "<module>/<name>" string. Parse it back to a CodeRef; a value without a
// separator (or an empty value) yields undefined.
export function parseUsedRenderType(
  value: string | null | undefined,
): CodeRef | undefined {
  if (!value) {
    return undefined;
  }
  let i = value.lastIndexOf('/');
  if (i < 0) {
    return undefined;
  }
  return {
    module: value.slice(0, i) as RealmResourceIdentifier,
    name: value.slice(i + 1),
  };
}

// The scoped-CSS hrefs a row depends on, in dependency order. A scoped-CSS
// "URL" base64-embeds the whole stylesheet in its filename, so the href is the
// dep string verbatim — the host module-loads it as-is.
export function scopedCssHrefsFromDeps(
  deps: string[] | null | undefined,
): string[] {
  return (deps ?? []).filter((dep) => isScopedCSSRequest(dep));
}

// A `css` resource: id is the content hash of the encoded href so identical
// stylesheets dedupe to one `(type, id)` in `included`; the blob rides once in
// `attributes.href`.
export function buildCssResource(href: string): CssResource {
  return { type: 'css', id: cssResourceId(href), attributes: { href } };
}
