// Pretui — a Theme card's stylesheet, scoped to one element. `themeScope`
// derives the `data-boxel-theme-scope` value and `themeScopedCss` emits the
// rules for it. They are the Pret UI counterparts of the same-named exports
// of `@cardstack/boxel-ui/helpers` (ADR 009 §1.3) and keep their signatures
// and their output. That equality carries weight: base's field-component
// mints a card's scope with boxel-ui's copy, so a ThemeFrame previewing the
// card's own theme mints the same scope here, and each stylesheet matches
// both elements. Byte-identical, the two are harmless duplicates; any
// difference would let one copy restyle the other's element. The host's
// theme-scoped-css-parity test fails when the copies disagree.
import { type SafeString, htmlSafe } from '@ember/template';
import { sanitizeHtml } from '@cardstack/runtime-common';

// ── Reading a theme's variables ──────────────────────────────────────────
// A Theme card's `cssVariables` is CSS text: a `:root { … }` block, an
// optional `.dark { … }` block, or bare declarations with no selector at all.
// The parse below reads those blocks into per-selector maps of custom
// properties, sorted by name so equal themes emit equal text.
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const BLOCK_PATTERN = /(.*?)\{([\s\S]*?)\}/g;
const PROPERTY_PATTERN = /^[a-z\d-]+$/i;
const CUSTOM_PROPERTY_PATTERN = /^--[a-z\d_-]+$/i;

type CssRuleMap = Map<string, string>;
type CssGroups = Map<string, CssRuleMap>;

// Trims a value and drops a trailing semicolon. Rejects values containing
// CSS block delimiters: these values are serialized into <style>
// declaration blocks, where an embedded `}` would close the scoped block and
// let the remainder inject page-wide rules.
function normalizeCssValue(value?: string | null): string | undefined {
  if (value == null) {
    return;
  }
  let normalized = `${value}`.trim().replace(/[;\s]+$/, '');
  if (!normalized || /[{}]/.test(normalized)) {
    return;
  }
  return normalized;
}

// Collapses the selector aliases `root` and `dark` into their canonical form.
function normalizeSelector(selector?: string | null): string | undefined {
  let trimmed = selector?.trim();
  if (!trimmed) {
    return;
  }
  if (trimmed === 'root') {
    return ':root';
  }
  if (trimmed === 'dark') {
    return '.dark';
  }
  return trimmed;
}

