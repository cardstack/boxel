import type { Profile, ProfileManager } from '../lib/profile-manager.ts';
import {
  getProfileManager,
  formatProfileBadge,
  getDomainFromMatrixId,
  getEnvironmentFromMatrixId,
  getUsernameFromMatrixId,
  signInKind,
} from '../lib/profile-manager.ts';
import { matrixLogout } from '../lib/auth.ts';
import { OAUTH_UNAVAILABLE_COMMANDS } from '../lib/oauth-refusals.ts';
import {
  ensurePersonalRealm,
  ensurePersonalRealmWithOAuth,
  type EnsurePersonalRealmResult,
} from '../lib/personal-realm.ts';
import { prompt, promptPassword } from '../lib/prompt.ts';
import { SsoTimeoutError, browserLogin } from '../lib/sso-login.ts';
import {
  oauthLogin,
  revokeConnection,
  type OAuthLoginOptions,
  type OAuthLoginResult,
} from '../lib/oauth-login.ts';
import {
  secureOriginForProfiles,
  secureSignOut,
} from '../lib/secure-session.ts';
import {
  FG_GREEN,
  FG_YELLOW,
  FG_CYAN,
  FG_MAGENTA,
  FG_RED,
  DIM,
  BOLD,
  RESET,
} from '../lib/colors.ts';

export interface ProfileCommandOptions {
  user?: string;
  password?: string;
  name?: string;
  matrixUrl?: string;
  realmServerUrl?: string;
  // Commander sets this to false for `--no-browser`. Undefined means the
  // default: sign in through the browser.
  browser?: boolean;
  // `--oauth`: sign in with OAuth instead of Matrix.
  oauth?: boolean;
  hostUrl?: string;
  staging?: boolean;
  production?: boolean;
  local?: boolean;
  // `profile list --json`: emit the full profile set as machine-readable JSON
  // for programmatic callers, so nothing has to parse the decorated human
  // listing.
  json?: boolean;
}

interface EnvironmentDefaults {
  domain: string;
  matrixUrl: string;
  realmServerUrl: string;
  // Only set where the app is served from a different origin than the realm
  // server. Deployed environments serve both from one, so the sign-in page is
  // reachable at realmServerUrl and this stays unset. Local dev splits them
  // across ports, and the origin matters: the browser session lives in
  // origin-scoped storage, so a page loaded from the realm server's port
  // wouldn't see the session established on the app's.
  appUrl?: string;
  // Set by `--host-url`, which names the sign-in page to open: the host app's
  // own, even where the realm server's secure origin could sign in instead.
  signInOnHostApp?: boolean;
}

type PresetName = 'staging' | 'production' | 'local';

const ENVIRONMENTS: Record<PresetName, EnvironmentDefaults> = {
  staging: {
    domain: 'stack.cards',
    matrixUrl: 'https://matrix-staging.stack.cards',
    realmServerUrl: 'https://realms-staging.stack.cards/',
  },
  production: {
    domain: 'boxel.ai',
    matrixUrl: 'https://matrix.boxel.ai',
    realmServerUrl: 'https://app.boxel.ai/',
  },
  local: {
    domain: 'localhost',
    matrixUrl: 'http://localhost:8008',
    realmServerUrl: 'https://localhost:4201/',
    // The host vite dev server, which is where local dev signs in.
    appUrl: 'https://localhost:4200/',
  },
};

// Validate and normalize a URL provided by the user via --matrix-url,
// --realm-server-url, or --host-url. Returns the trimmed input on success;
// exits 1 with a clear message otherwise. Without this, downstream code
// (fetch, realm auth, etc.) would throw on invalid input far away from where
// the value was entered.
function validateUrl(input: string, label: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    console.error(
      `${FG_RED}Error:${RESET} ${label} "${input}" is not a valid URL.`,
    );
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.error(
      `${FG_RED}Error:${RESET} ${label} "${input}" must use http:// or https://.`,
    );
    process.exit(1);
  }
  return trimmed;
}

// Matches scripts/env-slug.sh: lowercase, "/" -> "-", strip chars outside
// [a-z0-9-], collapse runs of "-", trim leading/trailing "-".
export function computeEnvSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Derive URLs from BOXEL_ENVIRONMENT using the same ".${slug}.localhost"
// pattern that mise-tasks/lib/env-vars.sh produces for env-mode local dev.
export function resolveBoxelEnvironment(): EnvironmentDefaults | null {
  const raw = process.env.BOXEL_ENVIRONMENT;
  if (!raw || !raw.trim()) return null;
  const slug = computeEnvSlug(raw);
  if (!slug) {
    console.error(
      `${FG_RED}Error:${RESET} BOXEL_ENVIRONMENT="${raw}" contains no slug characters (expected letters, digits, or "-").`,
    );
    process.exit(1);
  }
  return {
    domain: `${slug}.localhost`,
    matrixUrl: `https://matrix.${slug}.localhost`,
    realmServerUrl: `https://realm-server.${slug}.localhost/`,
  };
}

// Which rule picked the environment. Only 'default' means nothing in the
// invocation named one, which is the signal `profile add` uses to tell an
// unstated environment (sign in to production) apart from a stated one.
export type EnvironmentSource =
  | 'flag'
  | 'matrix-id'
  | 'boxel-environment'
  | 'default';

export interface ResolvedEnvironment {
  environment: EnvironmentDefaults;
  source: EnvironmentSource;
  // The validated URL flags on their own, before the environment filled in
  // whatever they left out.
  overrides: { matrixUrl?: string; realmServerUrl?: string; appUrl?: string };
}

