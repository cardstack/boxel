import * as readline from 'readline';
import {
  ProfileManager,
  getProfileManager,
  formatProfileBadge,
  getEnvironmentFromMatrixId,
  getEnvironmentShortLabel,
  getUsernameFromMatrixId,
} from '../lib/profile-manager.js';

// ANSI color codes
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_CYAN = '\x1b[36m';
const FG_MAGENTA = '\x1b[35m';
const FG_RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptPassword(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Hide password input
    const stdin = process.stdin;
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    process.stdout.write(question);
    let password = '';

    const onData = (char: Buffer) => {
      const c = char.toString();
      if (c === '\n' || c === '\r') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY) {
          stdin.setRawMode(false);
        }
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit();
      } else if (c === '\u007F' || c === '\b') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += c;
        process.stdout.write('•');
      }
    };

    stdin.on('data', onData);
    stdin.resume();
  });
}

export interface ProfileCommandOptions {
  user?: string;
  password?: string;
  name?: string;
}

export async function profileCommand(
  subcommand?: string,
  arg?: string,
  options?: ProfileCommandOptions
): Promise<void> {
  const manager = getProfileManager();

  switch (subcommand) {
    case 'list':
      await listProfiles(manager);
      break;

    case 'add':
      // Check for password from environment variable (more secure than -p flag)
      const password = options?.password || process.env.BOXEL_PASSWORD;
      if (options?.user && password) {
        // Non-interactive add
        await addProfileNonInteractive(manager, options.user, password, options.name);
      } else {
        await addProfile(manager);
      }
      break;

    case 'switch':
      if (!arg) {
        console.error(`${FG_RED}Error:${RESET} Please specify a profile to switch to.`);
        console.log(`Usage: boxel profile switch <profile-id>`);
        console.log(`\nAvailable profiles:`);
        await listProfiles(manager);
        process.exit(1);
      }
      await switchProfile(manager, arg);
      break;

    case 'remove':
      if (!arg) {
        console.error(`${FG_RED}Error:${RESET} Please specify a profile to remove.`);
        process.exit(1);
      }
      await removeProfile(manager, arg);
      break;

    case 'migrate':
      await migrateFromEnv(manager);
      break;

    default:
      // No subcommand - show current profile
      manager.printStatus();
      console.log(`\n${DIM}Commands:${RESET}`);
      console.log(`  ${FG_CYAN}boxel profile list${RESET}      List all profiles`);
      console.log(`  ${FG_CYAN}boxel profile add${RESET}       Add a new profile`);
      console.log(`  ${FG_CYAN}boxel profile switch${RESET}    Switch active profile`);
      console.log(`  ${FG_CYAN}boxel profile remove${RESET}    Remove a profile`);
      console.log(`  ${FG_CYAN}boxel profile migrate${RESET}   Import from .env file`);
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

    const marker = isActive ? `${FG_GREEN}★${RESET} ` : '  ';
    const envLabel = getEnvironmentShortLabel(env);
    const envColor = env === 'production' ? FG_MAGENTA : FG_CYAN;

    console.log(`${marker}${BOLD}${id}${RESET}`);
    console.log(`    ${DIM}Name:${RESET} ${profile.displayName}`);
    console.log(`    ${DIM}Environment:${RESET} ${envColor}${envLabel}${RESET}`);
    console.log(`    ${DIM}Realm Server:${RESET} ${profile.realmServerUrl}`);
    console.log('');
  }

  if (activeId) {
    console.log(`${DIM}★ = active profile${RESET}`);
  }
}

