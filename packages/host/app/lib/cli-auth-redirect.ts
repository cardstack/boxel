// boxel-cli asks this app to send a session back to a listener it runs on the
// machine the user is sitting at. That target arrives as a query parameter, so
// it is attacker-controllable: without this check the page would be an open
// redirect that hands a Matrix session to any origin that can talk a user into
// following a link. Only loopback is ever a legitimate target.
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export function isLoopbackRedirect(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  // A loopback listener is plain HTTP; anything else is not the CLI.
  if (url.protocol !== 'http:') {
    return false;
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
    return false;
  }
  // `http://127.0.0.1@evil.example.com/` parses with hostname evil.example.com,
  // so the hostname check above already covers it — but credentials in a
  // redirect target have no legitimate use here either way.
  if (url.username || url.password) {
    return false;
  }
  return true;
}
