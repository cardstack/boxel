function normalizeSelector(selectorName: string): string {
  const selector = selectorName.trim();
  if (selector === ':root' || selector === 'root') {
    return ':root';
  }
  if (selector === '.dark') {
    return '.dark';
  }
  if (selector.startsWith('@theme')) {
    return selector;
  }
  return selector;
}

function parseCssRules(rules: string): Map<string, string> | undefined {
  if (!rules.trim()) {
    return;
  }
  const cssMap = new Map<string, string>();
  const declarations = rules.split(';').filter((decl) => decl.trim());
  for (const declaration of declarations) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex > 0) {
      const property = declaration.substring(0, colonIndex).trim();
      const value = declaration.substring(colonIndex + 1).trim();
      if (property.startsWith('--') || property.match(/^[a-z-]+$/)) {
        cssMap.set(property, value);
      }
    }
  }
  return cssMap;
}

function parseCSSGroups(
  cssString: string,
): Map<string, Map<string, string>> | undefined {
  const groups = new Map<string, Map<string, string>>();
  const css = cssString
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove comments
    .replace(/\s+/g, ' ') // replace multiple spaces with a single space
    .trim();

  if (!css?.length) {
    return;
  }

  const blockRegex = /(.*?)\{(.*?)\}/g;
  let matches = [...css.matchAll(blockRegex)];
  if (!matches?.length) {
    const rules = parseCssRules(css);
    if (rules) {
      groups.set(':root', rules);
    }
  } else {
    for (let match of matches) {
      const selector = match[1].trim()
        ? normalizeSelector(match[1].trim())
        : ':root';
      const rules = parseCssRules(match[2].trim());
      if (rules?.size) {
        groups.set(selector, rules);
      }
    }
  }
  return groups;
}

export function extractCssVariables(cssString?: string | null) {
  try {
    if (!cssString?.trim()?.length) {
      return;
    }
    const groups = parseCSSGroups(cssString);
    const rootRules = groups?.get(':root'); // only considering :root for now
    // TODO: handle dark mode and other theme selectors (for branding etc)
    if (!rootRules?.size) {
      return;
    }
    const inlineDeclarations: string[] = [];
    for (const [property, value] of rootRules) {
      if (property.startsWith('--')) {
        inlineDeclarations.push(`${property}: ${value}`);
      }
    }
    return inlineDeclarations.join('; ');
  } catch (e) {
    console.error('Error extracting CSS variables:', e);
    return;
  }
}

export const styleConversions = `/* spacing */
--boxel-spacing: calc(var(--spacing, var(--_boxel-sp-unit)) * 4);
--boxel-sp-6xs: calc(var(--boxel-sp-5xs) / var(--boxel-ratio));
--boxel-sp-5xs: calc(var(--boxel-sp-4xs) / var(--boxel-ratio));
--boxel-sp-4xs: calc(var(--boxel-sp-xxxs) / var(--boxel-ratio));
--boxel-sp-xxxs: calc(var(--boxel-sp-xxs) / var(--boxel-ratio));
--boxel-sp-xxs: calc(var(--boxel-sp-xs) / var(--boxel-ratio));
--boxel-sp-xs: calc(var(--boxel-sp-sm) / var(--boxel-ratio));
--boxel-sp-sm: calc(var(--boxel-sp) / var(--boxel-ratio));
--boxel-sp: var(--boxel-spacing);
--boxel-sp-lg: calc(var(--boxel-sp) * var(--boxel-ratio));
--boxel-sp-xl: calc(var(--boxel-sp-lg) * var(--boxel-ratio));
--boxel-sp-xxl: calc(var(--boxel-sp-xl) * var(--boxel-ratio));
--boxel-sp-xxxl: calc(var(--boxel-sp-xxl) * var(--boxel-ratio));
/* border-radius */
--boxel-border-radius-xxs: calc(var(--boxel-border-radius-xs) - 2.5px);
--boxel-border-radius-xs: calc(var(--boxel-border-radius-sm) - 3px);
--boxel-border-radius-sm: calc(var(--boxel-border-radius) - 3px);
--boxel-border-radius: var(--radius, var(--_boxel-radius));
--boxel-border-radius-lg: calc(var(--boxel-border-radius) + 2px);
--boxel-border-radius-xl: calc(var(--boxel-border-radius-lg) + 3px);
--boxel-border-radius-xxl: calc(var(--boxel-border-radius-xl) + 5px);
--boxel-form-control-border-radius: var(--radius, var(--_boxel-radius));`;
