// boxel-cli identifies its listener by port, not by handing over a URL, so the
// only address this page can ever send a session to is loopback on this
// machine. That leaves nothing to distrust about the destination — the checks
// here are just that the port and nonce are well formed.
//
// Must match CALLBACK_PATH in packages/boxel-cli/src/lib/sso-login.ts.
const CALLBACK_PATH = '/callback';

// Hex from randomBytes today; the bound is loose enough to survive a change of
// nonce format without becoming a second place to edit.
const STATE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function cliAuthLoopbackUrl(
  port: string | null | undefined,
  state: string | null | undefined,
): string | undefined {
  if (!port || !/^\d{1,5}$/.test(port)) {
    return undefined;
  }
  let portNumber = Number(port);
  // Port 0 means "any free port" to a listener, so it is never a real target.
  if (portNumber < 1 || portNumber > 65535) {
    return undefined;
  }
  if (!state || !STATE_PATTERN.test(state)) {
    return undefined;
  }
  let url = new URL(`http://127.0.0.1:${portNumber}${CALLBACK_PATH}`);
  url.searchParams.set('state', state);
  return url.href;
}
