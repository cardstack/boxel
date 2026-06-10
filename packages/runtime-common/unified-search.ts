import { isScopedCSSRequest } from './scoped-css';
import {
  cssResourceId,
  type CardResource,
  type CssResource,
  type RenderedHtmlResource,
  type Saved,
} from './resource-types';
import type { CodeRef } from './code-ref';
import type { RealmResourceIdentifier } from './realm-identifiers';

// Builders for the unified-search resources. The realm-server's result mapper
// runs these per row when applying the prefer-HTML resolution policy; keeping
// them pure (no SQL, no realm state) lets the shapes be unit-tested directly
// and shared with the prerendered compat reshaper.

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

// The `rendered-html` resource for an HTML-backed (or error) row. `id` is the
// card/file URL — the same id as its `card`, with `type` the discriminator.
// `styles` references the row's `css` resources by their hash ids.
export function buildRenderedHtmlResource(args: {
  url: string;
  html: string;
  cardType: string;
  iconHtml?: string;
  isError?: boolean;
  renderType?: CodeRef;
  cssIds: string[];
}): RenderedHtmlResource {
  let { url, html, cardType, iconHtml, isError, renderType, cssIds } = args;
  let resource: RenderedHtmlResource = {
    type: 'rendered-html',
    id: url,
    attributes: {
      html,
      cardType,
      ...(iconHtml ? { iconHtml } : {}),
      ...(isError ? { isError: true as const } : {}),
    },
    relationships: {
      styles: { data: cssIds.map((id) => ({ type: 'css' as const, id })) },
    },
  };
  if (renderType) {
    resource.meta = { renderType };
  }
  return resource;
}

// The identity-only `card` paired with a `rendered-html` row: identity + meta
// (carrying the explicit `identityOnly` marker, the actual `adoptsFrom`, and
// the `renderType` it was rendered as) + `links.self` (the hydration GET
// target) + the `rendered-html` relationship — and deliberately NO
// `attributes`, since the live serialization is never shipped for an HTML row.
export function buildIdentityOnlyCard(args: {
  url: string;
  adoptsFrom: CodeRef;
  renderType?: CodeRef;
}): CardResource {
  let { url, adoptsFrom, renderType } = args;
  return {
    type: 'card',
    id: url as Saved,
    relationships: {
      'rendered-html': { data: { type: 'rendered-html', id: url } },
    },
    meta: {
      adoptsFrom,
      identityOnly: true,
      ...(renderType ? { renderType } : {}),
    },
    links: { self: url },
  };
}
