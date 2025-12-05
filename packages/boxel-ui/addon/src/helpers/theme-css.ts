import { dasherize } from './string.ts';

export type CssRuleMap = Map<string, string>; // css property(css variable name)-value map
export type CssGroups = Map<string, CssRuleMap>; // string is css selector (block name)

export interface CssVariableEntry {
  name?: string | null;
  value?: string | null;
}

export interface CssGroupInput {
  entries?: CssVariableEntry[] | null;
  rules?: CssRuleMap | null;
  selector?: string | null;
}

export interface BuildCssVariableNameOptions {
  prefix?: string;
}

// Ensures every custom property name is trimmed and prefixed with `--`.
const normalizeCssVariableName = (name?: string | null): string | undefined => {
  const trimmed = name?.trim();
  if (!trimmed) {
    return;
  }
  return trimmed.startsWith('--') ? trimmed : `--${trimmed}`;
};

// Normalizes any loose identifier (including leading `--`) into a dasherized segment.
const normalizeCssVariableSegment = (segment?: string | null) => {
  const trimmed = segment?.toString()?.trim();
  if (!trimmed) {
    return;
  }
  const withoutPrefix = trimmed.startsWith('--') ? trimmed.slice(2) : trimmed;
  const normalized = dasherize(withoutPrefix);
  return normalized || undefined;
};

// Produces a dasherized CSS variable name (prefixed with `--`) from a string input and optional string prefix.
export function buildCssVariableName(
  name?: string | null,
  options?: BuildCssVariableNameOptions,
): string {
  const normalizedName = normalizeCssVariableSegment(name);
  if (!normalizedName) {
    return '';
  }

  const normalizedPrefix = normalizeCssVariableSegment(options?.prefix);
  return normalizedPrefix
    ? `--${normalizedPrefix}-${normalizedName}`
    : `--${normalizedName}`;
}

// Standardizes rule values by trimming and removing trailing semicolons.
export const normalizeCssValue = (
  value?: string | null,
): string | undefined => {
  if (value == null) {
    return;
  }
  const normalized = `${value}`.trim().replace(/[;\s]+$/, '');
  return normalized ? normalized : undefined;
};

// Collapses selector aliases (like `root`) into their canonical form.
export const normalizeSelector = (
  selector?: string | null,
): string | undefined => {
  const trimmed = selector?.trim();
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
};

// Adds a rule to the map only when both name and value normalize successfully.
const addNormalizedRule = (
  map: CssRuleMap,
  name?: string | null,
  value?: string | null,
) => {
  const normalizedName = normalizeCssVariableName(name);
  const normalizedValue = normalizeCssValue(value);
  if (!normalizedName || !normalizedValue) {
    return;
  }
  map.set(normalizedName, normalizedValue);
};

// Builds a rule map from arbitrary entries, discarding anything that fails normalization.
export function entriesToCssRuleMap(
  entries?: CssVariableEntry[] | null,
): CssRuleMap {
  if (!entries?.length) {
    return new Map();
  }
  const map: CssRuleMap = new Map();
  for (let entry of entries) {
    addNormalizedRule(map, entry?.name, entry?.value);
  }
  return map;
}

// Normalizes an existing rule map by revalidating every name/value pair.
export function normalizeCssRuleMap(rules?: CssRuleMap | null): CssRuleMap {
  if (!rules?.size) {
    return new Map();
  }
  const map: CssRuleMap = new Map();
  for (let [name, value] of rules.entries()) {
    addNormalizedRule(map, name, value);
  }
  return map;
}

// Converts loosely structured group inputs into normalized selector-rule pairs.
export function buildCssGroups(inputs?: CssGroupInput[] | null): CssGroups {
  const groups: CssGroups = new Map();
  if (!inputs?.length) {
    return groups;
  }
  for (let input of inputs) {
    const selector = normalizeSelector(input?.selector);
    if (!selector) {
      console.warn(
        'buildCssGroups: skipping group because selector "%s" is invalid',
        input?.selector,
      );
      continue;
    }
    const initialRules = input.rules?.size
      ? normalizeCssRuleMap(input.rules)
      : entriesToCssRuleMap(input.entries);
    if (initialRules.size) {
      groups.set(selector, initialRules);
    }
  }
  return groups;
}
