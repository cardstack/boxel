import type { ProfileManager } from '../lib/profile-manager.ts';
import {
  getProfileManager,
  formatProfileBadge,
  getDomainFromMatrixId,
  getEnvironmentFromMatrixId,
  getUsernameFromMatrixId,
} from '../lib/profile-manager.ts';
import { prompt, promptPassword } from '../lib/prompt.ts';
import { SsoTimeoutError, browserLogin } from '../lib/sso-login.ts';
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
  hostUrl?: string;
}

interface EnvironmentDefaults {
  domain: string;
  matrixUrl: string;
  realmServerUrl: string;
  // Origin of the host app, which serves the browser sign-in page. Production
  // shares an origin with the realm server; staging does not, so this can't be
  // derived from realmServerUrl.
  hostUrl: string;
}

const MENU_ENVIRONMENTS: Record<
  'staging' | 'production' | 'local',
  EnvironmentDefaults
> = {
  staging: {
    domain: 'stack.cards',
    matrixUrl: 'https://matrix-staging.stack.cards',
    realmServerUrl: 'https://realms-staging.stack.cards/',
    hostUrl: 'https://boxel-host-staging.stack.cards/',
  },
  production: {
    domain: 'boxel.ai',
    matrixUrl: 'https://matrix.boxel.ai',
    realmServerUrl: 'https://app.boxel.ai/',
    hostUrl: 'https://app.boxel.ai/',
  },
  local: {
    domain: 'localhost',
    matrixUrl: 'http://localhost:8008',
    realmServerUrl: 'https://localhost:4201/',
    hostUrl: 'http://localhost:4200/',
  },
};

// Validate and normalize a Matrix or realm-server URL provided by the user
// (via --matrix-url / --realm-server-url or the interactive Custom prompt).
// Returns the trimmed input on success; exits 1 with a clear message
// otherwise. Without this, downstream code (fetch, realm auth, etc.) would
// throw on invalid input far away from where the value was entered.
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
    hostUrl: `https://host.${slug}.localhost/`,
  };
}

