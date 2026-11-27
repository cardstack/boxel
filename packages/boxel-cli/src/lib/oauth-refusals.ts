// What the CLI says when a profile signed in with OAuth asks for something an
// OAuth token can't do. Each is refused before any request is made.

const USE_MATRIX =
  'Use a profile signed in with Matrix for now: `boxel profile add` without --oauth.';

export const OAUTH_REFUSALS = {
  captureUrlOnly:
    "`boxel capture --url-only` doesn't work on a profile signed in with OAuth: the realm server answers an OAuth app's capture with its bytes and no served URL. " +
    'Run it without --url-only to save the capture. ' +
    USE_MATRIX,
  serverToken:
    'getServerToken() needs a profile signed in with Matrix: a profile signed in with OAuth has no realm-server session to give out. ' +
    'Call the realm server through authedServerFetch() instead, on a profile that may spend AI credits for the routes that spend them.',
  aiCredits:
    "This profile can't spend AI credits. Sign in again with `boxel profile add --oauth --allow-ai-credits`.",
} as const;

// Thrown, before any request or in place of the realm server's refusal, when a
// profile signed in with OAuth calls a route that spends AI credits without
// `boxel:spend-credit`.
export class AiCreditsNotAllowedError extends Error {
  constructor() {
    super(OAUTH_REFUSALS.aiCredits);
    this.name = 'AiCreditsNotAllowedError';
  }
}

// The same limits, said up front: in each command's help, and beside a profile
// signed in with OAuth in `boxel profile list`.
export const OAUTH_HELP_NOTES = {
  capture:
    "\n--url-only doesn't work on a profile signed in with OAuth: the realm server answers an OAuth app's capture with its bytes and no served URL.\n",
  browse:
    "\nOn a profile signed in with OAuth, the app opens as the profile's account and asks you to sign in when the browser isn't already that account: the profile has no Matrix login token to sign it in with. A profile signed in with Matrix opens it already signed in. A published-realm card URL opens on any profile.\n",
} as const;

// What a profile signed in with OAuth can't do yet, by command.
export const OAUTH_UNAVAILABLE_COMMANDS = [
  'capture --url-only',
  'realm list --hidden',
  'realm list --all-accessible',
] as const;

// A realm server refuses an OAuth token whose connection doesn't allow what a
// route needs with `403` and a bearer challenge naming `insufficient_scope`
// and the scopes that would admit it (RFC 6750 §3). The CLI's own sign-in
// always asks for `boxel:read` and `boxel:write`, so this mostly guards a
// connection made another way. A challenge naming no scope means no OAuth
// token can do it at all, such as a route that needs the realm's administer
// permission. Returns what to tell the user for such a response, and
// undefined for any other.
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
  let needed = /scope="([^"]*)"/.exec(challenge)?.[1]?.trim();
  if (!needed) {
    return `${action} can't be done with an OAuth connection. ${USE_MATRIX}`;
  }
  return (
    `${action} needs a connection that allows ${needed.split(/\s+/).join(' or ')}, ` +
    "and this profile's OAuth connection doesn't. Run `boxel profile add --oauth` again to get one that does."
  );
}
