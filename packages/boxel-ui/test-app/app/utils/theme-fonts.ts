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

export function fontFamiliesFrom(cssVariables: string): string[] {
  let families = new Set<string>();
  for (let [, value] of cssVariables.matchAll(
    /--font-[a-z-]+\s*:\s*([^;}]+)/g,
  )) {
    for (let raw of value.split(',')) {
      let name = raw.trim().replace(/^['"]+|['"]+$/g, '');
      if (name && !NON_WEBFONT_FAMILIES.has(name.toLowerCase())) {
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
export function loadThemeFonts(cssVariables: string): void {
  for (let family of fontFamiliesFrom(cssVariables)) {
    let id = `theme-font-${family.toLowerCase().replace(/\s+/g, '-')}`;
    if (document.getElementById(id)) {
      continue;
    }
    let link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      family,
    ).replace(/%20/g, '+')}&display=swap`;
    document.head.append(link);
  }
}
