// Generic keywords and ubiquitous system fonts that should never be fetched
// from Google Fonts. Anything else unknown is requested anyway — a family
// Google doesn't have just fails its own stylesheet request, which is
// harmless and leaves the theme's fallback stack in effect.
const NON_WEBFONT_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'math',
  'emoji',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'arial',
  'helvetica',
  'helvetica neue',
  'georgia',
  'times',
  'times new roman',
  'courier',
  'courier new',
  'menlo',
  'monaco',
  'consolas',
  'sfmono-regular',
  'liberation mono',
  'segoe ui',
]);

// Values of every `--font-*` custom property in the given CSS.
export function fontStacksFromCss(css: string): string[] {
  return [...css.matchAll(/--font-[a-z-]+\s*:\s*([^;}]+)/g)].map(
    ([, value]) => value ?? '',
  );
}

export function webFontFamiliesFrom(
  fontStacks: (string | null | undefined)[],
): string[] {
  let families = new Set<string>();
  for (let stack of fontStacks) {
    if (!stack) {
      continue;
    }
    for (let raw of stack.split(',')) {
      let name = raw.trim().replace(/^['"]+|['"]+$/g, '');
      // A parenthesis marks a var()/env() reference—or a fragment of one,
      // since splitting on commas shreds var(--x, fallback)—not a family.
      if (!name || /[()]/.test(name)) {
        continue;
      }
      if (!NON_WEBFONT_FAMILIES.has(name.toLowerCase())) {
        families.add(name);
      }
    }
  }
  return [...families];
}

// Requests only the regular (400) face: asking for specific weights 400s the
// whole request when a static family lacks one, whereas a bare family name
// always resolves. Browsers synthesize bold/italic from it if the theme
// needs them.
export function googleFontImportUrl(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family,
  ).replace(/%20/g, '+')}&display=swap`;
}

export function googleFontImportsFor(
  fontStacks: (string | null | undefined)[],
): string[] {
  return webFontFamiliesFrom(fontStacks).map(googleFontImportUrl);
}
