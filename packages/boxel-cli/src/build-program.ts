import { Command } from 'commander';
import { profileCommand } from './commands/profile';
import { registerConsolidateWorkspacesCommand } from './commands/consolidate-workspaces';
import { registerReadTranspiledCommand } from './commands/read-transpiled';
import { registerRealmCommand } from './commands/realm/index';
import { registerFileCommand } from './commands/file/index';
import { registerRunCommand } from './commands/run-command';
import { registerSearchCommand } from './commands/search';
import { setQuiet } from './lib/cli-log';
import { warnIfMisplacedLocalRealmDirs } from './lib/realm-local-paths';
import { getProfileManager } from './lib/profile-manager';

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
    .hook('preAction', async (thisCommand) => {
      let opts = thisCommand.optsWithGlobals?.() ?? thisCommand.opts();
      if (opts.quiet) {
        setQuiet(true);
      }
      warnIfMisplacedLocalRealmDirs(process.cwd());
      // One-shot migration for profiles persisted before CS-10725 (when the
      // schema stored `password` instead of `matrixAccessToken`). Runs once
      // per CLI invocation: re-logs-in with the on-disk password and
      // replaces it with the resulting access token. Failures are warned
      // about and skipped so a single broken profile doesn't block the
      // rest of the command.
      try {
        await getProfileManager().migrateLegacyProfiles();
      } catch {
        // migrateLegacyProfiles swallows per-profile failures internally;
        // any error here means something is fundamentally wrong with the
        // profiles file. Surface nothing — the actual command will fail
        // loudly when it tries to use a profile.
      }
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
    .addHelpText(
      'after',
      `
Environment variables (for 'add'):
  BOXEL_PASSWORD       Password; preferred over -p to avoid shell history.
  BOXEL_ENVIRONMENT    An env-mode slug (e.g. a branch name), interpreted
                       like scripts/env-slug.sh: URLs are derived as
                       http://matrix.<slug>.localhost and
                       http://realm-server.<slug>.localhost/. Overridden
                       by --matrix-url / --realm-server-url if provided.`,
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

  registerFileCommand(program);
  registerRealmCommand(program);
  registerRunCommand(program);
  registerSearchCommand(program);
  registerReadTranspiledCommand(program);
  registerConsolidateWorkspacesCommand(program);

  return program;
}