// The Matrix ID domain for a homeserver reachable at `matrixUrl`, used when a
// bare --matrix-url is the only thing said about where the account lives. A
// leading "matrix"-ish label is dropped because that is how a homeserver
// delegates a shorter server name — matrix.boxel.ai serves boxel.ai, and
// matrix-staging.stack.cards serves stack.cards.
function domainFromMatrixUrl(matrixUrl: string): string {
  // validateUrl already parsed this, so the constructor can't throw. The
  // fallback covers a parseable URL with an empty hostname ("http:///path").
  const { hostname } = new URL(matrixUrl);
  return hostname.replace(/^matrix[^.]*\./, '') || 'custom';
}

// Decide which environment `profile add` targets, so the interactive and
// non-interactive paths share one answer. Precedence:
//
//   1. --matrix-url / --realm-server-url / --host-url (per-field override)
//   2. --staging / --local / --production
//   3. the -u Matrix ID's domain, when it's one we recognize
//   4. BOXEL_ENVIRONMENT
//   5. production
//
// A recognized Matrix ID domain outranks BOXEL_ENVIRONMENT because the mise
// tasks export that variable, so it lingers in a shell: letting it win would
// point a profile for @user:boxel.ai at matrix.<slug>.localhost, leaving the
// profile's Matrix ID and URLs describing different environments.
export function resolveEnvironment(
  options: ProfileCommandOptions,
): ResolvedEnvironment {
  const matrixUrl = options.matrixUrl
    ? validateUrl(options.matrixUrl, '--matrix-url')
    : undefined;
  const realmServerUrl = options.realmServerUrl
    ? validateUrl(options.realmServerUrl, '--realm-server-url')
    : undefined;
  const appUrl = options.hostUrl
    ? validateUrl(options.hostUrl, '--host-url')
    : undefined;

  const presets = (['production', 'staging', 'local'] as const).filter(
    (name) => options[name],
  );
  if (presets.length > 1) {
    console.error(
      `${FG_RED}Error:${RESET} Pass at most one of --production, --staging, --local (got ${presets
        .map((name) => `--${name}`)
        .join(', ')}).`,
    );
    process.exit(1);
  }

  const matrixIdEnv = options.user
    ? getEnvironmentFromMatrixId(options.user)
    : 'unknown';
  // BOXEL_ENVIRONMENT is read only where it could still decide something:
  // nothing higher has, and it has something left to give. With -u naming the
  // Matrix ID and both URLs overridden there is nothing left to fill, and a
  // value that slugs to empty exits 1 — which must not kill a scripted run
  // that already specified everything. Without -u it stays in play even when
  // both URLs are given, because `domain` is still open and no flag names it:
  // the terminal sign-in path builds the Matrix ID as "@<username>:<domain>".
  const boxelEnvironment =
    presets.length === 0 &&
    matrixIdEnv === 'unknown' &&
    (!options.user || !matrixUrl || !realmServerUrl)
      ? resolveBoxelEnvironment()
      : null;

  let base: EnvironmentDefaults;
  let source: EnvironmentSource;
  if (presets.length === 1) {
    base = ENVIRONMENTS[presets[0]];
    source = 'flag';
  } else if (matrixIdEnv !== 'unknown') {
    base = ENVIRONMENTS[matrixIdEnv];
    source = 'matrix-id';
  } else if (boxelEnvironment) {
    base = boxelEnvironment;
    source = 'boxel-environment';
  } else {
    base = ENVIRONMENTS.production;
    source = 'default';
  }

  return {
    source,
    overrides: { matrixUrl, realmServerUrl, appUrl },
    environment: {
      // With nothing else naming an environment, --matrix-url is all we know
      // about where the account lives, so the Matrix ID domain comes from it
      // rather than from production's boxel.ai.
      domain:
        source === 'default' && matrixUrl
          ? domainFromMatrixUrl(matrixUrl)
          : base.domain,
      matrixUrl: matrixUrl ?? base.matrixUrl,
      realmServerUrl: realmServerUrl ?? base.realmServerUrl,
      appUrl: appUrl ?? base.appUrl,
      ...(appUrl ? { signInOnHostApp: true } : {}),
    },
  };
}

// The `profile add` flags that choose a Matrix sign-in. `BOXEL_PASSWORD` isn't
// one: it lingers in a shell, and only a password passed with `-u` uses it.
function oauthConflicts(options: ProfileCommandOptions): string[] {
  return [
    options.browser === false ? '--no-browser' : undefined,
    options.user ? '-u/--user' : undefined,
    options.password ? '-p/--password' : undefined,
    options.hostUrl ? '--host-url' : undefined,
  ].filter((flag): flag is string => flag !== undefined);
}

