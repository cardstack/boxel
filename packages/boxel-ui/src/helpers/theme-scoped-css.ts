import { type SafeString, htmlSafe } from '@ember/template';

import { extractCssVariables } from './extract-css-variables.ts';
import { sanitizeHtml } from './sanitize-html.ts';

// Builds a card's theme stylesheet, scoped to `scope` (a per-card
// `data-boxel-theme-scope` value). The theme's `:root` variables apply by
// default; its `.dark` variables take over via a CSS style container query on
// `--boxel-color-scheme` — an inherited signal the theme (theme.css) sets on
// each `[data-theme]` element. Because that signal inherits, the query resolves
// to the *nearest* ancestor's color scheme, so per-subtree overrides (dark
// pages, light islands, nested) all work with no JS and no !important. A theme
// with no `.dark` block simply keeps its light values.
// Declarations are emitted inside a <style> block: sanitizeHtml strips markup
// (e.g. a `</style>` breakout) but knows nothing about CSS, so also drop block
// delimiters — an embedded `}` would close the scoped block and turn the rest
// of the value into page-wide rules.
function sanitizeDeclarations(declarations: string): string {
  return sanitizeHtml(declarations).replace(/[{}]/g, '');
}

function fnv1a(text: string, seed: number): string {
  let hash = seed;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// 64-bit stable fingerprint of the theme CSS for scope values: two 32-bit
// FNV-1a passes with different seeds (the standard offset basis, then the
// upper half of the 64-bit offset basis), hex-encoded fixed-width. Not
// cryptographic, but wide enough that two versions of a theme colliding —
// which would let their scoped rules restyle each other's cards — is not a
// practical concern, where a single 32-bit pass would leave that to chance.
function fingerprint(text: string): string {
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0xcbf29ce4);
}

// Derives a `data-boxel-theme-scope` value from a theme's identity plus a
// fingerprint of its CSS. Every card sharing a theme gets the same scope, so
// their emitted stylesheets are byte-identical — harmless as duplicate rules,
// and dedupable by consumers. The content hash keeps scopes from *different
// versions* of a theme distinct: prerendered fragments are cached at
// different times, so a page can mix a card captured before a theme edit with
// one captured after, and because the scoped rules are page-global, equal
// scopes with unequal declarations would restyle each other's cards.
export function themeScope(
  themeId: string | null | undefined,
  cssVariables: string | null | undefined,
): string | undefined {
  if (!themeId || !cssVariables) {
    return undefined;
  }
  return `${themeId}-${fingerprint(cssVariables)}`;
}

export function themeScopedCss(
  scope?: string,
  cssVariables?: string | null,
): SafeString {
  if (!extractCssVariables || !scope || !cssVariables) {
    return htmlSafe('');
  }
  let light = extractCssVariables(cssVariables, ':root');
  let dark = extractCssVariables(cssVariables, '.dark');
  // Scopes are arbitrary strings (typically card URLs); escape the characters
  // that could break out of the double-quoted attribute selector (`\`, `"`),
  // terminate the surrounding <style> element once this markup is serialized
  // and re-parsed (`<`, as in `</style`), or are invalid in a CSS string
  // (control characters). CSS hex escapes keep the selector matching the
  // literal attribute value.
  // eslint-disable-next-line no-control-regex
  let escapedScope = scope.replace(/[\\"<\u0000-\u001f]/g, (char) =>
    char === '\\' || char === '"'
      ? `\\${char}`
      : `\\${char.codePointAt(0)!.toString(16)} `,
  );
  let selector = `[data-boxel-theme-scope="${escapedScope}"]`;
  let css = '';
  if (light) {
    css += `${selector}{${sanitizeDeclarations(light)}}`;
  }
  if (dark) {
    css += `@container style(--boxel-color-scheme: dark){${selector}{${sanitizeDeclarations(dark)}}}`;
  }
  return htmlSafe(css);
}
