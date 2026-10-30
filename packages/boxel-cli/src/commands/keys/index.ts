import type { Command } from 'commander';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { FG_GREEN, FG_RED, DIM, RESET } from '../../lib/colors.ts';
import { secureSignOut } from '../../lib/secure-session.ts';
import {
  keysAdd,
  keysDelete,
  keysList,
  keysReplace,
  keysShare,
  keysShares,
  keysShow,
  keysSwap,
  keysUnshare,
  runKeysCommand,
  signInToManageKeys,
} from './manage.ts';

// `boxel keys`: the signed-in user's own keys. Changing a key needs a session
// signed in on the secure origin, which the CLI gets through the browser
// (`boxel keys sign-in`, or the first change that needs one); the profile's
// ordinary session can't authorize one.

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
  let session = await signInToManageKeys(pm, {
    openBrowserFn: options.openBrowserFn,
    ...(options.timeout ? { timeoutMs: Number(options.timeout) * 1000 } : {}),
  });
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

  keys
    .command('list')
    .description('List your keys, without their values')
    .option('--json', 'Output JSON')
    .action((options: { json?: boolean }) =>
      runKeysCommand(options.json, () => keysList(options)),
    );

  keys
    .command('show')
    .description("Show one of your keys and the shares it's in")
    .argument('<name>', 'The key')
    .option('--json', 'Output JSON')
    .action((name: string, options: { json?: boolean }) =>
      runKeysCommand(options.json, () => keysShow(name, options)),
    );

  serviceAccountOptions(
    valueOptions(
      keys
        .command('add')
        .description(
          'Add a key. The value is typed at a masked prompt, or read with --stdin or --key-file. A Google service account (--kind google-service-account) is its JSON key file, read with --key-file or --stdin, with its --scope and optional --subject',
        )
        .argument('<name>', 'A name for the key, unique among your keys'),
    ).option(
      '--kind <kind>',
      'static (the default): the value is sent as it is; google-service-account: a JSON key file Boxel mints access tokens from',
    ),
  ).action((name: string, options: ValueCommandOptions) =>
    runKeysCommand(options.json, () => keysAdd(name, options)),
  );

  serviceAccountOptions(
    valueOptions(
      keys
        .command('replace')
        .description(
          "Replace a key's value. The value is typed at a masked prompt, or read with --stdin or --key-file. A Google service account takes a new JSON key file, and keeps its scopes and the user it acts as unless --scope, --subject or --no-subject is given",
        )
        .argument('<name>', 'The key'),
    ),
    { replace: true },
  ).action((name: string, options: ValueCommandOptions) =>
    runKeysCommand(options.json, () => keysReplace(name, options)),
  );

  keys
    .command('delete')
    .description(
      'Delete a key, after listing the shares it would suspend and asking you to confirm',
    )
    .argument('<name>', 'The key')
    .option('--yes', "Don't ask to confirm")
    .option('--json', 'Output JSON')
    .action((name: string, options: { json?: boolean; yes?: boolean }) =>
      runKeysCommand(options.json, () => keysDelete(name, options)),
    );

  keys
    .command('share')
    .description(
      'Share a key into a realm you write to, for the people there to use',
    )
    .argument('<name>', 'The key')
    .requiredOption('--realm <url>', 'The realm')
    .option('--as <label>', 'The label the realm knows it by (default: <name>)')
    .option('--json', 'Output JSON')
    .action(
      (name: string, options: { realm: string; as?: string; json?: boolean }) =>
        runKeysCommand(options.json, () => keysShare(name, options)),
    );

  keys
    .command('unshare')
    .description('Take one of your shares out of a realm')
    .argument('<label>', 'The share')
    .requiredOption('--realm <url>', 'The realm')
    .option('--json', 'Output JSON')
    .action((label: string, options: { realm: string; json?: boolean }) =>
      runKeysCommand(options.json, () => keysUnshare(label, options)),
    );

  keys
    .command('swap')
    .description(
      "Put one of your keys into a realm's suspended share, which resumes with you as its owner",
    )
    .argument('<label>', 'The share')
    .requiredOption('--realm <url>', 'The realm')
    .requiredOption('--key <name>', 'Your key')
    .option('--json', 'Output JSON')
    .action(
      (
        label: string,
        options: { realm: string; key: string; json?: boolean },
      ) => runKeysCommand(options.json, () => keysSwap(label, options)),
    );

  keys
    .command('shares')
    .description("List a realm's shares, for one of its writers")
    .requiredOption('--realm <url>', 'The realm')
    .option('--json', 'Output JSON')
    .action((options: { realm: string; json?: boolean }) =>
      runKeysCommand(options.json, () => keysShares(options)),
    );
}

interface ValueCommandOptions {
  stdin?: boolean;
  keyFile?: string;
  json?: boolean;
  kind?: string;
  subject?: string | false;
  scope?: string[];
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

// A replace keeps a service account's scopes and subject unless they are
// given, so only it takes --no-subject, to act as the service account itself.
function serviceAccountOptions(
  command: Command,
  { replace = false }: { replace?: boolean } = {},
): Command {
  command
    .option(
      '--subject <email>',
      replace
        ? 'A Google service account: the user to act as, with domain-wide delegation (default: the one it acts as now)'
        : 'A Google service account: the user to act as, with domain-wide delegation',
    )
    .option(
      '--scope <scope>',
      replace
        ? 'A Google service account: a scope its tokens ask for (repeat for more). Given, it replaces all of the current scopes (default: keep them)'
        : 'A Google service account: a scope its tokens ask for (repeat for more)',
      collect,
    );
  if (replace) {
    command.option(
      '--no-subject',
      'A Google service account: act as the service account itself',
    );
  }
  return command;
}

function valueOptions(command: Command): Command {
  return command
    .option('--stdin', 'Read the key value from stdin')
    .option('--key-file <path>', 'Read the key value from a file')
    .option('--json', 'Output JSON');
}