export async function profileCommand(
  subcommand?: string,
  arg?: string,
  options?: ProfileCommandOptions,
): Promise<void> {
  const manager = getProfileManager();

  switch (subcommand) {
    case 'list':
      await listProfiles(manager, { json: options?.json });
      break;

    case 'add': {
      const password = options?.password || process.env.BOXEL_PASSWORD;
      if (options?.oauth) {
        const conflicting = oauthConflicts(options);
        if (conflicting.length > 0) {
          const named =
            conflicting.length === 1
              ? conflicting[0]
              : `${conflicting.slice(0, -1).join(', ')} or ${conflicting.at(-1)}`;
          console.error(
            `${FG_RED}Error:${RESET} --oauth signs in through the browser with OAuth, ` +
              `so it can't be combined with ${named}, which ` +
              `${conflicting.length === 1 ? 'signs' : 'sign'} in with Matrix.`,
          );
          process.exitCode = 1;
          return;
        }
      }
      const { environment, source, overrides } = resolveEnvironment(
        options ?? {},
      );
      if (source === 'boxel-environment') {
        console.log(
          `${DIM}Using BOXEL_ENVIRONMENT=${process.env.BOXEL_ENVIRONMENT}${RESET}`,
        );
      }
      if (options?.oauth) {
        await addOAuthProfile(manager, environment);
      } else if (options?.user && password) {
        // A -u Matrix ID whose domain we don't recognize, with nothing else
        // naming an environment, is a mistake rather than a request for
        // production: pass only what the caller actually specified so
        // ProfileManager raises its "Unknown domain ... provide explicit
        // --matrix-url and --realm-server-url" error, instead of trying to
        // log in to boxel.ai as an account that can't live there.
        const urls = source === 'default' ? overrides : environment;
        await addProfileNonInteractive(
          manager,
          options.user,
          password,
          options.name,
          urls.matrixUrl,
          urls.realmServerUrl,
        );
      } else {
        await addProfile(manager, environment, options?.browser !== false);
      }
      break;
    }

    case 'switch':
      if (!arg) {
        console.error(
          `${FG_RED}Error:${RESET} Please specify a profile to switch to.`,
        );
        console.log(`Usage: boxel profile switch <profile-id>`);
        console.log(`\nAvailable profiles:`);
        await listProfiles(manager);
        process.exit(1);
      }
      await switchProfile(manager, arg);
      break;

    case 'remove':
      if (!arg) {
        console.error(
          `${FG_RED}Error:${RESET} Please specify a profile to remove.`,
        );
        process.exit(1);
      }
      await removeProfile(manager, arg);
      break;

    case 'migrate':
      await migrateFromEnv(manager);
      break;

    default:
      manager.printStatus();
      console.log(`\n${DIM}Commands:${RESET}`);
      console.log(
        `  ${FG_CYAN}boxel profile list${RESET}      List all profiles`,
      );
      console.log(
        `  ${FG_CYAN}boxel profile add${RESET}       Add a new profile`,
      );
      console.log(
        `  ${FG_CYAN}boxel profile switch${RESET}    Switch active profile`,
      );
      console.log(
        `  ${FG_CYAN}boxel profile remove${RESET}    Remove a profile`,
      );
      console.log(
        `  ${FG_CYAN}boxel profile migrate${RESET}   Import from .env file`,
      );
  }
}

// `profile list` is the discovery command: an agent or script asking "does
// this profile exist?" needs the complete set, so it always lists every saved
// profile \u2014 no truncation, and the human view names the total so a reader can
// see the listing is complete rather than inferring it. `--json` gives
// programmatic callers the same complete set without a decorated listing to
// parse.
//
// When the store exists but can't be read, that is reported (a stderr message,
// or an `error` field in `--json`) and the command exits non-zero, rather than
// presenting an unreadable store as an empty one \u2014 an unreadable store must not
// read as "no such profile".
export async function listProfiles(
  manager: ProfileManager,
  options?: { json?: boolean },
): Promise<void> {
  const profiles = manager.listProfiles();
  const activeId = manager.getActiveProfileId();
  const loadError = manager.getLoadError();

  if (options?.json) {
    const output = {
      ...(loadError ? { error: loadError } : {}),
      activeProfile: activeId,
      profiles: profiles.map((id) => {
        const profile = manager.getProfile(id)!;
        return {
          id,
          displayName: profile.displayName,
          environment: getEnvironmentFromMatrixId(id),
          domain: getDomainFromMatrixId(id),
          matrixUrl: profile.matrixUrl,
          realmServerUrl: profile.realmServerUrl,
          signIn: signInKind(profile),
          ...(profile.oauth
            ? {
                connectionEndsAt: profile.oauth.connectionEndsAt,
                unavailableCommands: [...OAUTH_UNAVAILABLE_COMMANDS],
              }
            : {}),
          active: id === activeId,
        };
      }),
    };
    console.log(JSON.stringify(output, null, 2));
    if (loadError) {
      process.exitCode = 1;
    }
    return;
  }

  if (loadError) {
    console.error(`\n${FG_RED}Error:${RESET} ${loadError}`);
    process.exitCode = 1;
    return;
  }

  if (profiles.length === 0) {
    console.log(`\n${FG_YELLOW}No profiles configured.${RESET}`);
    console.log(`Run ${FG_CYAN}boxel profile add${RESET} to create one.`);
    return;
  }

  const count = profiles.length;
  console.log(
    `\n${BOLD}Saved Profiles${RESET} ${DIM}(${count} ${
      count === 1 ? 'profile' : 'profiles'
    })${RESET}\n`,
  );

  for (const id of profiles) {
    const profile = manager.getProfile(id)!;
    const isActive = id === activeId;
    const env = getEnvironmentFromMatrixId(id);

    const marker = isActive ? `${FG_GREEN}\u2605${RESET} ` : '  ';
    const domain = getDomainFromMatrixId(id);
    const envColor = env === 'production' ? FG_MAGENTA : FG_CYAN;

    console.log(`${marker}${BOLD}${id}${RESET}`);
    console.log(`    ${DIM}Name:${RESET} ${profile.displayName}`);
    console.log(`    ${DIM}Environment:${RESET} ${envColor}${domain}${RESET}`);
    console.log(`    ${DIM}Realm Server:${RESET} ${profile.realmServerUrl}`);
    console.log(`    ${DIM}Sign-in:${RESET} ${describeSignIn(profile)}`);
    if (profile.oauth) {
      console.log(
        `    ${DIM}Not with OAuth yet:${RESET} ${OAUTH_UNAVAILABLE_COMMANDS.map((c) => `boxel ${c}`).join(', ')}`,
      );
    }
    console.log('');
  }

  if (activeId) {
    console.log(`${DIM}\u2605 = active profile${RESET}`);
  }
}

