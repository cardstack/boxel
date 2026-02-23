export function canonicalURL(url: string, relativeTo?: string): string {
  try {
    let parsed = new URL(url, relativeTo);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}
