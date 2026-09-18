import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { describeDuration } from '@cardstack/runtime-common/cli-auth';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type Profile,
  type ProfileManager,
} from '../lib/profile-manager.ts';
import {
  requestLoginToken as defaultRequestLoginToken,
  MatrixAuthError,
  MatrixRateLimitError,
} from '../lib/auth.ts';
import { resolveAnonymousBrowseUrl as defaultResolveAnonymousBrowseUrl } from '../lib/published-realm.ts';
import { openBrowser } from '../lib/open-browser.ts';
import { FG_RED, RESET } from '../lib/colors.ts';
import { cliLog } from '../lib/cli-log.ts';

// The standard local dev URLs. The realm server and the host app dev server run
// on different ports, and the browser session lives in origin-scoped storage,
// so the login token must be redeemed on the host app's origin (`4200`), not the
// realm server's (`4201`). Deployed environments serve both from one origin, so
// there the host app URL is just the realm server URL.
const LOCAL_REALM_SERVER_URL = 'https://localhost:4201/';
const LOCAL_HOST_APP_URL = 'https://localhost:4200/';

// Login-token minting is rate-limited to ~1/min per account (see
// MatrixRateLimitError). When the reported wait is this short or under, auto-wait
// and retry once so genuine back-to-back opens "just work".
const SHORT_WAIT_MS = 5000;
// Sanity cap on any single wait: retry_after for a 1/min limit is ≤ ~60s, so this
// only guards against a pathological server value blocking the command forever.
const MAX_WAIT_MS = 90000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// The clear, actionable message shown when we won't (or can't) wait out a
// login-token rate limit. Names the limit and the wait, and points at `--wait`.
function rateLimitMessage(retryAfterMs: number | undefined): string {
  let when =
    retryAfterMs !== undefined
      ? `Try again in ~${describeDuration(retryAfterMs)}`
      : 'Try again shortly';
  return (
    `Login-token minting is rate-limited to about once per minute per account ` +
    `(a Matrix anti-abuse limit that can't be raised). ${when} — or re-run with ` +
    `\`--wait\` to block and retry automatically.`
  );
}

/**
 * Derive the origin that serves the host app for a profile.
 *
 * `--host-url` wins when given (the only way to reach env-slug `.localhost`
 * environments, which store no host-URL convention). Otherwise: standard local
 * dev maps the realm-server port to the host dev-server port; every other
 * environment serves the app from the realm-server origin. Exported for unit
 * testing.
 */
export function hostAppUrlForProfile(
  profile: Pick<Profile, 'realmServerUrl'>,
  hostUrlOverride?: string,
): string {
  if (hostUrlOverride) {
    return ensureTrailingSlash(hostUrlOverride);
  }
  let realmServerUrl = ensureTrailingSlash(profile.realmServerUrl);
  if (realmServerUrl === LOCAL_REALM_SERVER_URL) {
    return LOCAL_HOST_APP_URL;
  }
  return realmServerUrl;
}

/**
 * Build the authenticated host-app URL: the login token the host consumes on
 * load, plus an optional `cardPath` to deep-link to a card once signed in.
 * Exported for unit testing.
 */
export function buildBrowseUrl(
  hostUrl: string,
  loginToken: string,
  cardPath?: string,
): string {
  let url = new URL(ensureTrailingSlash(hostUrl));
  url.searchParams.set('loginToken', loginToken);
  if (cardPath) {
    url.searchParams.set('cardPath', cardPath);
  }
  return url.href;
}

