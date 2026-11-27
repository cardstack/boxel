// What the CLI says when a profile signed in with OAuth asks for something an
// OAuth token can't do. Each is refused before any request is made.

const USE_MATRIX =
  'Use a profile signed in with Matrix for now: `boxel profile add` without --oauth.';

export const OAUTH_REFUSALS = {
  runCommand:
    "Running a command doesn't work on a profile signed in with OAuth yet: the realm server doesn't let an OAuth token run commands. " +
    USE_MATRIX,
  capture:
    "`boxel capture` doesn't work on a profile signed in with OAuth yet: the realm server doesn't let an OAuth token capture cards. " +
    USE_MATRIX,
  browse:
    "`boxel browse` can't sign a browser in from a profile signed in with OAuth: that takes a Matrix login token, which this profile doesn't have. " +
    'A published realm still opens without signing in. ' +
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
  runCommand:
    "\nNeeds a profile signed in with Matrix: the realm server doesn't let an OAuth token run commands yet.\n",
  capture:
    "\nNeeds a profile signed in with Matrix: the realm server doesn't let an OAuth token capture cards yet.\n",
  browse:
    "\nSigning a browser in needs a profile signed in with Matrix: it takes a Matrix login token, which a profile signed in with OAuth doesn't have. A published-realm card URL opens on any profile.\n",
} as const;

// What a profile signed in with OAuth can't do yet, by command.
export const OAUTH_UNAVAILABLE_COMMANDS = [
  'run-command',
  'capture',
  'browse',
  'realm list --hidden',
  'realm list --all-accessible',
] as const;
