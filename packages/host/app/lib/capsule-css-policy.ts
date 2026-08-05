const networkBearingCSS =
  /(?:@import\b|(?:url|src|image|(?:-webkit-)?image-set|cross-fade|(?:-moz-)?element|paint)\s*\()/i;

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
  if (!/\[data-scopedcss-[a-z0-9-]+/i.test(css)) {
    throw new Error('Capsule stylesheet is missing its compiled scope');
  }
  if (/@(?:import|namespace|charset)\b/i.test(decodeCSSForPolicy(css))) {
    throw new Error('Capsule stylesheet contains a global at-rule');
  }
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
  return css;
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
