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
    "getServerToken() needs a profile signed in with Matrix: the realm server doesn't let an OAuth token spend AI credits yet.",
} as const;
