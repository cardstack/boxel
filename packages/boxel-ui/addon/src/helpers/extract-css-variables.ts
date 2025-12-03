import {
  type CssGroups,
  type CssRuleMap,
  normalizeCssValue,
  normalizeSelector,
} from './theme-css.ts';

const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const BLOCK_PATTERN = /(.*?)\{([\s\S]*?)\}/g;
const PROPERTY_PATTERN = /^[a-z\d-]+$/i;

// Turns a CSS declaration block into a property-value map.
const parseCssDeclarations = (rules?: string): CssRuleMap | undefined => {
  if (!rules?.trim()) {
    return;
  }

  const cssMap: CssRuleMap = new Map();
  let normalizedRules = rules
    .split(';')
    .map((rule) => rule.replace(/[\r\n]+/g, ' ').trim())
    .map((rule) => rule.replace(/\s{2,}/g, ' '))
    .filter(Boolean);

  const entries: Array<[string, string]> = [];
  for (const declaration of normalizedRules) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    const property = declaration.slice(0, colonIndex).trim();
    const value = declaration.slice(colonIndex + 1).trim();
    if (
      !property ||
      (!property.startsWith('--') && !PROPERTY_PATTERN.test(property))
    ) {
      continue;
    }
    const normalizedValue = normalizeCssValue(value);
    if (!normalizedValue) {
      continue;
    }
    entries.push([property, normalizedValue]);
  }

  entries.sort(([a], [b]) => a.localeCompare(b));
  for (const [property, normalizedValue] of entries) {
    cssMap.set(property, normalizedValue);
  }

  return cssMap.size ? cssMap : undefined;
};

// Groups selectors and their declaration maps from raw CSS text.
export function parseCssGroups(
  cssString?: string | null,
): CssGroups | undefined {
  const sanitized = cssString
    ? cssString.replace(COMMENT_PATTERN, ' ').trim()
    : '';
  if (!sanitized) {
    return;
  }

  const groups: CssGroups = new Map();
  for (const match of sanitized.matchAll(BLOCK_PATTERN)) {
    const selectorSource = match[1]?.trim();
    const selector = selectorSource
      ? (normalizeSelector(selectorSource) ?? ':root')
      : ':root';
    const rules = parseCssDeclarations(match[2]);
    if (!rules?.size) {
      continue;
    }
    const existing = groups.get(selector) ?? new Map();
    for (const [property, value] of rules) {
      existing.set(property, value);
    }
    groups.set(selector, existing);
  }

  if (!groups.size) {
    const fallbackRules = parseCssDeclarations(sanitized);
    if (fallbackRules?.size) {
      groups.set(':root', fallbackRules);
    }
  }

  return groups.size ? groups : undefined;
}

// Returns the variables for a requested selector as `--name: value;` string.
export function extractCssVariables(
  cssString?: string | null,
  selector = ':root',
): string | undefined {
  try {
    const groups = parseCssGroups(cssString);
    if (!groups?.size) {
      return;
    }

    const normalizedSelector = selector
      ? (normalizeSelector(selector) ?? ':root')
      : ':root';
    const rules = groups.get(normalizedSelector);
    if (!rules?.size) {
      return;
    }
    return [...rules.entries()]
      .filter(([property]) => property.startsWith('--'))
      .map(([property, value]) => `${property}: ${value}`)
      .join('; ');
  } catch (error) {
    console.error('Error extracting CSS variables:', error);
    return;
  }
}
