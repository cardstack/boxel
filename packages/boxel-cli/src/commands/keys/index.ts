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
  keysClients,
  keysConnect,
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
import {
  keysApprove,
  keysPending,
  keysRevoke,
  keysUngrant,
} from './approve.ts';

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

  oauthClientOptions(
    serviceAccountOptions(
      valueOptions(
        keys
          .command('add')
          .description(
            'Add a key. The value is typed at a masked prompt, or read with --stdin or --key-file. A Google service account (--kind google-service-account) is its JSON key file, read with --key-file or --stdin, with its --scope and optional --subject. An OAuth client (--kind oauth-client) is its client secret, with its --client-id, --authorize-url, --token-url and --scopes',
          )
          .argument('<name>', 'A name for the key, unique among your keys'),
      ).option(
        '--kind <kind>',
        'static (the default): the value is sent as it is; google-service-account: a JSON key file Boxel mints access tokens from; oauth-client: an app registered with a vendor, which people connect their accounts through',
      ),
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
    .option(
      '--timeout <seconds>',
      'How long to wait for the secure window, when the swap is confirmed there',
    )
    .option('--json', 'Output JSON')
    .action(
      (
        label: string,
        options: {
          realm: string;
          key: string;
          timeout?: string;
          json?: boolean;
        },
      ) => runKeysCommand(options.json, () => keysSwap(label, options)),
    );

  approvalOptions(
    keys
      .command('approve')
      .description(
        "Approve a card's operations to send one of your keys, or your share in the realm, from its pipelines. Without .<operation>, every operation on the class that needs your approval is approved as one batch. Every request is printed before you confirm; one that sends a key somewhere it has never been sent is confirmed in the secure window",
      )
      .argument(
        '<name>',
        'Your key, or the label of your share in the realm, that fills the slots',
      ),
  )
    .option(
      '--interactive',
      'Also approve use from a card, the AI assistant and the CLI, not only pipelines (refused by the realm server for now)',
    )
    .option(
      '--anonymous',
      'With --interactive, also approve use by anyone who can reach the card (refused by the realm server for now)',
    )
    .option(
      '--timeout <seconds>',
      'How long to wait for the secure window, when the approval is confirmed there',
    )
    .action((name: string, options: Parameters<typeof keysApprove>[1]) =>
      runKeysCommand(options.json, () => keysApprove(name, options)),
    );

  approvalOptions(
    keys
      .command('revoke')
      .description(
        "Revoke your approvals of a card's operations that send one of your keys, or your share in the realm. The key keeps its grants",
      )
      .argument(
        '<name>',
        'Your key, or the label of your share in the realm, the approvals send',
      ),
  ).action((name: string, options: Parameters<typeof keysRevoke>[1]) =>
    runKeysCommand(options.json, () => keysRevoke(name, options)),
  );

  keys
    .command('pending')
    .description(
      'List your approvals that need approving again: a request that changed since you approved it, or one whose grant was removed',
    )
    .option('--json', 'Output JSON')
    .action((options: { json?: boolean }) =>
      runKeysCommand(options.json, () => keysPending(options)),
    );

  keys
    .command('ungrant')
    .description(
      'Stop a key being sent to a destination: remove its grant there, after listing the approvals that revokes',
    )
    .argument('<name>', 'The key')
    .requiredOption(
      '--destination <url>',
      'The grant’s destination, as `boxel keys show` lists it',
    )
    .option('--yes', "Don't ask to confirm")
    .option('--json', 'Output JSON')
    .action(
      (
        name: string,
        options: { destination: string; yes?: boolean; json?: boolean },
      ) => runKeysCommand(options.json, () => keysUngrant(name, options)),
    );

  keys
    .command('shares')
    .description("List a realm's shares, for one of its writers")
    .requiredOption('--realm <url>', 'The realm')
    .option('--json', 'Output JSON')
    .action((options: { realm: string; json?: boolean }) =>
      runKeysCommand(options.json, () => keysShares(options)),
    );

  keys
    .command('clients')
    .description(
      "List the OAuth clients you can connect your accounts through: Boxel's own, yours, and with --realm those shared into the realm",
    )
    .option('--realm <url>', 'Also list the clients shared into this realm')
    .option('--json', 'Output JSON')
    .action((options: { realm?: string; json?: boolean }) =>
      runKeysCommand(options.json, () => keysClients(options)),
    );

  keys
    .command('connect')
    .description(
      'Connect your account with a service by signing in to it through an OAuth client, in the browser. No token is shown: the connection is kept as one of your keys',
    )
    .argument('<name>', 'A name for the connection, unique among your keys')
    .requiredOption(
      '--client <client>',
      "platform:<name> for one of Boxel's own (such as platform:github), the label of a client shared into the --realm, or the name of your own client",
    )
    .option('--realm <url>', 'The realm the client is shared into')
    .option(
      '--timeout <seconds>',
      'How long to wait for the browser (at most the 10 minutes a sign-in lasts)',
    )
    .option('--json', 'Output JSON')
    .action(
      (
        name: string,
        options: {
          client: string;
          realm?: string;
          timeout?: string;
          json?: boolean;
        },
      ) => runKeysCommand(options.json, () => keysConnect(name, options)),
    );
}

// What `approve` and `revoke` name: the operations, the realm they are
// approved in, and optionally one slot and one card.
function approvalOptions(command: Command): Command {
  return command
    .requiredOption(
      '--operation <operation>',
      '<module>#<Class> for every operation on the class, or <module>#<Class>.<operation> for one. The module is a URL, or a path relative to --realm',
    )
    .requiredOption('--realm <url>', 'The realm the operations run in')
    .option(
      '--slot <slot>',
      'Only this credential slot, as written in the declaration: userKey, apiKey or apiKey:<name>',
    )
    .option(
      '--instance <url>',
      'The card, for an operation approved for each card on its own',
    )
    .option('--yes', "Don't ask to confirm")
    .option('--json', 'Output JSON');
}

interface ValueCommandOptions {
  stdin?: boolean;
  keyFile?: string;
  json?: boolean;
  kind?: string;
  subject?: string | false;
  scope?: string[];
  clientId?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  grantType?: string;
  tokenAuth?: string;
  apiHost?: string[];
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

function oauthClientOptions(command: Command): Command {
  return command
    .option('--client-id <id>', 'An OAuth client: its client id')
    .option(
      '--authorize-url <url>',
      'An OAuth client: the page people sign in on',
    )
    .option('--token-url <url>', 'An OAuth client: its token endpoint')
    .option(
      '--scopes <scopes...>',
      'An OAuth client: the scopes or permissions it asks for',
    )
    .option(
      '--grant-type <grant>',
      'An OAuth client: authorization_code (the default), which people sign in through, or client_credentials, which mints tokens with no person',
    )
    .option(
      '--token-auth <method>',
      'An OAuth client: how it authenticates at its token endpoint, client_secret_post (the default) or client_secret_basic',
    )
    .option(
      '--api-host <url>',
      'An OAuth client: an API address it serves, so the secure window offers it for operations sent there (repeat for more)',
      collect,
    );
}

function valueOptions(command: Command): Command {
  return command
    .option('--stdin', 'Read the key value from stdin')
    .option('--key-file <path>', 'Read the key value from a file')
    .option('--json', 'Output JSON');
}
