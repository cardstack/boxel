import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { profileCommand } from './commands/profile';
import { registerReadTranspiledCommand } from './commands/read-transpiled';
import { registerRealmCommand } from './commands/realm/index';
import { registerFileCommand } from './commands/file/index';
import { registerRunCommand } from './commands/run-command';
import { registerSearchCommand } from './commands/search';
import { setQuiet } from './lib/cli-log';

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
);

const program = new Command();

// `--quiet` is implemented by intercepting `console.log/info/debug`.
// New commands: write decorative output (status, confirmations, colored
// lines) with `console.log` — it's silenced for free under `--quiet`.
// For programmatic output (`--json` payloads, raw file bytes), use
// `cliLog.output(...)`. Full guidance: see `lib/cli-log.ts`.
program
  .name('boxel')
  .description('CLI tools for Boxel workspace management')
  .version(pkg.version)
  .option(
    '-q, --quiet',
    'Suppress informational progress logs (info/log/debug). Errors and warnings, plus command result payloads (JSON, file contents), are still emitted. Use this when invoking the CLI from automation (e.g. the software factory test harness) to keep stdout focused on the result.',
  )
  // Toggle quiet mode as soon as the global option is parsed, so that any
  // module-level setup happening inside command actions sees the right
  // state. Commander invokes this hook before any subcommand action.
  .hook('preAction', (thisCommand) => {
    let opts = thisCommand.optsWithGlobals?.() ?? thisCommand.opts();
    if (opts.quiet) {
      setQuiet(true);
    }
  });

// Belt-and-suspenders: also flip quiet mode based on a raw scan of argv,
// so any code that runs between Commander's option parsing and the
// `preAction` hook sees the right state. We scan for the long form only;
// `-q` could legitimately be the value of another option in the future.
if (process.argv.includes('--quiet')) {
  setQuiet(true);
}

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

program.parse();
