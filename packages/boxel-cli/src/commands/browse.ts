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
} from '../lib/auth.ts';
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
  // Injectable seams for testing.
  profileManager?: ProfileManager;
  requestLoginToken?: typeof defaultRequestLoginToken;
  openBrowserFn?: (url: string) => Promise<boolean>;
  log?: (message: string) => void;
}

// Resolve the target profile: the named one, or the active one.
function resolveProfile(
  pm: ProfileManager,
  profileId: string | undefined,
): { id: string; profile: Profile } {
  if (profileId) {
    let profile = pm.getProfile(profileId);
    if (!profile) {
      throw new Error(
        `No profile named "${profileId}". Run \`boxel profile list\` to see your profiles.`,
      );
    }
    return { id: profileId, profile };
  }
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(NO_ACTIVE_PROFILE_ERROR);
  }
  return active;
}

export async function browse(
  cardPath: string | undefined,
  options: BrowseOptions = {},
): Promise<void> {
  let pm = options.profileManager ?? getProfileManager();
  let requestLoginToken = options.requestLoginToken ?? defaultRequestLoginToken;
  let openBrowserFn = options.openBrowserFn ?? openBrowser;
  let log = options.log ?? ((message: string) => console.log(message));

  let { id: profileId, profile } = resolveProfile(pm, options.profile);

  // Mint the login token, recovering once from a rejected access token via the
  // profile manager's interactive re-auth (same pattern as the other commands).
  let token;
  try {
    token = await requestLoginToken(pm.getStoredMatrixAuth(profileId));
  } catch (err) {
    if (!(err instanceof MatrixAuthError)) {
      throw err;
    }
    let freshAuth = await pm.reAuthenticate(profileId);
    token = await requestLoginToken(freshAuth);
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

  log(
    `Opening ${hostUrl} as ${profile.matrixUserId} ` +
      `(login token valid ${describeDuration(token.expiresInMs)}, single use)`,
  );

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
}

export function registerBrowseCommand(program: Command): void {
  program
    .command('browse')
    .description(
      'Open the Boxel app in your browser, already signed in as your active profile',
    )
    .argument(
      '[card-path]',
      'Card path to deep-link to after signing in (e.g. a realm-relative path)',
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