// How a profile is signed in, for the listing. An OAuth connection names when
// it ends, and warns once that is close.
const CONNECTION_ENDING_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

export function describeSignIn(
  profile: Profile,
  now: number = Date.now(),
): string {
  if (!profile.oauth) {
    return 'Matrix';
  }
  const ends = Date.parse(profile.oauth.connectionEndsAt);
  if (!(ends > now)) {
    return `OAuth, ${FG_RED}ended ${new Date(ends).toLocaleString()}${RESET}. Run \`boxel profile add --oauth\` to sign in again.`;
  }
  const when = new Date(ends).toLocaleString();
  if (ends - now <= CONNECTION_ENDING_WARNING_MS) {
    return `OAuth, ${FG_YELLOW}ends ${when}${RESET}. Run \`boxel profile add --oauth\` to sign in again before then.`;
  }
  return `OAuth, ends ${when}`;
}

// What adding a profile reaches beyond this module. Tests stand in for the
// browser and for the person at the terminal through it.
export interface AddProfileDeps {
  browserLogin?: typeof browserLogin;
  secureOriginForProfiles?: typeof secureOriginForProfiles;
  secureSignOut?: typeof secureSignOut;
  ensurePersonalRealm?: typeof ensurePersonalRealm;
  prompt?: (question: string) => Promise<string>;
  // Whether a person is at the terminal to answer questions. A coding agent or
  // a script runs the CLI without a TTY, and a question asked there is never
  // answered.
  isTty?: () => boolean;
  oauthLogin?: (options: OAuthLoginOptions) => Promise<OAuthLoginResult>;
  revokeConnection?: typeof revokeConnection;
  matrixLogout?: typeof matrixLogout;
  ensurePersonalRealmWithOAuth?: typeof ensurePersonalRealmWithOAuth;
}

interface AddProfileContext {
  browserLogin: typeof browserLogin;
  secureOriginForProfiles: typeof secureOriginForProfiles;
  secureSignOut: typeof secureSignOut;
  ensurePersonalRealm: typeof ensurePersonalRealm;
  prompt: (question: string) => Promise<string>;
  interactive: boolean;
  oauthLogin: (options: OAuthLoginOptions) => Promise<OAuthLoginResult>;
  revokeConnection: typeof revokeConnection;
  matrixLogout: typeof matrixLogout;
  ensurePersonalRealmWithOAuth: typeof ensurePersonalRealmWithOAuth;
}

function addProfileContext(deps: AddProfileDeps): AddProfileContext {
  return {
    browserLogin: deps.browserLogin ?? browserLogin,
    secureOriginForProfiles:
      deps.secureOriginForProfiles ?? secureOriginForProfiles,
    secureSignOut: deps.secureSignOut ?? secureSignOut,
    ensurePersonalRealm: deps.ensurePersonalRealm ?? ensurePersonalRealm,
    prompt: deps.prompt ?? prompt,
    interactive: (deps.isTty ?? (() => Boolean(process.stdin.isTTY)))(),
    oauthLogin: deps.oauthLogin ?? oauthLogin,
    revokeConnection: deps.revokeConnection ?? revokeConnection,
    matrixLogout: deps.matrixLogout ?? matrixLogout,
    ensurePersonalRealmWithOAuth:
      deps.ensurePersonalRealmWithOAuth ?? ensurePersonalRealmWithOAuth,
  };
}

// What a profile gives up when `--oauth` replaces its Matrix sign-in.
const OAUTH_REPLACES_MATRIX =
  "This replaces a profile signed in with Matrix. A profile signed in with OAuth can't yet run `boxel run-command` or `boxel capture`, " +
  'give out a token with getServerToken(), or list realms outside your workspaces (`boxel realm list --hidden`), and ' +
  '`boxel browse` opens the app for the browser to sign in rather than signing it in. Run `boxel profile add` without ' +
  '--oauth to go back to Matrix if you need those.';

function replacesMatrixProfile(
  manager: ProfileManager,
  matrixId: string,
): boolean {
  let existing = manager.getProfile(matrixId);
  return Boolean(existing) && signInKind(existing!) === 'matrix';
}

// Returns false when the user declined to replace an existing profile.
async function confirmOverwrite(
  manager: ProfileManager,
  matrixId: string,
  ctx: AddProfileContext,
): Promise<boolean> {
  if (!manager.getProfile(matrixId)) {
    return true;
  }
  console.log(`\n${FG_YELLOW}Profile ${matrixId} already exists.${RESET}`);
  const overwrite = await ctx.prompt('Overwrite? [y/N]: ');
  if (overwrite.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return false;
  }
  return true;
}

