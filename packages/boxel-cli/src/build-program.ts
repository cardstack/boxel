import { Command } from 'commander';
import { profileCommand } from './commands/profile.ts';
import { registerBrowseCommand } from './commands/browse.ts';
import { registerConsolidateWorkspacesCommand } from './commands/consolidate-workspaces.ts';
import { registerLintCommand } from './commands/lint.ts';
import { registerParseCommand } from './commands/parse.ts';
import { registerReadTranspiledCommand } from './commands/read-transpiled.ts';
import { registerRealmCommand } from './commands/realm/index.ts';
import { registerRealmServerCommand } from './commands/realm-server/index.ts';
import { registerFileCommand } from './commands/file/index.ts';
import { registerKeysCommand } from './commands/keys/index.ts';
import { registerOperationsCommand } from './commands/operations.ts';
import { registerRunCommand } from './commands/run-command.ts';
import { registerCaptureCommand } from './commands/capture.ts';
import { registerSearchCommand } from './commands/search.ts';
import { registerTestCommand } from './commands/test.ts';
import { setQuiet } from './lib/cli-log.ts';
import { FG_RED, RESET } from './lib/colors.ts';
import { getProfileManager } from './lib/profile-manager.ts';
import { warnIfMisplacedLocalRealmDirs } from './lib/realm-local-paths.ts';

// Act as the profile `--profile` (or else `BOXEL_PROFILE`) names for this one
// invocation. Only this process is affected: the active profile, which every
// other terminal and agent session on the machine uses, is left as it is.
//
// `boxel profile` manages the saved profiles themselves, so it takes no
// `--profile` and ignores `BOXEL_PROFILE`; it always shows and changes the
// active profile.
function selectInvocationProfile(
  program: Command,
  actionCommand: Command,
): void {
  let flag = program.opts().profile as string | undefined;
  let fail = (message: string) => {
    console.error(`${FG_RED}Error:${RESET} ${message}`);
    process.exit(1);
  };
  if (actionCommand.parent === program && actionCommand.name() === 'profile') {
    if (flag !== undefined) {
      fail(
        '`boxel profile` manages the saved profiles and does not take --profile. ' +
          'To change the active profile, run `boxel profile switch <id>`.',
      );
    }
    return;
  }
  // An empty value is usually an unset shell variable (`--profile "$OWNER"`),
  // and falling back to the active profile would act as the wrong account.
  // An empty BOXEL_PROFILE counts as not set, so `BOXEL_PROFILE=` clears it.
  if (flag === '') {
    fail(
      '--profile was given an empty value. Pass the ID of a saved profile; ' +
        '`boxel profile list` shows them.',
    );
  }
  let fromEnv = flag === undefined;
  let profileId = flag ?? process.env.BOXEL_PROFILE;
  if (!profileId) {
    return;
  }
  try {
    getProfileManager().selectProfile(profileId);
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    fail(
      fromEnv
        ? `${message} (BOXEL_PROFILE is set to "${profileId}".)`
        : message,
    );
  }
}

/**
 * Construct the boxel CLI program with every command registered. Pure builder
 * — does not call `program.parse()` and has no side effects on argv. Both the
 * runtime entry point (`src/index.ts`) and the plugin generator
 * (`scripts/build-plugin.ts`) call this so the Commander tree is one source of
 * truth.
 */
