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
  // that could break out of the double-quoted attribute selector. The escaped
  // selector still matches the literal attribute value.
  let selector = `[data-boxel-theme-scope="${scope.replace(/[\\"]/g, '\\$&')}"]`;
  let css = '';
  if (light) {
    css += `${selector}{${sanitizeDeclarations(light)}}`;
  }
  if (dark) {
    css += `@container style(--boxel-color-scheme: dark){${selector}{${sanitizeDeclarations(dark)}}}`;
  }
  return htmlSafe(css);
}