async function promptDisplayName(
  matrixId: string,
  ctx: AddProfileContext,
): Promise<string> {
  const defaultDisplayName = `${getUsernameFromMatrixId(matrixId)} \u00b7 ${getDomainFromMatrixId(matrixId)}`;
  const displayNameInput = await ctx.prompt(
    `Display name [${defaultDisplayName}]: `,
  );
  return displayNameInput || defaultDisplayName;
}

// `usePassword` is distinct from `cancelled`: the first means the browser path
// couldn't finish and the caller should ask for a password instead, the second
// means the user chose to stop and nothing more should be asked.
type AddProfileOutcome =
  | { status: 'added'; matrixId: string }
  | { status: 'cancelled' }
  | { status: 'usePassword' };

// Browser sign-in. The authorization page offers both a password form and a
// Google button, and reports back whichever account the user signed in as — so
// unlike the terminal password path there is nothing to ask for up front.
//
// Without a TTY the questions that follow the sign-in are not asked: the
// person already chose to sign in, in the browser, and a question nobody can
// answer leaves the profile unsaved — so whoever ran the command runs it
// again and the person is sent through the browser again. The profile is
// saved as the defaults would have it, and a profile already stored for the
// account is replaced, since the browser has just proven it is that account.
// It keeps its display name. `addProfile` leaves a different active profile
// active.
//
// The sign-in page is the realm server's secure origin when it can sign a
// profile in, and the host app's own page otherwise, or when `--host-url`
// names one. The secure origin also hands over a secure session, kept with
// the profile, so `boxel keys` works without a separate `boxel keys sign-in`.
async function addProfileViaBrowser(
  manager: ProfileManager,
  matrixUrl: string,
  hostUrl: string,
  realmServerUrl: string,
  signInOnHostApp: boolean,
  ctx: AddProfileContext,
): Promise<AddProfileOutcome> {
  let auth;
  try {
    let secureOriginUrl = signInOnHostApp
      ? undefined
      : await ctx.secureOriginForProfiles(realmServerUrl);
    auth = await ctx.browserLogin({
      matrixUrl,
      hostUrl,
      secureOriginUrl,
      discardSecureSession: (s) => ctx.secureSignOut(realmServerUrl, s.token),
    });
  } catch (err) {
    if (err instanceof SsoTimeoutError) {
      console.log(`\n${FG_YELLOW}${err.message}${RESET}`);
      return { status: 'usePassword' };
    }
    throw err;
  }

  // A secure session is for the account the Matrix device is. The secure
  // origin signs both in from one sign-in, so they always agree; one that
  // doesn't is ended rather than kept.
  let { secureSession, ...matrixAuth } = auth;
  if (secureSession && secureSession.userId !== auth.userId) {
    await ctx
      .secureSignOut(realmServerUrl, secureSession.token)
      .catch(() => {});
    secureSession = undefined;
  }
  const endUnused = async () => {
    if (secureSession) {
      await ctx
        .secureSignOut(realmServerUrl, secureSession.token)
        .catch(() => {});
    }
  };

  // The page can sign in as an account other than the one the user expected —
  // a Google identity whose verified email matches no existing account gets a
  // brand-new one. Naming it before anything is written makes that visible
  // rather than silent.
  console.log(
    `\n${FG_GREEN}✓${RESET} Signed in as ${formatProfileBadge(auth.userId)}`,
  );
  let displayName: string | undefined;
  if (ctx.interactive) {
    const proceed = await ctx.prompt('Save this profile? [Y/n]: ');
    if (proceed.toLowerCase() === 'n') {
      await endUnused();
      console.log('Cancelled.');
      return { status: 'cancelled' };
    }

    if (!(await confirmOverwrite(manager, auth.userId, ctx))) {
      await endUnused();
      return { status: 'cancelled' };
    }

    displayName = await promptDisplayName(auth.userId, ctx);
  } else {
    // Undefined for a new profile, which addProfileWithAuth names by default.
    displayName = manager.getProfile(auth.userId)?.displayName;
  }
  // A secure session the profile had is ended, on the realm server that
  // issued it, when saving the profile replaces it or drops it (as moving the
  // profile to another realm server does), rather than left to run out its
  // week.
  let previous = manager.getProfile(auth.userId);
  await manager.addProfileWithAuth(
    auth.userId,
    matrixAuth,
    displayName,
    realmServerUrl,
    secureSession,
  );
  let kept = manager.getProfile(auth.userId)?.secureSession;
  if (previous?.secureSession && kept?.token !== previous.secureSession.token) {
    await ctx
      .secureSignOut(previous.realmServerUrl, previous.secureSession.token)
      .catch(() => {});
  }
  await endReplacedConnection(previous, ctx.revokeConnection);
  if (secureSession) {
    console.log(
      `${FG_GREEN}✓${RESET} Signed in to manage keys until ${new Date(
        secureSession.expiresAt,
      ).toLocaleString()}`,
    );
  }

  // The browser can hand back an account with no personal realm: one made on
  // the Matrix server directly, or one whose realm went missing from its
  // account data. Give it one here. For every other account this is a no-op
  // (a first sign-in on the secure origin already made one), and a failure
  // only warns: the profile works without it, and signing in to the web app
  // offers workspace creation.
  await reportPersonalRealm(
    ctx.ensurePersonalRealm(matrixAuth, realmServerUrl),
    realmServerUrl,
  );

  return { status: 'added', matrixId: auth.userId };
}

