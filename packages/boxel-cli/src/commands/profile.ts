import type { ProfileManager } from '../lib/profile-manager';
import {
  getProfileManager,
  formatProfileBadge,
  getDomainFromMatrixId,
  getEnvironmentFromMatrixId,
  getUsernameFromMatrixId,
} from '../lib/profile-manager';
import { prompt, promptPassword } from '../lib/prompt';
import {
  FG_GREEN,
  FG_YELLOW,
  FG_CYAN,
  FG_MAGENTA,
  FG_RED,
  DIM,
  BOLD,
  RESET,
} from '../lib/colors';

export interface ProfileCommandOptions {
  user?: string;
  password?: string;
  name?: string;
  matrixUrl?: string;
  realmServerUrl?: string;
}

interface EnvironmentDefaults {
  domain: string;
  matrixUrl: string;
  realmServerUrl: string;
}

const MENU_ENVIRONMENTS: Record<
  'staging' | 'production' | 'local',
  EnvironmentDefaults
> = {
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
    realmServerUrl: 'http://localhost:4201/',
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
function computeEnvSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Derive URLs from BOXEL_ENVIRONMENT using the same ".${slug}.localhost"
// pattern that mise-tasks/lib/env-vars.sh produces for env-mode local dev.
function resolveBoxelEnvironment(): EnvironmentDefaults | null {
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
    matrixUrl: `http://matrix.${slug}.localhost`,
    realmServerUrl: `http://realm-server.${slug}.localhost/`,
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
        await addProfile(manager, resolveBoxelEnvironment());
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

async function promptEnvironmentMenu(): Promise<{
  domain: string;
  matrixUrl: string;
  realmServerUrl: string;
}> {
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

async function addProfile(
  manager: ProfileManager,
  envDefaults?: EnvironmentDefaults | null,
): Promise<void> {
  console.log(`\n${BOLD}Add New Profile${RESET}\n`);

  let domain: string;
  let defaultMatrixUrl: string;
  let defaultRealmUrl: string;

  if (envDefaults) {
    console.log(
      `${DIM}Using BOXEL_ENVIRONMENT=${process.env.BOXEL_ENVIRONMENT}${RESET}`,
    );
    domain = envDefaults.domain;
    defaultMatrixUrl = envDefaults.matrixUrl;
    defaultRealmUrl = envDefaults.realmServerUrl;
  } else {
    const menuResult = await promptEnvironmentMenu();
    domain = menuResult.domain;
    defaultMatrixUrl = menuResult.matrixUrl;
    defaultRealmUrl = menuResult.realmServerUrl;
  }

  console.log(`\nEnter your Boxel username (without @ or domain)`);
  console.log(`${DIM}Example: ctse, aallen90${RESET}`);
  const username = await prompt('Username: ');

  if (!username) {
    console.error(`${FG_RED}Error:${RESET} Username is required.`);
    process.exit(1);
  }

  const matrixId = `@${username}:${domain}`;

  if (manager.getProfile(matrixId)) {
    console.log(`\n${FG_YELLOW}Profile ${matrixId} already exists.${RESET}`);
    const overwrite = await prompt('Overwrite? [y/N]: ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  const password = await promptPassword('Password: ');

  if (!password) {
    console.error(`${FG_RED}Error:${RESET} Password is required.`);
    process.exit(1);
  }

  const defaultDisplayName = `${username} \u00b7 ${domain}`;
  const displayNameInput = await prompt(
    `Display name [${defaultDisplayName}]: `,
  );
  const displayName = displayNameInput || defaultDisplayName;

  await manager.addProfile(
    matrixId,
    password,
    displayName,
    defaultMatrixUrl,
    defaultRealmUrl,
  );

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
