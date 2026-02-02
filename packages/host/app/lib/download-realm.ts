export function extractFilename(
  contentDisposition: string | null,
): string | null {
  if (!contentDisposition) {
    return null;
  }
  let utf8Match = contentDisposition.match(/filename\\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  let match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? null;
}

export function fallbackDownloadName(realmURL: URL) {
  let segments = realmURL.pathname.split('/').filter(Boolean);
  let base =
    segments.length >= 2
      ? segments.slice(-2).join('-')
      : (segments[0] ?? realmURL.hostname);
  base = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base.length > 0 ? `${base}.zip` : 'realm.zip';
}
