import { decodeScopedCSSRequest } from '@cardstack/runtime-common';

// Shared with `boxel-source-classifier.ts`: the classifier routes any
// authored scoped CSS that matches this pattern to the Sandbox tier (a real
// document, where a network-bearing declaration is actually supported)
// instead of Capsule (the shared Host document, where it is forbidden). Both
// layers import this single pattern so their notions of "network-bearing CSS"
// cannot drift apart.
export const networkBearingCSS =
  /(?:@import\b|(?:url|src|image|(?:-webkit-)?image-set|cross-fade|(?:-moz-)?element|paint)\s*\()/i;
const documentGlobalCSS =
  /@(?:font-face|font-feature-values|font-palette-values|property|counter-style|color-profile|page|viewport|(?:-moz-)?document|namespace|view-transition|position-try|scroll-timeline|custom-media|custom-selector)\b/i;
const namedLayerCSS = /@layer\b(?!\s*\{)/i;
// View-transition snapshots are painted in the document top layer, outside
// the Capsule's scoped subtree. A Host transition could otherwise capture a
// named authored element and lift that snapshot above Host chrome.
const topLayerBearingCSS = /\bview-transition-(?:name|class)\s*:/i;
const capsuleBoundarySelector = ':where(.boxel-execution-capsule-slot)';

/**
 * Validate a declaration list before a Capsule template can hand it to
 * Glimmer in the shared Host document.
 *
 * Selector confinement belongs to the scoped-CSS compiler and stylesheet
 * registry. This boundary only admits literal declaration values and rejects
 * every CSS spelling that can initiate a fetch. Dynamic style attributes are
 * classified into the origin-isolated Sandbox before this function runs.
 */
export function validateCapsuleInlineStyle(style: string): string {
  rejectNetworkBearingCSS(style, 'inline style');
  if (typeof CSSStyleSheet === 'undefined') {
    throw new Error('Capsule CSS validation is unavailable');
  }
  let sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(`[data-boxel-capsule-inline] { ${style} }`);
  } catch (error) {
    let detail = error instanceof Error ? `: ${error.message}` : '';
    throw new Error(`Capsule inline style could not be parsed${detail}`);
  }
  let normalized = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
  rejectNetworkBearingCSS(normalized, 'inline style');
  return style;
}

/** Validate compiled Glimmer scoped CSS before installing it in the Host. */
export function validateCapsuleStylesheet(css: string): string {
  rejectNetworkBearingCSS(css, 'stylesheet');
  rejectDocumentGlobalCSS(css);
  if (typeof CSSStyleSheet === 'undefined') {
    throw new Error('Capsule CSS validation is unavailable');
  }
  let sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(css);
  } catch (error) {
    let detail = error instanceof Error ? `: ${error.message}` : '';
    throw new Error(`Capsule stylesheet could not be parsed${detail}`);
  }
  let normalized = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
  rejectNetworkBearingCSS(normalized, 'stylesheet');
  rejectDocumentGlobalCSS(normalized);
  validateScopedRules(sheet.cssRules);
  return css;
}

/**
 * Keep compiled Glimmer styles inside the rendered Capsule island.
 *
 * Glimmer's scope attribute remains the component-level boundary. The
 * additional zero-specificity ancestor protects trusted Host and Base DOM if
 * a scope attribute is reused by a component that also renders in a Capsule.
 */
export function confineCapsuleStylesheet(css: string): string {
  validateCapsuleStylesheet(css);
  let sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  confineScopedRules(sheet.cssRules);
  return [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
}

/**
 * Validate a glimmer-scoped-css request before the ordinary Host Loader runs
 * its registration module. Prerendered placeholders and search results share
 * the Host document even when their live Boxel runs in a Sandbox process.
 *
 * This policy exists to confine AUTHORED, untrusted CSS sharing that
 * document (docs/boxel-execution-runtime-architecture.md, "Trusted
 * Cardstack components are one-way portals"): trusted Cardstack components
 * — Base, Catalog, `@cardstack/*` packages such as Boxel UI — execute as
 * Host-owned portals outside any Capsule confinement, so their own compiled
 * scoped CSS (component resets, named `@layer`s, `:global()` selectors that
 * intentionally opt out of scoping) is Host-trusted styling, never authored
 * content that could be smuggled into the shared document. `isTrustedModule`
 * identifies the request's origin module (`decodeScopedCSSRequest`'s
 * `fromFile`) against that same trust boundary and, when it is trusted,
 * exempts the request from the policy instead of misapplying an
 * authored-content check to it. Callers that omit the predicate keep the
 * strict, always-validate behavior.
 */
export function validateSharedDocumentScopedCSSRequest(
  request: string,
  isTrustedModule?: (moduleIdentifier: string) => boolean,
): string {
  let decoded = decodeScopedCSSRequest(request);
  if (isTrustedModule?.(decoded.fromFile)) {
    return request;
  }
  validateCapsuleStylesheet(decoded.css);
  return request;
}

function validateScopedRules(rules: CSSRuleList): void {
  for (let rule of rules) {
    if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
      let admitAsThemeTokens = ruleDeclaresOnlyCustomProperties(rule);
      let escapedSelector = splitTopLevelCSSList(rule.selectorText).find(
        (selector) =>
          !selectorIsAnchoredByTopLevelScope(selector) &&
          !(admitAsThemeTokens && isBareThemeScopeSelector(selector)),
      );
      if (escapedSelector) {
        throw new Error(
          `Capsule stylesheet selector escaped its compiled scope: ${escapedSelector.trim()}`,
        );
      }
    }

    // Grouping rules such as @media, @supports, @container, @scope, and an
    // anonymous @layer expose nested cssRules. Keyframe steps are declaration
    // records, not document selectors, and use compiler-namespaced names.
    if (
      !(
        typeof CSSKeyframesRule !== 'undefined' &&
        rule instanceof CSSKeyframesRule
      ) &&
      'cssRules' in rule
    ) {
      validateScopedRules(
        (rule as CSSRule & { cssRules: CSSRuleList }).cssRules,
      );
    }
  }
}

