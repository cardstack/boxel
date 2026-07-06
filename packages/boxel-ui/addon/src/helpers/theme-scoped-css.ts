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
export function themeScopedCss(
  scope?: string,
  cssVariables?: string | null,
): SafeString {
  if (!extractCssVariables || !scope || !cssVariables) {
    return htmlSafe('');
  }
  let light = extractCssVariables(cssVariables, ':root');
  let dark = extractCssVariables(cssVariables, '.dark');
  let selector = `[data-boxel-theme-scope="${scope}"]`;
  let css = '';
  if (light) {
    css += `${selector}{${sanitizeHtml(light)}}`;
  }
  if (dark) {
    css += `@container style(--boxel-color-scheme: dark){${selector}{${sanitizeHtml(dark)}}}`;
  }
  return htmlSafe(css);
}
