// True for `https://localhost[:port]`, `https://127.0.0.1[:port]`,
// `https://[::1][:port]`, or any `https://*.localhost[:port]` —
// the only origins where the local mkcert leaf is expected. Per
// RFC 6761, names under `.localhost` are reserved as loopback,
// which is what env-mode uses for Traefik routing (e.g.
// `realm-server.<slug>.localhost`). Used to gate
// `--ignore-certificate-errors` / `--allow-insecure-localhost` on
// puppeteer chrome launches so the relaxation fires only in local
// dev / CI; production hits real hostnames with real CA-signed
// certs and must keep strict validation.
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
    parsed.hostname.endsWith('.localhost') ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]' ||
    parsed.hostname === '::1'
  );
}
