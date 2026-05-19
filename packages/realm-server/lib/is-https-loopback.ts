// True for `https://localhost[:port]`, `https://127.0.0.1[:port]`, or
// `https://[::1][:port]` — the only origins where the local mkcert
// leaf is expected. Used to gate `--ignore-certificate-errors` /
// `--allow-insecure-localhost` on puppeteer chrome launches so the
// relaxation fires only in local dev / CI; production hits real
// hostnames with real CA-signed certs and must keep strict
// validation.
export function isHttpsLoopback(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return (
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]' ||
    parsed.hostname === '::1'
  );
}
