interface CssVariable {
  property: string;
  value?: string | null;
}

type CssRule = string; // `--property: value;`

interface CssBlockInput {
  blockname: string;
  vars?: CssVariable[];
}

function generateCssRuleString(
  property?: string | null,
  value?: string | null,
): CssRule | undefined {
  let prop = property?.toString()?.trim();
  let val = value?.toString()?.trim()?.replace(';', '');
  if (!prop || !val) {
    return;
  }
  if (!prop.startsWith('--')) {
    prop = `--${prop}`;
  }
  return ` ${prop}: ${val};`;
}

function generateCssBlockRules(vars?: CssVariable[]): CssRule[] | [] {
  const cssRules: CssRule[] = [];
  vars?.map(({ property, value }) => {
    let rule = generateCssRuleString(property, value);
    if (rule?.length) {
      cssRules.push(rule);
    }
  });
  return cssRules;
}

function generateCSSBlockString(
  blockName: string,
  ruleList: CssRule[] | [] | undefined,
): string | undefined {
  if (!ruleList || ruleList?.length === 0) {
    return;
  }
  return `${blockName} {\n${ruleList.join('\n')}\n}`;
}

export function generateCssVariables(blockInputs: CssBlockInput[]): string {
  const blocks: string[] = [];
  for (let { blockname, vars } of blockInputs) {
    const ruleList = generateCssBlockRules(vars);
    const blockString = generateCSSBlockString(blockname, ruleList);
    if (blockString) {
      blocks.push(blockString);
    }
  }
  if (blocks.length === 0) {
    return '';
  }
  return blocks.join('\n\n');
}