// Turns a CSS declaration block into a property-value map.
function parseCssDeclarations(rules?: string): CssRuleMap | undefined {
  if (!rules?.trim()) {
    return;
  }
  let entries: Array<[string, string]> = [];
  for (let declaration of rules
    .split(';')
    .map((rule) => rule.replace(/[\r\n]+/g, ' ').trim())
    .map((rule) => rule.replace(/\s{2,}/g, ' '))
    .filter(Boolean)) {
    let colonIndex = declaration.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    let property = declaration.slice(0, colonIndex).trim();
    let value = normalizeCssValue(declaration.slice(colonIndex + 1));
    let valid = property.startsWith('--')
      ? CUSTOM_PROPERTY_PATTERN.test(property)
      : PROPERTY_PATTERN.test(property);
    if (!property || !valid || !value) {
      continue;
    }
    entries.push([property, value]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  let cssMap: CssRuleMap = new Map(entries);
  return cssMap.size ? cssMap : undefined;
}

// Groups selectors and their declaration maps from raw CSS text. Text with
// no block at all is read as root declarations.
function parseCssGroups(cssString?: string | null): CssGroups | undefined {
  let sanitized = cssString
    ? cssString.replace(COMMENT_PATTERN, ' ').trim()
    : '';
  if (!sanitized) {
    return;
  }
  let groups: CssGroups = new Map();
  for (let match of sanitized.matchAll(BLOCK_PATTERN)) {
    let selectorSource = match[1]?.trim();
    let selector = selectorSource
      ? (normalizeSelector(selectorSource) ?? ':root')
      : ':root';
    let rules = parseCssDeclarations(match[2]);
    if (!rules?.size) {
      continue;
    }
    let existing = groups.get(selector) ?? new Map();
    for (let [property, value] of rules) {
      existing.set(property, value);
    }
    groups.set(selector, existing);
  }
  if (!groups.size) {
    let fallbackRules = parseCssDeclarations(sanitized);
    if (fallbackRules?.size) {
      groups.set(':root', fallbackRules);
    }
  }
  return groups.size ? groups : undefined;
}

/**
 * The custom properties a theme declares under `selector` (`:root` by
 * default), as a `--name: value; --other: value` string, or undefined when
 * it declares none there.
 */
export function extractCssVariables(
  cssString?: string | null,
  selector = ':root',
): string | undefined {
  let groups = parseCssGroups(cssString);
  if (!groups?.size) {
    return;
  }
  let rules = groups.get(normalizeSelector(selector) ?? ':root');
  if (!rules?.size) {
    return;
  }
  return [...rules.entries()]
    .filter(([property]) => property.startsWith('--'))
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');
}

// ── Scoping the stylesheet ───────────────────────────────────────────────
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

/**
 * Derives a `data-boxel-theme-scope` value from a theme's identity plus a
 * fingerprint of its CSS. Every element sharing a theme gets the same scope,
 * so their emitted stylesheets are byte-identical — harmless as duplicate
 * rules, and dedupable by consumers. The content hash keeps scopes from
 * *different versions* of a theme distinct: prerendered fragments are cached
 * at different times, so a page can mix a card captured before a theme edit
 * with one captured after, and because the scoped rules are page-global,
 * equal scopes with unequal declarations would restyle each other's cards.
 */
export function themeScope(
  themeId: string | null | undefined,
  cssVariables: string | null | undefined,
): string | undefined {
  if (!themeId || !cssVariables) {
    return undefined;
  }
  return `${themeId}-${fingerprint(cssVariables)}`;
}

/**
 * Builds a theme stylesheet scoped to `scope` (a `data-boxel-theme-scope`
 * value). The theme's `:root` variables apply by default; its `.dark`
 * variables take over via a CSS style container query on
 * `--boxel-color-scheme` — an inherited signal the theme (theme.css) sets on
 * each `[data-theme]` element. Because that signal inherits, the query
 * resolves to the *nearest* ancestor's color scheme, so per-subtree overrides
 * (dark pages, light islands, nested) all work with no JS and no !important.
 * Scheme switches stamped *inside* the scope get the same palettes through
 * descendant rules instead (see below). A theme with no `.dark` block simply
 * keeps its light values.
 */
export function themeScopedCss(
  scope?: string,
  cssVariables?: string | null,
): SafeString {
  if (!scope || !cssVariables) {
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
  // Scheme islands the scoped template stamps (`data-theme` or `.dark` on an
  // element inside the container) sit below the scope element, so the
  // container query above — which resolves against the scope's ancestors —
  // never sees them, while theme.css's own scheme blocks do and re-declare the
  // whole contract there. Re-emit the palettes on those descendants so the
  // theme wins there too: `:scope` lifts specificity above theme.css's
  // single-selector blocks, which still fill the tokens the theme omits.
  // A dark island gets the root declarations first and the dark ones on top,
  // the same result the scope root has under an ambient dark scheme, where a
  // token the theme defines only at the root keeps its value. The light rule
  // matters as well, or a light island inside a dark subtree would fall back
  // to Boxel's light defaults. The dark rule comes last so an element carrying
  // both markers resolves dark, as it does in theme.css. The `to` limit stops
  // at a nested themed card's boundary so this theme never leaks into islands
  // the nested card stamps: its own stylesheet covers those, or leaves them to
  // the theme.css defaults.
  let lightDeclarations = light ? sanitizeDeclarations(light) : '';
  let darkDeclarations = dark ? sanitizeDeclarations(dark) : '';
  let islands = '';
  if (lightDeclarations) {
    islands += `:scope :is([data-theme="light"],.dark,[data-theme="dark"]){${lightDeclarations}}`;
  }
  if (darkDeclarations) {
    islands += `:scope :is(.dark,[data-theme="dark"]){${darkDeclarations}}`;
  }
  if (islands) {
    css += `@scope (${selector}) to ([data-boxel-theme-scope]){${islands}}`;
  }
  return htmlSafe(css);
}
