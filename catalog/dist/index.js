#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { listCommand } from './commands/list.js';
import { syncCommand } from './commands/sync.js';
import { checkCommand } from './commands/check.js';
import { statusCommand } from './commands/status.js';
import { createCommand } from './commands/create.js';
import { historyCommand } from './commands/history.js';
import { watchCommand } from './commands/watch.js';
import { trackCommand } from './commands/track.js';
import { stopCommand } from './commands/stop.js';
import { skillsCommand } from './commands/skills.js';
import { touchCommand } from './commands/touch.js';
import { editCommand } from './commands/edit.js';
import { milestoneCommand } from './commands/milestone.js';
import { shareCommand } from './commands/share.js';
import { gatherCommand } from './commands/gather.js';
import { realmsCommand } from './commands/realms.js';
import { profileCommand } from './commands/profile.js';
import { loadConfig } from './lib/realm-config.js';
const program = new Command();
program
    .name('boxel')
    .description('CLI tools for syncing files between local directories and Boxel workspaces')
    .version('1.0.0');
program
    .command('push')
    .description('Push local files to a Boxel workspace')
    .argument('<local-dir>', 'The local directory containing files to sync')
    .argument('<workspace-url>', 'The URL of the target workspace (e.g., https://app.boxel.ai/demo/)')
    .option('--delete', 'Delete remote files that do not exist locally')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--force', 'Upload all files, even if unchanged')
    .action(async (localDir, workspaceUrl, options) => {
    await pushCommand(localDir, workspaceUrl, options);
});
program
    .command('pull')
    .description('Pull files from a Boxel workspace to a local directory')
    .argument('<workspace-url>', 'The URL of the source workspace (e.g., https://app.boxel.ai/demo/)')
    .argument('<local-dir>', 'The local directory to sync files to')
    .option('--delete', 'Delete local files that do not exist in the workspace')
    .option('--dry-run', 'Show what would be done without making changes')
    .action(async (workspaceUrl, localDir, options) => {
    await pullCommand(workspaceUrl, localDir, options);
});
program
    .command('list')
    .alias('ls')
    .description('List all workspaces you have access to')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
    await listCommand(options);
});
program
    .command('sync')
    .description('Bidirectional sync between local directory and workspace')
    .argument('[workspace]', 'Workspace reference: . | ./path | @user/workspace | https://...')
    .argument('[workspace-url]', 'Workspace URL (only needed if first arg is a local path)')
    .option('--prefer-local', 'Auto-resolve conflicts by keeping local version')
    .option('--prefer-remote', 'Auto-resolve conflicts by keeping remote version')
    .option('--prefer-newest', 'Auto-resolve conflicts by keeping newest version')
    .option('--delete', 'Sync deletions (remove files deleted on either side)')
    .option('--dry-run', 'Show what would be done without making changes')
    .action(async (workspace, workspaceUrl, options) => {
    // Handle different argument patterns
    const ref = workspace || '.';
    // If it's a local path and no URL provided, resolve from manifest
    if ((ref === '.' || ref.startsWith('./') || ref.startsWith('/')) && !workspaceUrl) {
        // Will be resolved by sync command using manifest
        await syncCommand(ref, '', options);
    }
    else if (ref.startsWith('@') || ref.startsWith('http')) {
        // @user/workspace or URL - resolve workspace
        await syncCommand(ref, '', options);
    }
    else if (workspaceUrl) {
        // Traditional: local-dir workspace-url
        await syncCommand(ref, workspaceUrl, options);
    }
    else {
        await syncCommand(ref, '', options);
    }
});
program
    .command('check')
    .description('Check if a file is in sync with remote before editing')
    .argument('<file>', 'The file to check')
    .option('--sync', 'Auto-pull if remote has changes and local is unchanged')
    .action(async (file, options) => {
    await checkCommand(file, options);
});
program
    .command('create')
    .description('Create a new workspace')
    .argument('<endpoint>', 'URL endpoint for the workspace (lowercase, numbers, hyphens)')
    .argument('<name>', 'Display name for the workspace')
    .option('--background <url>', 'Background image URL')
    .option('--icon <url>', 'Icon image URL')
    .action(async (endpoint, name, options) => {
    await createCommand(endpoint, name, options);
});
program
    .command('history')
    .alias('hist')
    .description('View and restore checkpoint history')
    .argument('[workspace]', 'Workspace directory (default: .)')
    .option('-r, --restore [number]', 'Restore a checkpoint (optionally by number or hash)')
    .option('-m, --message <message>', 'Create a manual checkpoint with a custom message')
    .action(async (workspace, options) => {
    await historyCommand(workspace || '.', options);
});
program
    .command('status')
    .alias('st')
    .description('Show sync status for workspace - new/changed files on remote and local')
    .argument('[workspace]', 'Workspace reference: . | ./path | @user/workspace (default: .)')
    .option('--all', 'Show status of all your workspaces')
    .option('--pull', 'Pull new and modified files from remote')
    .action(async (workspace, options) => {
    await statusCommand(workspace, options);
});
program
    .command('watch')
    .description('Watch for server changes and create checkpoints automatically')
    .argument('[workspaces...]', 'Workspace directories to watch (default: configured realms or .)')
    .option('-i, --interval <seconds>', 'Check interval in seconds (default: 30)', '30')
    .option('-d, --debounce <seconds>', 'Wait for changes to settle before checkpoint (default: 5)', '5')
    .option('-q, --quiet', 'Only show output when changes detected')
    .action(async (workspaces, options) => {
    let refs = workspaces;
    // If no workspaces provided, try to load from config
    if (refs.length === 0) {
        const config = loadConfig();
        if (config && config.realms.length > 0) {
            refs = config.realms.map(r => r.path);
            console.log(`Using configured realms from .boxel-workspaces.json\n`);
        }
        else {
            refs = ['.'];
        }
    }
    await watchCommand(refs, {
        interval: options.interval ? parseInt(options.interval) : 30,
        debounce: options.debounce ? parseInt(options.debounce) : 5,
        quiet: options.quiet,
    });
});
program
    .command('track')
    .description('Track local file changes and create checkpoints automatically')
    .argument('[workspace]', 'Workspace directory to track (default: .)')
    .option('-d, --debounce <seconds>', 'Wait for changes to settle before checkpoint (default: 3)', '3')
    .option('-i, --interval <seconds>', 'Minimum seconds between checkpoints (default: 10)', '10')
    .option('-q, --quiet', 'Only show output when checkpoints created')
    .action(async (workspace, options) => {
    await trackCommand(workspace || '.', {
        debounce: options.debounce ? parseInt(options.debounce) : 3,
        interval: options.interval ? parseInt(options.interval) : 10,
        quiet: options.quiet,
    });
});
program
    .command('stop')
    .description('Stop all running watch and track processes')
    .action(async () => {
    await stopCommand();
});
program
    .command('skills')
    .description('Fetch and manage Boxel skill cards as Claude Code commands')
    .option('-l, --list', 'List all available skills')
    .option('-e, --enable <name>', 'Enable a skill by name or ID')
    .option('-d, --disable <name>', 'Disable a skill by name or ID')
    .option('-r, --refresh', 'Refresh skills from Boxel servers')
    .option('--export <dir>', 'Export enabled skills as Claude commands to a directory')
    .option('--realm <url>', 'Fetch skills from a specific realm URL')
    .action(async (options) => {
    await skillsCommand(options);
});
program
    .command('touch')
    .description('Touch files to force realm re-indexing')
    .argument('[workspace]', 'Workspace reference: . | ./path | @user/workspace (default: .)')
    .argument('[files...]', 'Specific files to touch (default: all .json and .gts files)')
    .option('--all', 'Touch all .json and .gts files')
    .option('--dry-run', 'Show what would be done without making changes')
    .action(async (workspace, files, options) => {
    await touchCommand(workspace || '.', files || [], options);
});
program
    .command('edit')
    .description('Mark files as being edited (watch mode will skip them)')
    .argument('[workspace]', 'Workspace reference: . | ./path (default: .)')
    .argument('[files...]', 'Files to mark as being edited')
    .option('-l, --list', 'List files currently being edited')
    .option('-d, --done', 'Mark files as done editing (or all if no files specified)')
    .option('-c, --clear', 'Clear all edit locks')
    .option('-a, --agent <name>', 'Name of editing agent (default: user)')
    .action(async (workspace, files, options) => {
    await editCommand(workspace || '.', files || [], options);
});
program
    .command('milestone')
    .alias('ms')
    .description('Mark checkpoints as milestones to demarcate major successes')
    .argument('[workspace]', 'Workspace directory (default: .)')
    .argument('[checkpoint]', 'Checkpoint number or hash to mark')
    .option('-n, --name <name>', 'Name for the milestone')
    .option('-l, --list', 'List all milestones')
    .option('-r, --remove <ref>', 'Remove milestone from checkpoint (by number or hash)')
    .action(async (workspace, checkpoint, options) => {
    await milestoneCommand(workspace || '.', options, checkpoint);
});
program
    .command('share')
    .description('Share workspace state to a GitHub repository via PR')
    .argument('[workspace]', 'Workspace directory (default: .)')
    .requiredOption('-t, --target <path>', 'Target git repository path')
    .option('-m, --milestone <name>', 'Use specific milestone (default: latest or current state)')
    .option('-s, --subfolder <path>', 'Subfolder in target repo (auto-detected if not specified)')
    .option('-b, --branch <name>', 'Branch name (auto-generated if not specified)')
    .option('--title <title>', 'PR title')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--no-pr', 'Skip PR creation, just push the branch')
    .action(async (workspace, options) => {
    await shareCommand(workspace || '.', {
        ...options,
        noPr: options.pr === false,
    });
});
program
    .command('gather')
    .description('Gather changes from a GitHub repository back into workspace')
    .argument('[workspace]', 'Workspace directory (default: .)')
    .requiredOption('-s, --source <path>', 'Source git repository path')
    .option('--subfolder <path>', 'Subfolder in source repo (auto-detected if not specified)')
    .option('-b, --branch <name>', 'Checkout specific branch before gathering')
    .option('--dry-run', 'Show what would be done without making changes')
    .option('--no-checkpoint', 'Skip creating a checkpoint after gathering')
    .action(async (workspace, options) => {
    await gatherCommand(workspace || '.', {
        ...options,
        noCheckpoint: options.checkpoint === false,
    });
});
program
    .command('realms')
    .description('Manage configured realms for multi-realm workflows')
    .option('--init', 'Initialize .boxel-workspaces.json config file')
    .option('--add <path>', 'Add a realm to the config')
    .option('--remove <path>', 'Remove a realm from the config')
    .option('--purpose <text>', 'Set the purpose/description for the realm (use with --add)')
    .option('--patterns <list>', 'Comma-separated file patterns for this realm (use with --add)')
    .option('--card-types <list>', 'Comma-separated card types for this realm (use with --add)')
    .option('--notes <text>', 'Free-form notes for LLM guidance (use with --add)')
    .option('--default', 'Set this realm as the default (use with --add)')
    .option('--llm', 'Output LLM-friendly guidance for file placement')
    .action(async (options) => {
    await realmsCommand(options);
});
program
    .command('profile')
    .description('Manage saved profiles for different users/environments')
    .argument('[subcommand]', 'list | add | switch | remove | migrate')
    .argument('[arg]', 'Profile ID (for switch/remove)')
    .option('-u, --user <matrixId>', 'Matrix user ID (e.g., @user:boxel.ai)')
    .option('-p, --password <password>', 'Password (for add command)')
    .option('-n, --name <displayName>', 'Display name (for add command)')
    .action(async (subcommand, arg, options) => {
    if (options?.password) {
        console.warn('Warning: Supplying a password via -p/--password may expose it in shell history and process listings. ' +
            'For non-interactive usage, prefer the BOXEL_PASSWORD environment variable or use "boxel profile add" interactively.');
    }
    await profileCommand(subcommand, arg, options);
});
// Add help text for environment variables
program.addHelpText('after', `
Authentication:
  Use 'boxel profile' to manage saved credentials (recommended)
  Or set all environment variables (all required):
    MATRIX_URL, MATRIX_USERNAME, MATRIX_PASSWORD, REALM_SERVER_URL

Workspace References:
  .                  Current directory (must have .boxel-sync.json)
  ./path             Local path (must have .boxel-sync.json)
  @user/workspace    Resolve from your workspace list
  https://...        Full workspace URL

Examples:
  boxel create my-project "My Project"   Create a new workspace
  boxel list                             List all accessible workspaces

  boxel status                     Check current directory
  boxel status @aallen90/personal  Check specific workspace by name
  boxel status --all               Check all your workspaces
  boxel status . --pull            Pull remote changes

  boxel sync .                     Sync current directory
  boxel sync @aallen90/personal    Sync workspace by name
  boxel sync ./cards https://...   Sync with explicit URL (first time setup)

  boxel check ./file.json          Check single file before editing
  boxel check ./file.json --sync   Auto-pull if remote changed

  boxel watch .                    Monitor server, checkpoint changes
  boxel watch . -i 10              Check every 10 seconds
  boxel watch . -q                 Quiet mode (only show changes)

  boxel track .                    Track local edits, auto-checkpoint
  boxel track . -d 5 -i 30         5s debounce, 30s min between checkpoints

  boxel stop                       Stop all running watch/track processes

  boxel pull https://... ./local   One-way pull (for read-only realms)

  boxel touch .                    Touch all files to force re-indexing
  boxel touch . card.gts           Touch specific file
  boxel touch . GrammyAward/       Touch all files in directory

  boxel milestone . 1 -n "v1.0"    Mark checkpoint #1 as milestone
  boxel milestone . --list         List all milestones
  boxel milestone . --remove 1     Remove milestone from checkpoint

  boxel share . -t ~/github/repo   Share to GitHub repo (uses latest milestone)
  boxel share . -t ~/repo -m "v1"  Share specific milestone
  boxel share . -t ~/repo --dry-run  Preview what would be shared

  boxel gather . -s ~/github/repo  Gather changes from GitHub repo
  boxel gather . -s ~/repo -b main Gather from specific branch

  boxel profile                    Show current profile
  boxel profile list               List all saved profiles
  boxel profile add                Add a new profile (interactive)
  boxel profile switch <id>        Switch to a different profile
  boxel profile migrate            Import credentials from .env
`);
program.parse();
//# sourceMappingURL=index.js.map