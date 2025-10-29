export function ensureExtension(
  url: string,
  options: { default: string } = { default: '.gts' },
): string {
  if (!url) return url;
  if (!url.match(/\.[a-zA-Z0-9]+$/)) {
    return url + options.default;
  }
  return url;
}
