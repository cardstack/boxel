// What the CLI says when a profile signed in with OAuth asks for something an
// OAuth token can't do. Each is refused before any request is made.

const USE_MATRIX =
  'Use a profile signed in with Matrix for now: `boxel profile add` without --oauth.';

export const OAUTH_REFUSALS = {
  captureUrlOnly:
    "`boxel capture --url-only` doesn't work on a profile signed in with OAuth: the realm server answers an OAuth app's capture with its bytes and no served URL. " +
    'Run it without --url-only to save the capture, or with --realm-secret-seed.',
  browse:
    "`boxel browse` can't sign a browser in from a profile signed in with OAuth: that takes a Matrix login token, which this profile doesn't have. " +
    'A published realm still opens without signing in. ' +
    USE_MATRIX,
  serverToken:
    "getServerToken() needs a profile signed in with Matrix: the realm server doesn't let an OAuth token spend AI credits yet.",
} as const;

// The same limits, said up front: in each command's help, and beside a profile
// signed in with OAuth in `boxel profile list`.
export const OAUTH_HELP_NOTES = {
  runCommand:
    '\nOn a profile signed in with OAuth, running a command needs the connection to allow writing (boxel:write).\n',
  capture:
    "\n--url-only doesn't work on a profile signed in with OAuth: the realm server answers an OAuth app's capture with its bytes and no served URL.\n",
  browse:
    "\nSigning a browser in needs a profile signed in with Matrix: it takes a Matrix login token, which a profile signed in with OAuth doesn't have. A published-realm card URL opens on any profile.\n",
} as const;

// What a profile signed in with OAuth can't do yet, by command.
export const OAUTH_UNAVAILABLE_COMMANDS = [
  'capture --url-only',
  'browse',
  'realm list --hidden',
  'realm list --all-accessible',
] as const;

// A realm server refuses an OAuth token whose connection doesn't allow what a
// route needs with `403` and a bearer challenge naming `insufficient_scope`
// and the scopes the route needs (RFC 6750 §3). Returns what to tell the user
// for such a response, and undefined for any other.
export function describeInsufficientScope(
  response: Response,
  action: string,
): string | undefined {
  if (response.status !== 403) {
    return undefined;
  }
  let challenge = response.headers.get('www-authenticate') ?? '';
  if (!/error="insufficient_scope"/.test(challenge)) {
    return undefined;
  }
  let needed = /scope="([^"]*)"/.exec(challenge)?.[1];
  return (
    `${action} needs a connection that allows ${needed ? needed.split(' ').join(' or ') : 'more access'}, ` +
    "and this profile's OAuth connection doesn't. Run `boxel profile add --oauth` again and allow it."
  );
}
