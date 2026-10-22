import { isScopedCSSRequest, scopedCSSServingHref } from './scoped-css.ts';
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

// The scoped-CSS hrefs a row depends on, in dependency order — the host
// module-loads each as-is. An inline-form dep passes through verbatim (the
// whole stylesheet is base64-embedded in its filename, so it loads locally
// with no network hop). A hashed-form dep is rewritten to the answering
// realm's `_scoped-css/` serving space: that realm interned the stylesheet
// bytes into its own `scoped_css` table when it indexed the row, so it — and
// not the realm hosting the dep's module — is guaranteed to serve the hash.
export function scopedCssHrefsFromDeps(
  deps: string[] | null | undefined,
  servingRealmURL: string,
): string[] {
  return (deps ?? [])
    .filter((dep) => isScopedCSSRequest(dep))
    .map((dep) => scopedCSSServingHref(dep, servingRealmURL));
}

// A `css` resource: id is the content hash of the encoded href so identical
// stylesheets dedupe to one `(type, id)` in `included`; the blob rides once in
// `attributes.href`.
export function buildCssResource(href: string): CssResource {
  return { type: 'css', id: cssResourceId(href), attributes: { href } };
}
