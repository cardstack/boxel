import {
  type CssGroups,
  type CssRuleMap,
  normalizeCssRuleMap,
} from './theme-css.ts';

const generateCssBlockString = (
  selector: string,
  rules: CssRuleMap,
): string | undefined => {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector || !rules.size) {
    return;
  }

  const normalizedRules = normalizeCssRuleMap(rules);
  if (!normalizedRules.size) {
    return;
  }

  const lines: string[] = [];
  for (let [property, value] of normalizedRules.entries()) {
    lines.push(`  ${property}: ${value};`);
  }

  if (!lines.length) {
    return;
  }

  return `${trimmedSelector} {\n${lines.join('\n')}\n}`;
};

export function generateCssVariables(groups?: CssGroups | null): string {
  if (!groups?.size) {
    return '';
  }

  const blocks: string[] = [];
  for (let [selector, rules] of groups.entries()) {
    const block = generateCssBlockString(selector, rules);
    if (block) {
      blocks.push(block);
    }
  }

  return blocks.join('\n\n');
}