export function buildBoxelProgram(version: string): Command {
  const program = new Command();

  program
    .name('boxel')
    .description('CLI tools for Boxel workspace management')
    .version(version)
    .option(
      '-q, --quiet',
      'Suppress informational progress logs (info/log/debug). Errors and warnings, plus command result payloads (JSON, file contents), are still emitted. Use this when invoking the CLI from automation (e.g. the software factory test harness) to keep stdout focused on the result.',
    )
    .option(
      '--profile <id>',
      'Act as this saved profile (its exact Matrix ID) for this one command instead of the active profile, which stays as it is for every other terminal and session. Defaults to BOXEL_PROFILE when that is set.',
    )
    .hook('preAction', (thisCommand, actionCommand) => {
      let opts = thisCommand.optsWithGlobals?.() ?? thisCommand.opts();
      if (opts.quiet) {
        setQuiet(true);
      }
      selectInvocationProfile(thisCommand, actionCommand);
      warnIfMisplacedLocalRealmDirs(process.cwd());
    });

  program
    .command('profile')
    .description('Manage saved profiles for different users/environments')
    .argument('[subcommand]', 'list | add | switch | remove | migrate')
    .argument('[arg]', 'Profile ID (for switch/remove)')
    .option('-u, --user <matrixId>', 'Matrix user ID (e.g., @user:boxel.ai)')
    .option('-p, --password <password>', 'Password (for add command)')
    .option('-n, --name <displayName>', 'Display name (for add command)')
    .option(
      '-m, --matrix-url <url>',
      'Matrix server URL (for add command with non-standard domains)',
    )
    .option(
      '-r, --realm-server-url <url>',
      'Realm server URL (for add command with non-standard domains)',
    )
    .option(
      '--no-browser',
      'Sign in with a username and password in the terminal instead of opening a browser (for add command)',
    )
    .option(
      '--host-url <url>',
      "Sign in on this origin's /cli-auth page instead of the realm server's secure origin (for add command)",
    )
    .option('--production', 'Target production — the default (for add command)')
    .option(
      '--staging',
      'Target staging instead of production (for add command)',
    )
    .option(
      '--local',
      'Target a local dev server instead of production (for add command)',
    )
    .option(
      '--json',
      'Output the complete profile set as JSON (for list command)',
    )
    .addHelpText(
      'after',
      `
Sign-in (for 'add'):
  Interactive 'boxel profile add' opens your browser to the Boxel sign-in
  page, which offers a username/password form, Google, and creating an
  account. It is on the realm server's secure origin, and that one sign-in
  also signs the profile in for 'boxel keys'. A realm server without a
  secure origin that can do this gets the host app's own sign-in page, as
  does --host-url, which names the origin whose page to open. Use
  --no-browser to sign in with a username and password in the terminal
  instead. Supplying -u with a password (or BOXEL_PASSWORD) stays fully
  non-interactive and never opens a browser, which is the path to use in CI.

Environment (for 'add'):
  Defaults to production. Pass --staging or --local for another environment
  (at most one of --production / --staging / --local), or point at your own
  URLs with --matrix-url / --realm-server-url / --host-url, which override
  the chosen environment field by field. With -u, the Matrix ID's own domain
  picks the environment — boxel.ai, stack.cards, and localhost are
  recognized, and any other domain requires --matrix-url and
  --realm-server-url.

Environment variables (for 'add'):
  BOXEL_PASSWORD       Password; preferred over -p to avoid shell history.
  BOXEL_ENVIRONMENT    An env-mode slug (e.g. a branch name), interpreted
                       like scripts/env-slug.sh: URLs are derived as
                       https://matrix.<slug>.localhost and
                       https://realm-server.<slug>.localhost/. Overridden
                       by --matrix-url / --realm-server-url, by
                       --production / --staging / --local, and by a -u
                       Matrix ID on a recognized domain.`,
    )
    .action(
      async (
        subcommand?: string,
        arg?: string,
        options?: {
          user?: string;
          password?: string;
          name?: string;
          matrixUrl?: string;
          realmServerUrl?: string;
          browser?: boolean;
          hostUrl?: string;
          production?: boolean;
          staging?: boolean;
          local?: boolean;
          json?: boolean;
        },
      ) => {
        if (options?.password) {
          console.warn(
            'Warning: Supplying a password via -p/--password may expose it in shell history and process listings. ' +
              'For non-interactive usage, prefer the BOXEL_PASSWORD environment variable or use "boxel profile add" interactively.',
          );
        }
        await profileCommand(subcommand, arg, options);
      },
    );

  registerBrowseCommand(program);
  registerFileCommand(program);
  registerKeysCommand(program);
  registerLintCommand(program);
  registerOperationsCommand(program);
  registerParseCommand(program);
  registerRealmCommand(program);
  registerRealmServerCommand(program);
  registerRunCommand(program);
  registerCaptureCommand(program);
  registerSearchCommand(program);
  registerTestCommand(program);
  registerReadTranspiledCommand(program);
  registerConsolidateWorkspacesCommand(program);

  return program;
}
