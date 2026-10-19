import type { Command } from 'commander';
import {
  getProfileManager,
  getUsernameFromMatrixId,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { FG_GREEN, FG_RED, DIM, RESET } from '../../lib/colors.ts';
import { secureSignIn, secureSignOut } from '../../lib/secure-session.ts';

// `boxel keys`: the signed-in user's own keys. Changing a key needs a session
// signed in on the secure origin, which the CLI gets through the browser
// (`boxel keys sign-in`); the profile's ordinary session can't authorize one.

interface SignInOptions {
  timeout?: string;
}

interface SignInDeps {
  profileManager?: ProfileManager;
  // Injected by tests, which act as the browser.
  openBrowserFn?: (url: string) => Promise<boolean>;
}

function activeProfile(pm: ProfileManager) {
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(NO_ACTIVE_PROFILE_ERROR);
  }
  return active;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export async function keysSignIn(
  options: SignInOptions & SignInDeps = {},
): Promise<void> {
  let pm = options.profileManager ?? getProfileManager();
  let { profile } = activeProfile(pm);
  let session = await secureSignIn({
    realmServerUrl: profile.realmServerUrl,
    ...(options.openBrowserFn ? { openBrowserFn: options.openBrowserFn } : {}),
    username: getUsernameFromMatrixId(profile.matrixUserId),
    ...(options.timeout ? { timeoutMs: Number(options.timeout) * 1000 } : {}),
  });
  if (session.userId !== profile.matrixUserId) {
    await secureSignOut(profile.realmServerUrl, session.token).catch(() => {});
    throw new Error(
      `The browser signed in ${session.userId}, but this profile is ` +
        `${profile.matrixUserId}. Run it again and sign in as ${profile.matrixUserId}.`,
    );
  }
  pm.setSecureSession(session);
  console.log(
    `${FG_GREEN}Signed in to manage keys${RESET} as ${session.userId} until ${formatTime(session.expiresAt)}.`,
  );
}

export async function keysSignOut(
  options: { profileManager?: ProfileManager } = {},
): Promise<void> {
  let pm = options.profileManager ?? getProfileManager();
  let { profile } = activeProfile(pm);
  let session = pm.getSecureSession();
  if (session) {
    // Forgotten only once the server has ended it, so a failed sign-out can
    // be tried again.
    await secureSignOut(profile.realmServerUrl, session.token);
  }
  pm.clearSecureSession();
  console.log('Signed out of managing keys.');
}

export function keysStatus(
  options: { profileManager?: ProfileManager } = {},
): void {
  let pm = options.profileManager ?? getProfileManager();
  activeProfile(pm);
  let session = pm.getSecureSession();
  if (session) {
    console.log(
      `Signed in to manage keys as ${session.userId} until ${formatTime(session.expiresAt)}.`,
    );
  } else {
    console.log(
      `Not signed in to manage keys. ${DIM}Run \`boxel keys sign-in\`.${RESET}`,
    );
  }
}

async function run(fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    console.error(`${FG_RED}Error:${RESET} ${e?.message ?? e}`);
    process.exitCode = 1;
  }
}

export function registerKeysCommand(program: Command): void {
  let keys = program
    .command('keys')
    .description(
      'Manage your own keys. Changing one needs you to sign in through the browser',
    );

  keys
    .command('sign-in')
    .description(
      'Sign in to Boxel in the browser, so this CLI can change your keys',
    )
    .option('--timeout <seconds>', 'How long to wait for the browser')
    .action((options: SignInOptions) => run(() => keysSignIn(options)));

  keys
    .command('sign-out')
    .description('End the session this CLI uses to change your keys')
    .action(() => run(() => keysSignOut()));

  keys
    .command('status')
    .description('Say whether this CLI is signed in to change your keys')
    .action(() => run(() => keysStatus()));
}