function confineScopedRules(rules: CSSRuleList): void {
  for (let rule of rules) {
    if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
      rule.selectorText = splitTopLevelCSSList(rule.selectorText)
        .map((selector) => `${capsuleBoundarySelector} ${selector.trim()}`)
        .join(', ');
    }

    if (
      !(
        typeof CSSKeyframesRule !== 'undefined' &&
        rule instanceof CSSKeyframesRule
      ) &&
      'cssRules' in rule
    ) {
      confineScopedRules(
        (rule as CSSRule & { cssRules: CSSRuleList }).cssRules,
      );
    }
  }
}

function splitTopLevelCSSList(value: string): string[] {
  let items: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: string | undefined;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    let character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses++;
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === '[') {
      brackets++;
    } else if (character === ']') {
      brackets = Math.max(0, brackets - 1);
    } else if (character === ',' && parentheses === 0 && brackets === 0) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }
  items.push(value.slice(start));
  return items;
}

/**
 * Every selector must be anchored by a compiler scope attribute in its
 * top-level selector path. Glimmer scoped CSS intentionally emits descendant
 * selectors such as `.metric[scope] *`; those descendants remain inside the
 * scoped element and the Capsule island that `confineCapsuleStylesheet` adds.
 * Relational occurrences such as `body:has([scope])` do not establish an
 * anchor, and sibling combinators after the anchor could leave the authored
 * subtree, so both remain forbidden.
 */
function selectorIsAnchoredByTopLevelScope(selector: string): boolean {
  let parentheses = 0;
  let brackets = 0;
  let quote: string | undefined;
  let escaped = false;
  let lastScopeAttribute = -1;
  let firstEscapingSiblingAfterScope = -1;

  for (let index = 0; index < selector.length; index++) {
    let character = selector[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      parentheses++;
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === '[') {
      brackets++;
      if (parentheses !== 0 || brackets !== 1) {
        continue;
      }
      let end = selector.indexOf(']', index + 1);
      if (end === -1) {
        return false;
      }
      let attribute = selector.slice(index + 1, end).trimStart();
      if (attribute.toLowerCase().startsWith('data-scopedcss-')) {
        lastScopeAttribute = index;
        firstEscapingSiblingAfterScope = -1;
      }
      index = end;
      brackets--;
    } else if (
      parentheses === 0 &&
      brackets === 0 &&
      lastScopeAttribute !== -1 &&
      (character === '+' || character === '~')
    ) {
      firstEscapingSiblingAfterScope = index;
    }
  }
  return lastScopeAttribute !== -1 && firstEscapingSiblingAfterScope === -1;
}

// `themeScope()`/`themeScopedCss()` (@cardstack/boxel-ui/helpers/
// theme-scoped-css.ts) generate a card's theme stylesheet at runtime, not at
// compile time: `[data-boxel-theme-scope="<themeId>-<fingerprint>"]{ --foo:
// bar; }`, with the `.dark` half of the theme wrapped in `@container
// style(--boxel-color-scheme: dark){ ... }`. That scope value is a
// content-addressed hash a card cannot forge into colliding with another
// theme, and a Capsule cannot expand a compiled `[data-scopedcss-*]`
// attribute onto text it never compiled — so this selector shape is
// legitimate but can never carry the compiler's own anchor. It is admitted
// as a second, narrower anchor: only as the theme generator's own bare
// attribute selector (`isBareThemeScopeSelector`), and only when every
// declaration the rule carries is a custom property (`ruleDeclaresOnly
// CustomProperties`), so acceptance stays a token pipe rather than a second
// general escape hatch — the rule can supply `--background`, never
// `background`.
const themeScopeAttributeSelector =
  /^\s*\[\s*data-boxel-theme-scope\s*=\s*(?:"[^"]*"|'[^']*')\s*\]\s*$/;

function isBareThemeScopeSelector(selector: string): boolean {
  return themeScopeAttributeSelector.test(selector);
}

function ruleDeclaresOnlyCustomProperties(rule: CSSStyleRule): boolean {
  let declarations = rule.style;
  if (declarations.length === 0) {
    return false;
  }
  for (let index = 0; index < declarations.length; index++) {
    if (!declarations[index]!.startsWith('--')) {
      return false;
    }
  }
  return true;
}

function rejectDocumentGlobalCSS(css: string): void {
  let decoded = decodeCSSForPolicy(css);
  if (
    documentGlobalCSS.test(decoded) ||
    namedLayerCSS.test(decoded) ||
    topLayerBearingCSS.test(decoded)
  ) {
    throw new Error('Capsule stylesheet contains a document-global rule');
  }
}

function rejectNetworkBearingCSS(css: string, kind: string): void {
  if (networkBearingCSS.test(decodeCSSForPolicy(css))) {
    throw new Error(`Capsule ${kind} contains a network-bearing value`);
  }
}

function decodeCSSForPolicy(css: string): string {
  return css
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, hex: string) =>
      String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)),
    )
    .replace(/\\([^\r\n\f0-9a-f])/gi, '$1')
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}