async function addProfile(manager: ProfileManager): Promise<void> {
  console.log(`\n${BOLD}Add New Profile${RESET}\n`);

  // Choose environment
  console.log(`Which environment?`);
  console.log(`  ${FG_CYAN}1${RESET}) Staging (realms-staging.stack.cards)`);
  console.log(`  ${FG_MAGENTA}2${RESET}) Production (app.boxel.ai)`);

  const envChoice = await prompt('\nChoice [1/2]: ');
  const isProduction = envChoice === '2';

  const domain = isProduction ? 'boxel.ai' : 'stack.cards';
  const defaultMatrixUrl = isProduction
    ? 'https://matrix.boxel.ai'
    : 'https://matrix-staging.stack.cards';
  const defaultRealmUrl = isProduction
    ? 'https://app.boxel.ai/'
    : 'https://realms-staging.stack.cards/';

  // Get username
  console.log(`\nEnter your Boxel username (without @ or domain)`);
  console.log(`${DIM}Example: ctse, aallen90${RESET}`);
  const username = await prompt('Username: ');

  if (!username) {
    console.error(`${FG_RED}Error:${RESET} Username is required.`);
    process.exit(1);
  }

  const matrixId = `@${username}:${domain}`;

  // Check if already exists
  if (manager.getProfile(matrixId)) {
    console.log(`\n${FG_YELLOW}Profile ${matrixId} already exists.${RESET}`);
    const overwrite = await prompt('Overwrite? [y/N]: ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  // Get password
  const password = await promptPassword('Password: ');

  if (!password) {
    console.error(`${FG_RED}Error:${RESET} Password is required.`);
    process.exit(1);
  }

  // Optional display name
  const defaultDisplayName = `${username} · ${domain}`;
  const displayNameInput = await prompt(`Display name [${defaultDisplayName}]: `);
  const displayName = displayNameInput || defaultDisplayName;

  // Save profile
  await manager.addProfile(matrixId, password, displayName, defaultMatrixUrl, defaultRealmUrl);

  console.log(`\n${FG_GREEN}✓${RESET} Profile created: ${formatProfileBadge(matrixId)}`);

  if (manager.getActiveProfileId() === matrixId) {
    console.log(`${DIM}This profile is now active.${RESET}`);
  } else {
    const switchNow = await prompt('Switch to this profile now? [Y/n]: ');
    if (switchNow.toLowerCase() !== 'n') {
      manager.switchProfile(matrixId);
      console.log(`${FG_GREEN}✓${RESET} Switched to ${formatProfileBadge(matrixId)}`);
    }
  }
}

async function switchProfile(manager: ProfileManager, profileId: string): Promise<void> {
  // Allow partial matching
  const profiles = manager.listProfiles();
  let matchedId = profileId;

  // Exact match first
  if (!profiles.includes(profileId)) {
    // Try partial match (username only)
    const matches = profiles.filter(id => {
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
    console.log(`${FG_GREEN}✓${RESET} Switched to ${formatProfileBadge(matchedId)}`);
  } else {
    console.error(`${FG_RED}Error:${RESET} Failed to switch profile.`);
    process.exit(1);
  }
}

async function removeProfile(manager: ProfileManager, profileId: string): Promise<void> {
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
    console.log(`${FG_GREEN}✓${RESET} Profile removed.`);

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
  displayName?: string
): Promise<void> {
  // Validate matrix ID format
  if (!matrixId.startsWith('@') || !matrixId.includes(':')) {
    console.error(`${FG_RED}Error:${RESET} Invalid Matrix ID format. Expected @user:domain`);
    process.exit(1);
  }

  // Check if already exists
  if (manager.getProfile(matrixId)) {
    console.log(`${FG_YELLOW}Profile ${matrixId} already exists. Updating password.${RESET}`);
    await manager.updatePassword(matrixId, password);
    if (displayName) {
      manager.updateDisplayName(matrixId, displayName);
    }
    console.log(`${FG_GREEN}✓${RESET} Profile updated: ${formatProfileBadge(matrixId)}`);
    return;
  }

  await manager.addProfile(matrixId, password, displayName);
  console.log(`${FG_GREEN}✓${RESET} Profile created: ${formatProfileBadge(matrixId)}`);

  const activeId = manager.getActiveProfileId();
  if (activeId !== matrixId) {
    console.log(`${DIM}Use 'boxel profile switch ${matrixId}' to switch to this profile.${RESET}`);
  }
}

async function migrateFromEnv(manager: ProfileManager): Promise<void> {
  console.log(`\n${BOLD}Migrate from .env${RESET}\n`);

  const matrixUrl = process.env.MATRIX_URL;
  const username = process.env.MATRIX_USERNAME;
  const password = process.env.MATRIX_PASSWORD;

  if (!matrixUrl || !username || !password) {
    console.log(`${FG_YELLOW}No complete credentials found in environment variables.${RESET}`);
    console.log(`\nRequired variables: MATRIX_URL, MATRIX_USERNAME, MATRIX_PASSWORD, REALM_SERVER_URL`);
    return;
  }

  const profileId = await manager.migrateFromEnv();
  if (profileId) {
    console.log(`${FG_GREEN}✓${RESET} Created profile: ${formatProfileBadge(profileId)}`);
    console.log(`\n${DIM}You can now remove credentials from .env if desired.${RESET}`);
  } else {
    console.log(`${FG_YELLOW}Migration failed or profile already exists.${RESET}`);
  }
}
