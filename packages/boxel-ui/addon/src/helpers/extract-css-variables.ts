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

function parseCssRules(rules?: string): Map<string, string> | undefined {
  if (!rules?.trim()) {
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
      const selector = match[1]?.trim()
        ? normalizeSelector(match[1].trim())
        : ':root';
      const rules = parseCssRules(match[2]?.trim());
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
