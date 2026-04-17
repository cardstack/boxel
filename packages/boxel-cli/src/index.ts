import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { profileCommand } from './commands/profile';
import { registerReadTranspiledCommand } from './commands/read-transpiled';
import { registerRealmCommand } from './commands/realm/index';
import { registerRunCommand } from './commands/run-command';

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
);

const program = new Command();

program
  .name('boxel')
  .description('CLI tools for Boxel workspace management')
  .version(pkg.version);

program
  .command('profile')
  .description('Manage saved profiles for different users/environments')
  .argument('[subcommand]', 'list | add | switch | remove | migrate')
  .argument('[arg]', 'Profile ID (for switch/remove)')
  .option('-u, --user <matrixId>', 'Matrix user ID (e.g., @user:boxel.ai)')
  .option('-p, --password <password>', 'Password (for add command)')
  .option('-n, --name <displayName>', 'Display name (for add command)')
  .action(
    async (
      subcommand?: string,
      arg?: string,
      options?: { user?: string; password?: string; name?: string },
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

registerRealmCommand(program);
registerRunCommand(program);
registerReadTranspiledCommand(program);

program.parse();