export async function profileCommand(
  subcommand?: string,
  arg?: string,
  options?: ProfileCommandOptions,
): Promise<void> {
  const manager = getProfileManager();

  switch (subcommand) {
    case 'list':
      await listProfiles(manager);
      break;

    case 'add': {
      const password = options?.password || process.env.BOXEL_PASSWORD;
      if (options?.user && password) {
        const matrixUrl = options.matrixUrl
          ? validateUrl(options.matrixUrl, '--matrix-url')
          : undefined;
        const realmServerUrl = options.realmServerUrl
          ? validateUrl(options.realmServerUrl, '--realm-server-url')
          : undefined;
        // BOXEL_ENVIRONMENT only fills in URLs when (a) at least one flag is
        // missing, AND (b) the Matrix ID's domain isn't a known standard
        // (stack.cards / boxel.ai / localhost). Otherwise an unrelated
        // BOXEL_ENVIRONMENT in the shell would silently produce a profile
        // whose Matrix ID and URLs disagree — and an invalid env value
        // (e.g. one that slugs to empty) would kill a fully-specified
        // invocation where the env was meant to be overridden anyway.
        const matrixIdEnv = getEnvironmentFromMatrixId(options.user);
        const isStandardDomain = matrixIdEnv !== 'unknown';
        const needsEnvDefaults =
          !isStandardDomain && (!matrixUrl || !realmServerUrl);
        const envDefaults = needsEnvDefaults ? resolveBoxelEnvironment() : null;
        if (envDefaults) {
          console.log(
            `${DIM}Using BOXEL_ENVIRONMENT=${process.env.BOXEL_ENVIRONMENT}${RESET}`,
          );
        }
        await addProfileNonInteractive(
          manager,
          options.user,
          password,
          options.name,
          matrixUrl ?? envDefaults?.matrixUrl,
          realmServerUrl ?? envDefaults?.realmServerUrl,
        );
      } else {
        await addProfile(
          manager,
          resolveBoxelEnvironment(),
          options?.browser !== false,
          options?.hostUrl
            ? validateUrl(options.hostUrl, '--host-url')
            : undefined,
        );
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

async function listProfiles(manager: ProfileManager): Promise<void> {
  const profiles = manager.listProfiles();
  const activeId = manager.getActiveProfileId();

  if (profiles.length === 0) {
    console.log(`\n${FG_YELLOW}No profiles configured.${RESET}`);
    console.log(`Run ${FG_CYAN}boxel profile add${RESET} to create one.`);
    return;
  }

  console.log(`\n${BOLD}Saved Profiles:${RESET}\n`);

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
    console.log('');
  }

  if (activeId) {
    console.log(`${DIM}\u2605 = active profile${RESET}`);
  }
}

async function promptEnvironmentMenu(): Promise<EnvironmentDefaults> {
  console.log(`Which environment?`);
  console.log(`  ${FG_CYAN}1${RESET}) Staging (realms-staging.stack.cards)`);
  console.log(`  ${FG_MAGENTA}2${RESET}) Production (app.boxel.ai)`);
  console.log(`  ${FG_GREEN}3${RESET}) Local (localhost:4201)`);
  console.log(`  ${FG_YELLOW}4${RESET}) Custom (enter your own URLs)`);

  const envChoice = await prompt('\nChoice [1/2/3/4]: ');

  if (envChoice === '4') {
    const matrixUrlInput = await prompt('Matrix server URL: ');
    if (!matrixUrlInput) {
      console.error(`${FG_RED}Error:${RESET} Matrix server URL is required.`);
      process.exit(1);
    }
    const matrixUrl = validateUrl(matrixUrlInput, 'Matrix server URL');
    const realmServerUrlInput = await prompt('Realm server URL: ');
    if (!realmServerUrlInput) {
      console.error(`${FG_RED}Error:${RESET} Realm server URL is required.`);
      process.exit(1);
    }
    const realmServerUrl = validateUrl(realmServerUrlInput, 'Realm server URL');
    // The host app commonly shares an origin with the realm server, so offer
    // that as the default rather than making it a required fourth URL.
    const hostUrlInput = await prompt(`Host app URL [${realmServerUrl}]: `);
    const hostUrl = hostUrlInput
      ? validateUrl(hostUrlInput, 'Host app URL')
      : realmServerUrl;
    // matrixUrl is already validated by validateUrl above, so new URL won't
    // throw — the hostname fallback is just for the unlikely edge case of
    // a parseable URL with empty hostname (e.g. "http:///path").
    const defaultDomain = new URL(matrixUrl).hostname || 'custom';
    const domainInput = await prompt(
      `Domain for Matrix ID [${defaultDomain}]: `,
    );
    return {
      domain: domainInput || defaultDomain,
      matrixUrl,
      realmServerUrl,
      hostUrl,
    };
  }

  if (envChoice === '3') {
    return { ...MENU_ENVIRONMENTS.local };
  }
  if (envChoice === '2') {
    return { ...MENU_ENVIRONMENTS.production };
  }
  return { ...MENU_ENVIRONMENTS.staging };
}

// Returns false when the user declined to replace an existing profile.
async function confirmOverwrite(
  manager: ProfileManager,
  matrixId: string,
): Promise<boolean> {
  if (!manager.getProfile(matrixId)) {
    return true;
  }
  console.log(`\n${FG_YELLOW}Profile ${matrixId} already exists.${RESET}`);
  const overwrite = await prompt('Overwrite? [y/N]: ');
  if (overwrite.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return false;
  }
  return true;
}

async function promptDisplayName(matrixId: string): Promise<string> {
  const defaultDisplayName = `${getUsernameFromMatrixId(matrixId)} \u00b7 ${getDomainFromMatrixId(matrixId)}`;
  const displayNameInput = await prompt(
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
async function addProfileViaBrowser(
  manager: ProfileManager,
  matrixUrl: string,
  hostUrl: string,
  realmServerUrl: string,
): Promise<AddProfileOutcome> {
  let auth;
  try {
    auth = await browserLogin({ matrixUrl, hostUrl });
  } catch (err) {
    if (err instanceof SsoTimeoutError) {
      console.log(`\n${FG_YELLOW}${err.message}${RESET}`);
      return { status: 'usePassword' };
    }
    throw err;
  }

  // The page can sign in as an account other than the one the user expected —
  // a Google identity whose verified email matches no existing account gets a
  // brand-new one. Naming it before anything is written makes that visible
  // rather than silent.
  console.log(
    `\n${FG_GREEN}✓${RESET} Signed in as ${formatProfileBadge(auth.userId)}`,
  );
  const proceed = await prompt('Save this profile? [Y/n]: ');
  if (proceed.toLowerCase() === 'n') {
    console.log('Cancelled.');
    return { status: 'cancelled' };
  }

  if (!(await confirmOverwrite(manager, auth.userId))) {
    return { status: 'cancelled' };
  }

  const displayName = await promptDisplayName(auth.userId);
  await manager.addProfileWithAuth(
    auth.userId,
    auth,
    displayName,
    realmServerUrl,
  );
  return { status: 'added', matrixId: auth.userId };
}

async function addProfileViaPassword(
  manager: ProfileManager,
  domain: string,
  matrixUrl: string,
  realmServerUrl: string,
): Promise<AddProfileOutcome> {
  console.log(`\nEnter your Boxel username (without @ or domain)`);
  console.log(`${DIM}Example: ctse, aallen90${RESET}`);
  const username = await prompt('Username: ');

  if (!username) {
    console.error(`${FG_RED}Error:${RESET} Username is required.`);
    process.exit(1);
  }

  const matrixId = `@${username}:${domain}`;

  if (!(await confirmOverwrite(manager, matrixId))) {
    return { status: 'cancelled' };
  }

  const password = await promptPassword('Password: ');

  if (!password) {
    console.error(`${FG_RED}Error:${RESET} Password is required.`);
    process.exit(1);
  }

  const displayName = await promptDisplayName(matrixId);

  await manager.addProfile(
    matrixId,
    password,
    displayName,
    matrixUrl,
    realmServerUrl,
  );
  return { status: 'added', matrixId };
}

async function addProfile(
  manager: ProfileManager,
  envDefaults?: EnvironmentDefaults | null,
  useBrowser = true,
  hostUrlOverride?: string,
): Promise<void> {
  console.log(`\n${BOLD}Add New Profile${RESET}\n`);

  let domain: string;
  let defaultMatrixUrl: string;
  let defaultRealmUrl: string;
  let defaultHostUrl: string;

  if (envDefaults) {
    console.log(
      `${DIM}Using BOXEL_ENVIRONMENT=${process.env.BOXEL_ENVIRONMENT}${RESET}`,
    );
    domain = envDefaults.domain;
    defaultMatrixUrl = envDefaults.matrixUrl;
    defaultRealmUrl = envDefaults.realmServerUrl;
    defaultHostUrl = envDefaults.hostUrl;
  } else {
    const menuResult = await promptEnvironmentMenu();
    domain = menuResult.domain;
    defaultMatrixUrl = menuResult.matrixUrl;
    defaultRealmUrl = menuResult.realmServerUrl;
    defaultHostUrl = menuResult.hostUrl;
  }

  let outcome: AddProfileOutcome = useBrowser
    ? await addProfileViaBrowser(
        manager,
        defaultMatrixUrl,
        hostUrlOverride ?? defaultHostUrl,
        defaultRealmUrl,
      )
    : { status: 'usePassword' };

  if (outcome.status === 'usePassword') {
    outcome = await addProfileViaPassword(
      manager,
      domain,
      defaultMatrixUrl,
      defaultRealmUrl,
    );
  }

  if (outcome.status !== 'added') {
    return;
  }

  const matrixId = outcome.matrixId;

  console.log(
    `\n${FG_GREEN}\u2713${RESET} Profile created: ${formatProfileBadge(matrixId)}`,
  );

  if (manager.getActiveProfileId() === matrixId) {
    console.log(`${DIM}This profile is now active.${RESET}`);
  } else {
    const switchNow = await prompt('Switch to this profile now? [Y/n]: ');
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

  const isUpdate = Boolean(manager.getProfile(matrixId));

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
