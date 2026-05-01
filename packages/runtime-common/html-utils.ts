export function cleanCapturedHTML(html: string): string {
  if (!html) {
    return html;
  }
  const emberIdAttr = /\s+id=(?:"ember\d+"|'ember\d+'|ember\d+)(?=[\s>])/g;
  const emptyDataAttr = /\s+(data-[A-Za-z0-9:_-]+)=(?:""|''|(?=[\s>]))/g;
  let cleaned = html.replace(emberIdAttr, '');
  cleaned = cleaned.replace(emptyDataAttr, ' $1');
  return cleaned;
}

// Extract the og:title content attribute from a head HTML fragment.
// Tolerates either attribute order (property-then-content or
// content-then-property). Returns null when no match is found or input is
// nullish.
export function extractOgTitle(
  headHTML: string | null | undefined,
): string | null {
  if (typeof headHTML !== 'string') return null;
  let match =
    headHTML.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
    ) ??
    headHTML.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i,
    );
  return match ? match[1] : null;
}
