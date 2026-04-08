import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { profileCommand } from './commands/profile';
import { pullCommand } from './commands/pull';
import { registerRealmCommand } from './commands/realm/index';

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

const workspace = program
  .command('workspace')
  .description('Workspace sync and management commands');

workspace
  .command('pull')
  .description('Pull files from a Boxel workspace to a local directory')
  .argument(
    '<workspace-url>',
    'The URL of the source workspace (e.g., https://app.boxel.ai/demo/)',
  )
  .argument('<local-dir>', 'The local directory to sync files to')
  .option('--delete', 'Delete local files that do not exist in the workspace')
  .option('--dry-run', 'Show what would be done without making changes')
  .action(
    async (
      workspaceUrl: string,
      localDir: string,
      options: { delete?: boolean; dryRun?: boolean },
    ) => {
      await pullCommand(workspaceUrl, localDir, options);
    },
  );

program.parse();