export interface BrowseOptions {
  profile?: string;
  hostUrl?: string;
  printUrl?: boolean;
  // Block and retry once when login-token minting is rate-limited, even for a
  // long wait (short waits auto-retry regardless). Capped at MAX_WAIT_MS.
  wait?: boolean;
  // Injectable seams for testing.
  profileManager?: ProfileManager;
  requestLoginToken?: typeof defaultRequestLoginToken;
  resolveAnonymousBrowseUrl?: typeof defaultResolveAnonymousBrowseUrl;
  openBrowserFn?: (url: string) => Promise<boolean>;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

// Resolve the target profile: the named one, or the active one. A missing
// *named* profile is always an error (the user asked for it by name), but a
// missing active profile returns null so the caller can still try the
// anonymous published-realm path — which needs no credentials — before
// insisting on a profile for the token flow.
function resolveProfile(
  pm: ProfileManager,
  profileId: string | undefined,
): { id: string; profile: Profile } | null {
  if (profileId) {
    let profile = pm.getProfile(profileId);
    if (!profile) {
      throw new Error(
        `No profile named "${profileId}". Run \`boxel profile list\` to see your profiles.`,
      );
    }
    return { id: profileId, profile };
  }
  return pm.getActiveProfile();
}

export async function browse(
  cardPath: string | undefined,
  options: BrowseOptions = {},
): Promise<void> {
  let pm = options.profileManager ?? getProfileManager();
  let requestLoginToken = options.requestLoginToken ?? defaultRequestLoginToken;
  let resolveAnonymousBrowseUrl =
    options.resolveAnonymousBrowseUrl ?? defaultResolveAnonymousBrowseUrl;
  let openBrowserFn = options.openBrowserFn ?? openBrowser;
  let log = options.log ?? ((message: string) => console.log(message));
  let sleep = options.sleep ?? defaultSleep;

  let resolved = resolveProfile(pm, options.profile);

  // Fast path: a *published* realm is served on its own origin, which the host
  // renders with no sign-in. When the given card path is such a URL, open it
  // as-is and skip minting a token entirely. A source-realm path always takes
  // the token flow — the live card and its published snapshot are different
  // URLs, so the path states which one the user wants. Only attempted with a
  // card path (bare `browse` has no card to resolve) and without `--host-url`
  // (which explicitly targets the operator app for the token flow).
  //
  // Tried before requiring a profile so a fresh install with no profile can
  // still open an absolute published URL, which needs no credentials.
  if (cardPath && !options.hostUrl) {
    let anonymousUrl = await resolveAnonymousBrowseUrl(
      resolved?.profile.realmServerUrl,
      cardPath,
    );
    if (anonymousUrl) {
      // No credential in this URL — it's a plain public link.
      if (options.printUrl) {
        cliLog.output(anonymousUrl);
        return;
      }
      log(`Opening ${anonymousUrl} (published realm — no sign-in needed)`);
      let opened = await openBrowserFn(anonymousUrl);
      if (!opened) {
        cliLog.warn(
          `Couldn't open a browser automatically. Open this URL:\n  ${anonymousUrl}`,
        );
      }
      return;
    }
  }

  // The token flow needs a profile; the anonymous path above didn't apply, so
  // insist on one now.
  if (!resolved) {
    throw new Error(NO_ACTIVE_PROFILE_ERROR);
  }
  let { id: profileId, profile } = resolved;

  // Mint the login token, recovering once from a rejected access token via the
  // profile manager's interactive re-auth (same pattern as the other commands).
  let mintToken = async () => {
    try {
      return await requestLoginToken(pm.getStoredMatrixAuth(profileId));
    } catch (err) {
      if (!(err instanceof MatrixAuthError)) {
        throw err;
      }
      let freshAuth = await pm.reAuthenticate(profileId);
      return await requestLoginToken(freshAuth);
    }
  };

  // A 429 rate limit is separate from the auth recovery above: re-auth wouldn't
  // help (the limit is per account). Wait+retry once when the wait is short or
  // `--wait` was given; otherwise surface a clear, actionable message. We never
  // fall back to opening the app without a fresh token — the CLI can't tell which
  // account the browser holds, so a tokenless open could land on the wrong one.
  let token;
  try {
    token = await mintToken();
  } catch (err) {
    if (!(err instanceof MatrixRateLimitError)) {
      throw err;
    }
    let { retryAfterMs } = err;
    let shouldWait =
      options.wait === true ||
      (retryAfterMs !== undefined && retryAfterMs <= SHORT_WAIT_MS);
    if (!shouldWait) {
      throw new Error(rateLimitMessage(retryAfterMs));
    }
    let waitMs = Math.min(retryAfterMs ?? SHORT_WAIT_MS, MAX_WAIT_MS);
    // Progress on stderr so it never contaminates `--print-url` stdout.
    cliLog.info(
      `Login-token minting is rate-limited; waiting ${describeDuration(
        waitMs,
      )} and retrying…`,
    );
    await sleep(waitMs);
    try {
      token = await mintToken();
    } catch (retryErr) {
      if (retryErr instanceof MatrixRateLimitError) {
        throw new Error(rateLimitMessage(retryErr.retryAfterMs));
      }
      throw retryErr;
    }
  }

  let hostUrl = hostAppUrlForProfile(profile, options.hostUrl);
  let url = buildBrowseUrl(hostUrl, token.loginToken, cardPath);

  // The URL carries a single-use login token, so it's a credential. Under
  // `--print-url` it's the requested payload (stdout); otherwise it only ever
  // reaches the browser or the failure fallback.
  if (options.printUrl) {
    cliLog.output(url);
    return;
  }

  // The validity window is only stated when the server reported one.
  let tokenNote =
    token.expiresInMs !== undefined
      ? `(login token valid ${describeDuration(token.expiresInMs)}, single use)`
      : `(single-use login token)`;
  log(`Opening ${hostUrl} as ${profile.matrixUserId} ${tokenNote}`);

  let opened = await openBrowserFn(url);
  if (!opened) {
    cliLog.warn(
      `Couldn't open a browser automatically. Open this URL to sign in ` +
        `(single-use, expires soon):\n  ${url}`,
    );
  }
}

interface BrowseCliOptions {
  profile?: string;
  hostUrl?: string;
  printUrl?: boolean;
  wait?: boolean;
}

export function registerBrowseCommand(program: Command): void {
  program
    .command('browse')
    .description(
      'Open the Boxel app in your browser, already signed in as your active ' +
        'profile (a published-realm card URL opens directly, no sign-in needed)',
    )
    .argument(
      '[card-path]',
      'Card to open: a realm-relative path (opens signed in) or a ' +
        'published-realm URL (opens directly, no sign-in)',
    )
    .option('--profile <id>', 'Profile to use (default: the active profile)')
    .option(
      '--host-url <url>',
      'Override the host app URL the token is redeemed against',
    )
    .option(
      '--print-url',
      'Print the authenticated URL instead of opening a browser (for remote shells / agents)',
    )
    .option(
      '--wait',
      'If login-token minting is rate-limited (~1/min per account), wait out the ' +
        'reported delay and retry once instead of erroring',
    )
    .action(async (cardPath: string | undefined, opts: BrowseCliOptions) => {
      try {
        await browse(cardPath, opts);
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