// Reports the personal-workspace bootstrap, which only warns when it fails:
// the profile works without one, and signing in to the web app offers
// workspace creation.
async function reportPersonalRealm(
  bootstrap: Promise<EnsurePersonalRealmResult>,
  realmServerUrl: string,
): Promise<void> {
  try {
    const result = await bootstrap;
    if (result.outcome === 'created') {
      console.log(
        `${FG_GREEN}✓${RESET} Created your personal workspace: ${FG_CYAN}${result.realmUrl}${RESET}`,
      );
    } else if (result.outcome === 'linked') {
      console.log(
        `${FG_GREEN}✓${RESET} Reconnected your personal workspace: ${FG_CYAN}${result.realmUrl}${RESET}`,
      );
    }
  } catch (err) {
    console.log(
      `${FG_YELLOW}Warning:${RESET} could not set up a personal workspace: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    console.log(
      `${DIM}You can create one by signing in at ${realmServerUrl}${RESET}`,
    );
  }
}

async function addProfileViaPassword(
  manager: ProfileManager,
  domain: string,
  matrixUrl: string,
  realmServerUrl: string,
  ctx: AddProfileContext,
): Promise<AddProfileOutcome> {
  console.log(`\nEnter your Boxel username (without @ or domain)`);
  console.log(`${DIM}Example: ctse, aallen90${RESET}`);
  const username = await ctx.prompt('Username: ');

  if (!username) {
    console.error(`${FG_RED}Error:${RESET} Username is required.`);
    process.exit(1);
  }

  const matrixId = `@${username}:${domain}`;

  if (!(await confirmOverwrite(manager, matrixId, ctx))) {
    return { status: 'cancelled' };
  }

  const password = await promptPassword('Password: ');

  if (!password) {
    console.error(`${FG_RED}Error:${RESET} Password is required.`);
    process.exit(1);
  }

  const displayName = await promptDisplayName(matrixId, ctx);

  const previous = manager.getProfile(matrixId);
  await manager.addProfile(
    matrixId,
    password,
    displayName,
    matrixUrl,
    realmServerUrl,
  );
  await endReplacedConnection(previous, ctx.revokeConnection);
  return { status: 'added', matrixId };
}

// A Matrix sign-in that replaces an OAuth profile drops its connection, so the
// connection is ended on the realm server rather than left live on Connected
// apps with nothing holding it.
async function endReplacedConnection(
  previous: Profile | undefined,
  revoke: typeof revokeConnection = revokeConnection,
): Promise<void> {
  if (previous?.oauth) {
    await revoke(previous.oauth, previous.oauth).catch(() => false);
  }
}

export async function addProfile(
  manager: ProfileManager,
  environment: EnvironmentDefaults,
  useBrowser = true,
  deps: AddProfileDeps = {},
): Promise<void> {
  const ctx = addProfileContext(deps);
  console.log(`\n${BOLD}Add New Profile${RESET}\n`);
  // The environment comes from flags rather than a prompt, so name it. The
  // realm server identifies it — that's the host every later command talks to,
  // and how `profile list` labels a profile. The sign-in page can be served
  // from somewhere else (local dev splits the two across ports); the browser
  // path prints the URL it actually opens.
  console.log(
    `${DIM}Environment: ${new URL(environment.realmServerUrl).host}${RESET}`,
  );

  // The realm server serves the app, so it serves the sign-in page too wherever
  // the two share an origin — which is everywhere except local dev.
  let outcome: AddProfileOutcome = useBrowser
    ? await addProfileViaBrowser(
        manager,
        environment.matrixUrl,
        environment.appUrl ?? environment.realmServerUrl,
        environment.realmServerUrl,
        Boolean(environment.signInOnHostApp),
        ctx,
      )
    : { status: 'usePassword' };

  if (outcome.status === 'usePassword') {
    // The terminal password sign-in is a run of questions, so without a TTY
    // it would wait on an answer that never comes.
    if (!ctx.interactive) {
      console.error(
        `${FG_RED}Error:${RESET} Signing in with a password here needs a terminal. ` +
          `Without one, pass the Matrix ID and the password in the environment: ` +
          `BOXEL_PASSWORD=... boxel profile add -u @<username>:${environment.domain}`,
      );
      process.exitCode = 1;
      return;
    }
    outcome = await addProfileViaPassword(
      manager,
      environment.domain,
      environment.matrixUrl,
      environment.realmServerUrl,
      ctx,
    );
  }

  if (outcome.status !== 'added') {
    return;
  }
  await announceAdded(manager, outcome.matrixId, ctx);
}

// `boxel profile add --oauth`: the OAuth sign-in through the browser. It
// never falls back to a Matrix sign-in: the user asked for OAuth.
export async function addOAuthProfile(
  manager: ProfileManager,
  environment: EnvironmentDefaults,
  deps: AddProfileDeps = {},
): Promise<void> {
  const ctx = addProfileContext(deps);
  console.log(`\n${BOLD}Add New Profile${RESET} ${DIM}(OAuth)${RESET}\n`);
  console.log(
    `${DIM}Environment: ${new URL(environment.realmServerUrl).host}${RESET}`,
  );
  const outcome = await addProfileViaOAuth(manager, environment, ctx);
  if (outcome.status !== 'added') {
    return;
  }
  await announceAdded(manager, outcome.matrixId, ctx);
}

async function addProfileViaOAuth(
  manager: ProfileManager,
  environment: EnvironmentDefaults,
  ctx: AddProfileContext,
): Promise<AddProfileOutcome> {
  const { realmServerUrl, matrixUrl } = environment;
  let result;
  try {
    result = await ctx.oauthLogin({ realmServerUrl });
  } catch (err) {
    console.error(
      `\n${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
    return { status: 'cancelled' };
  }
  const { provider, tokens, user } = result;
  const endUnused = async () => {
    await ctx.revokeConnection(provider, tokens).catch(() => false);
  };

  // As with the Matrix browser sign-in, the account is named before anything
  // is written: the browser may have been signed in as someone unexpected.
  console.log(
    `\n${FG_GREEN}\u2713${RESET} Signed in as ${formatProfileBadge(user.userId)}`,
  );
  let displayName: string | undefined;
  if (ctx.interactive) {
    const proceed = await ctx.prompt('Save this profile? [Y/n]: ');
    if (proceed.toLowerCase() === 'n') {
      await endUnused();
      console.log('Cancelled.');
      return { status: 'cancelled' };
    }
    if (replacesMatrixProfile(manager, user.userId)) {
      console.log(`\n${FG_YELLOW}${OAUTH_REPLACES_MATRIX}${RESET}`);
    }
    if (!(await confirmOverwrite(manager, user.userId, ctx))) {
      await endUnused();
      return { status: 'cancelled' };
    }
    displayName = await promptDisplayName(user.userId, ctx);
  } else {
    displayName = manager.getProfile(user.userId)?.displayName;
  }

  const previous = manager.getProfile(user.userId);
  try {
    manager.addOAuthProfile(
      user.userId,
      {
        issuer: provider.issuer,
        tokenEndpoint: provider.tokenEndpoint,
        ...(provider.revocationEndpoint
          ? { revocationEndpoint: provider.revocationEndpoint }
          : {}),
        ...tokens,
      },
      { matrixUrl, realmServerUrl },
      displayName,
    );
  } catch (err) {
    // Nothing holds the new connection if the profile wasn't saved, so it is
    // ended rather than left live until it expires.
    await endUnused();
    console.error(
      `\n${FG_RED}Error:${RESET} Couldn't save the profile: ${
        err instanceof Error ? err.message : String(err)
      }. The new connection was ended, so nothing is left connected.`,
    );
    process.exitCode = 1;
    return { status: 'cancelled' };
  }
  if (!ctx.interactive && previous && signInKind(previous) === 'matrix') {
    console.log(`\n${FG_YELLOW}${OAUTH_REPLACES_MATRIX}${RESET}`);
  }

  // What the profile held before is ended on the server that issued it,
  // rather than left live with nothing holding it: an earlier OAuth
  // connection, and a Matrix token and secure session, which an OAuth
  // profile never keeps. Each is best-effort: the new profile is saved.
  if (previous?.oauth) {
    await endReplacedConnection(previous, ctx.revokeConnection);
  }
  if (previous?.matrixAccessToken) {
    await ctx
      .matrixLogout(previous.matrixUrl, previous.matrixAccessToken)
      .catch(() => {});
  }
  if (previous?.secureSession) {
    await ctx
      .secureSignOut(previous.realmServerUrl, previous.secureSession.token)
      .catch(() => {});
  }

  console.log(describeConnectionEnd(tokens));
  await reportPersonalRealm(
    ctx.ensurePersonalRealmWithOAuth(
      {
        accessToken: tokens.accessToken,
        userId: user.userId,
        displayName: user.displayName,
      },
      realmServerUrl,
    ),
    realmServerUrl,
  );
  return { status: 'added', matrixId: user.userId };
}

function describeConnectionEnd(tokens: {
  refreshToken?: string;
  connectionEndsAt: string;
}): string {
  const ends = new Date(tokens.connectionEndsAt).toLocaleString();
  if (tokens.refreshToken) {
    return `${FG_GREEN}\u2713${RESET} Connected to the Boxel API until ${ends}. Sign in again then.`;
  }
  return (
    `${FG_YELLOW}This connection doesn't renew, so it ends at ${ends}.${RESET} ` +
    `${DIM}To keep it for 30 days, sign in again and allow it to renew.${RESET}`
  );
}

async function announceAdded(
  manager: ProfileManager,
  matrixId: string,
  ctx: AddProfileContext,
): Promise<void> {
  console.log(
    `\n${FG_GREEN}\u2713${RESET} Profile created: ${formatProfileBadge(matrixId)}`,
  );

  if (manager.getActiveProfileId() === matrixId) {
    console.log(`${DIM}This profile is now active.${RESET}`);
  } else if (!ctx.interactive) {
    // The browser can sign in as an account nobody meant — a Google identity
    // with no matching account gets a new one — and without a TTY nobody has
    // confirmed this one. The profile that was active stays active until
    // someone chooses this one.
    console.log(
      `${DIM}Use 'boxel profile switch ${matrixId}' to switch to this profile.${RESET}`,
    );
  } else {
    const switchNow = await ctx.prompt('Switch to this profile now? [Y/n]: ');
    if (switchNow.toLowerCase() !== 'n') {
      manager.switchProfile(matrixId);
      console.log(
        `${FG_GREEN}\u2713${RESET} Switched to ${formatProfileBadge(matrixId)}`,
      );
    }
  }
}

async function switchProfile(
  manager: ProfileManager,
  profileId: string,
): Promise<void> {
  const profiles = manager.listProfiles();
  let matchedId = profileId;

  if (!profiles.includes(profileId)) {
    const matches = profiles.filter((id) => {
      const username = getUsernameFromMatrixId(id);
      return id.includes(profileId) || username === profileId;
    });

    if (matches.length === 0) {
      console.error(`${FG_RED}Error:${RESET} Profile not found: ${profileId}`);
      console.log(`\nAvailable profiles:`);
      for (const id of profiles) {
        console.log(`  ${id}`);
      }
      process.exit(1);
    } else if (matches.length === 1) {
      matchedId = matches[0];
    } else {
      console.error(`${FG_RED}Error:${RESET} Ambiguous profile: ${profileId}`);
      console.log(`\nMatching profiles:`);
      for (const id of matches) {
        console.log(`  ${id}`);
      }
      process.exit(1);
    }
  }

  if (manager.switchProfile(matchedId)) {
    console.log(
      `${FG_GREEN}\u2713${RESET} Switched to ${formatProfileBadge(matchedId)}`,
    );
  } else {
    console.error(`${FG_RED}Error:${RESET} Failed to switch profile.`);
    process.exit(1);
  }
}

async function removeProfile(
  manager: ProfileManager,
  profileId: string,
): Promise<void> {
  const profile = manager.getProfile(profileId);
  if (!profile) {
    console.error(`${FG_RED}Error:${RESET} Profile not found: ${profileId}`);
    process.exit(1);
  }

  const confirm = await prompt(`Remove profile ${profileId}? [y/N]: `);
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return;
  }

  if (await manager.removeProfile(profileId)) {
    console.log(`${FG_GREEN}\u2713${RESET} Profile removed.`);
    // An OAuth profile's connection is ended too, so it leaves Connected
    // apps rather than staying live with nothing holding it.
    if (profile.oauth) {
      const ended = await revokeConnection(profile.oauth, profile.oauth).catch(
        () => false,
      );
      if (!ended) {
        console.log(
          `${FG_YELLOW}Warning:${RESET} could not end its OAuth connection. ` +
            'Disconnect Boxel CLI on Connected apps to end it.',
        );
      }
    }

    const newActive = manager.getActiveProfileId();
    if (newActive) {
      console.log(`Active profile is now: ${formatProfileBadge(newActive)}`);
    }
  } else {
    console.error(`${FG_RED}Error:${RESET} Failed to remove profile.`);
    process.exit(1);
  }
}

async function addProfileNonInteractive(
  manager: ProfileManager,
  matrixId: string,
  password: string,
  displayName?: string,
  matrixUrl?: string,
  realmServerUrl?: string,
): Promise<void> {
  if (!matrixId.startsWith('@') || !matrixId.includes(':')) {
    console.error(
      `${FG_RED}Error:${RESET} Invalid Matrix ID format. Expected @user:domain`,
    );
    process.exit(1);
  }

  const previous = manager.getProfile(matrixId);
  const isUpdate = Boolean(previous);

  // addProfile performs a real matrixLogin and persists the resulting
  // access token (the password never lands on disk). It also handles the
  // create-vs-reauth split uniformly: re-running it on an existing profile
  // refreshes the stored token while preserving cached realm tokens.
  try {
    await manager.addProfile(
      matrixId,
      password,
      displayName,
      matrixUrl,
      realmServerUrl,
    );
  } catch (err) {
    console.error(
      `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  await endReplacedConnection(previous);

  if (isUpdate) {
    if (matrixUrl || realmServerUrl) {
      const urlsChanged = manager.updateUrls(matrixId, {
        matrixUrl,
        realmServerUrl,
      });
      if (urlsChanged) {
        console.log(
          `${DIM}Updated server URLs and cleared cached realm tokens.${RESET}`,
        );
      }
    }
    console.log(
      `${FG_GREEN}\u2713${RESET} Profile updated: ${formatProfileBadge(matrixId)}`,
    );
    return;
  }

  console.log(
    `${FG_GREEN}\u2713${RESET} Profile created: ${formatProfileBadge(matrixId)}`,
  );

  const activeId = manager.getActiveProfileId();
  if (activeId !== matrixId) {
    console.log(
      `${DIM}Use 'boxel profile switch ${matrixId}' to switch to this profile.${RESET}`,
    );
  }
}

async function migrateFromEnv(manager: ProfileManager): Promise<void> {
  console.log(`\n${BOLD}Migrate from .env${RESET}\n`);

  const matrixUrl = process.env.MATRIX_URL;
  const username = process.env.MATRIX_USERNAME;
  const password = process.env.MATRIX_PASSWORD;
  const realmServerUrl = process.env.REALM_SERVER_URL;

  if (!matrixUrl || !username || !password || !realmServerUrl) {
    console.log(
      `${FG_YELLOW}No complete credentials found in environment variables.${RESET}`,
    );
    console.log(
      `\nRequired variables: MATRIX_URL, MATRIX_USERNAME, MATRIX_PASSWORD, REALM_SERVER_URL`,
    );
    return;
  }

  const result = await manager.migrateFromEnv();
  if (result) {
    if (result.created) {
      console.log(
        `${FG_GREEN}\u2713${RESET} Created profile: ${formatProfileBadge(result.profileId)}`,
      );
      console.log(
        `\n${DIM}You can now remove credentials from .env if desired.${RESET}`,
      );
    } else {
      console.log(
        `${FG_GREEN}\u2713${RESET} Refreshed profile: ${formatProfileBadge(result.profileId)}`,
      );
      console.log(
        `\n${DIM}Use 'boxel profile add -u ${result.profileId} -p <password>' to update other fields.${RESET}`,
      );
    }
  } else {
    console.log(`${FG_YELLOW}Migration failed.${RESET}`);
  }
}
