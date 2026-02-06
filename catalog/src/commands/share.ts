import { CheckpointManager } from '../lib/checkpoint-manager.js';
import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ANSI color codes
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_CYAN = '\x1b[36m';
const FG_MAGENTA = '\x1b[35m';
const FG_RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

interface ShareOptions {
  milestone?: string;
  target: string;
  subfolder?: string;
  branch?: string;
  title?: string;
  dryRun?: boolean;
  noPr?: boolean;
}

export async function shareCommand(
  workspace: string,
  options: ShareOptions
): Promise<void> {
  const workspaceDir = path.resolve(workspace);
  const targetDir = path.resolve(options.target);

  // Validate workspace
  const manifestPath = path.join(workspaceDir, '.boxel-sync.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`${FG_RED}Error:${RESET} No .boxel-sync.json found in workspace.`);
    process.exit(1);
  }

  // Validate target is a git repo
  if (!fs.existsSync(path.join(targetDir, '.git'))) {
    console.error(`${FG_RED}Error:${RESET} Target directory is not a git repository: ${targetDir}`);
    process.exit(1);
  }

  // Check for gh CLI (only if we'll create a PR)
  if (!options.noPr && !options.dryRun) {
    try {
      execSync('gh --version', { stdio: 'ignore' });
    } catch {
      console.error(`${FG_RED}Error:${RESET} GitHub CLI (gh) is required but not installed.`);
      console.error('Install it with: brew install gh');
      process.exit(1);
    }
  }

  const manager = new CheckpointManager(workspaceDir);

  // Determine source: milestone or current state
  let sourceDir = workspaceDir;
  let milestoneName: string | undefined;
  let milestoneHash: string | undefined;

  if (options.milestone) {
    if (!manager.isInitialized()) {
      console.error(`${FG_RED}Error:${RESET} No checkpoint history found.`);
      process.exit(1);
    }

    // Find the milestone
    const milestones = manager.getMilestones();
    const milestone = milestones.find(m =>
      m.milestoneName?.toLowerCase().includes(options.milestone!.toLowerCase()) ||
      m.shortHash === options.milestone ||
      m.hash === options.milestone
    );

    if (!milestone) {
      console.error(`${FG_RED}Error:${RESET} Milestone not found: ${options.milestone}`);
      console.log(`\nAvailable milestones:`);
      for (const m of milestones) {
        console.log(`  ${FG_YELLOW}${m.shortHash}${RESET} ${FG_MAGENTA}${m.milestoneName}${RESET}`);
      }
      process.exit(1);
    }

    milestoneName = milestone.milestoneName;
    milestoneHash = milestone.shortHash;

    // Restore to milestone temporarily for copying
    console.log(`\n${FG_CYAN}Using milestone:${RESET} ${FG_MAGENTA}${milestoneName}${RESET} (${FG_YELLOW}${milestoneHash}${RESET})`);
  } else {
    // Use latest milestone if available
    const milestones = manager.getMilestones();
    if (milestones.length > 0) {
      const latest = milestones[0];
      milestoneName = latest.milestoneName;
      milestoneHash = latest.shortHash;
      console.log(`\n${FG_CYAN}Using latest milestone:${RESET} ${FG_MAGENTA}${milestoneName}${RESET} (${FG_YELLOW}${milestoneHash}${RESET})`);
    } else {
      console.log(`\n${FG_CYAN}Using current workspace state${RESET} (no milestones found)`);
    }
  }

  // Determine destination subfolder in target repo
  const subfolder = options.subfolder || detectSubfolder(workspaceDir);
  const destDir = subfolder ? path.join(targetDir, subfolder) : targetDir;

  console.log(`${FG_CYAN}Source:${RESET} ${workspaceDir}`);
  console.log(`${FG_CYAN}Target:${RESET} ${destDir}`);

  // Generate branch name
  const branchName = options.branch || generateBranchName(milestoneName);
  console.log(`${FG_CYAN}Branch:${RESET} ${branchName}`);

  if (options.dryRun) {
    console.log(`\n${FG_YELLOW}Dry run - no changes will be made${RESET}\n`);
    const files = getWorkspaceFiles(workspaceDir);
    console.log(`Would copy ${files.length} files:`);
    for (const file of files.slice(0, 10)) {
      console.log(`  ${file}`);
    }
    if (files.length > 10) {
      console.log(`  ... and ${files.length - 10} more`);
    }
    return;
  }

  // Ensure we're on main/master and up to date
  console.log(`\n${FG_CYAN}Preparing target repository...${RESET}`);
  const defaultBranch = getDefaultBranch(targetDir);
  gitInDir(targetDir, 'checkout', defaultBranch);

  // Try to pull, but don't fail if it doesn't work (offline, auth issues, etc)
  try {
    gitInDir(targetDir, 'pull', '--ff-only');
  } catch (e) {
    console.log(`${FG_YELLOW}Warning:${RESET} Could not pull latest changes. Continuing with local state.`);
  }

  // Create new branch
  console.log(`Creating branch: ${FG_YELLOW}${branchName}${RESET}`);
  try {
    gitInDir(targetDir, 'checkout', '-b', branchName);
  } catch {
    // Branch might exist, try to check it out
    gitInDir(targetDir, 'checkout', branchName);
    gitInDir(targetDir, 'reset', '--hard', defaultBranch);
  }

  // If using a milestone, restore to that state first
  if (milestoneHash && options.milestone) {
    manager.restore(manager.getMilestones().find(m => m.shortHash === milestoneHash)!.hash);
  }

  // Copy files
  console.log(`\n${FG_CYAN}Copying files...${RESET}`);
  const files = getWorkspaceFiles(workspaceDir);
  let copied = 0;

  // Remove existing files in dest subfolder (clean sync)
  // But preserve repo-level files when syncing to root
  const preserveFiles = new Set([
    'package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
    'tsconfig.json', 'LICENSE', 'README.md', 'CHANGELOG.md',
    '.boxelignore', '.editorconfig', '.eslintrc.js', '.prettierrc.js',
    '.gitignore', '.npmrc', '.nvmrc',
    '.realm.json', // Preserve target realm config
    'index.json', // Preserve target realm index (has realm-specific URLs)
    'cards-grid.json', // Preserve target realm cards grid
  ]);
  const preserveDirs = new Set(['.git', '.github', '.vscode', 'node_modules']);

  if (fs.existsSync(destDir)) {
    const existingFiles = getFilesRecursive(destDir);
    for (const file of existingFiles) {
      const filePath = path.join(destDir, file);
      const topLevel = file.split('/')[0];

      // Skip preserved files/dirs
      if (preserveFiles.has(topLevel) || preserveDirs.has(topLevel)) {
        continue;
      }

      fs.unlinkSync(filePath);
    }
  }

  // Files to skip copying (preserve target's version)
  // - .realm.json: realm config (name, icon, background)
  // - index.json: contains realm-specific URLs and metadata
  // - cards-grid.json: realm index card
  const skipCopy = new Set(['.realm.json', 'index.json', 'cards-grid.json']);

  // Copy new files
  for (const file of files) {
    // Skip files that should preserve target's version
    if (skipCopy.has(file)) {
      continue;
    }

    const srcPath = path.join(workspaceDir, file);
    const destPath = path.join(destDir, file);

    // Ensure directory exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.copyFileSync(srcPath, destPath);
    copied++;
  }

  console.log(`Copied ${FG_GREEN}${copied}${RESET} files`);

  // If we restored to a milestone, restore back to HEAD
  if (milestoneHash && options.milestone) {
    const checkpoints = manager.getCheckpoints(1);
    if (checkpoints.length > 0) {
      manager.restore(checkpoints[0].hash);
    }
  }

  // Stage and commit
  console.log(`\n${FG_CYAN}Committing changes...${RESET}`);
  gitInDir(targetDir, 'add', '-A');

  // Check if there are changes
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: targetDir,
    encoding: 'utf-8',
  });

  if (!status.stdout.trim()) {
    console.log(`${FG_YELLOW}No changes to commit${RESET}`);
    gitInDir(targetDir, 'checkout', defaultBranch);
    gitInDir(targetDir, 'branch', '-D', branchName);
    return;
  }

  const commitMessage = milestoneName
    ? `Update from Boxel: ${milestoneName}`
    : 'Update from Boxel workspace';

  gitInDir(targetDir, 'commit', '-m', commitMessage);
  console.log(`${FG_GREEN}Committed:${RESET} ${commitMessage}`);

  // Push branch
  console.log(`\n${FG_CYAN}Pushing to remote...${RESET}`);
  try {
    gitInDir(targetDir, 'push', '-u', 'origin', branchName, '--force');
  } catch (e) {
    console.log(`${FG_YELLOW}Warning:${RESET} Could not push to remote. Branch created locally.`);
    console.log(`You can push manually with: cd ${targetDir} && git push -u origin ${branchName}`);
    console.log(`Then create PR at: https://github.com/cardstack/boxel-home/compare/${branchName}?expand=1`);
    gitInDir(targetDir, 'checkout', defaultBranch);
    return;
  }

  // Create PR
  if (!options.noPr) {
    console.log(`\n${FG_CYAN}Creating pull request...${RESET}`);

    const prTitle = options.title || (milestoneName
      ? `Boxel: ${milestoneName}`
      : 'Update from Boxel workspace');

    const prBody = generatePrBody(milestoneName, milestoneHash, files.length);

    try {
      const result = spawnSync('gh', [
        'pr', 'create',
        '--title', prTitle,
        '--body', prBody,
        '--base', defaultBranch,
      ], {
        cwd: targetDir,
        encoding: 'utf-8',
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      if (result.status === 0) {
        const prUrl = result.stdout.trim();
        console.log(`\n${FG_GREEN}Pull request created:${RESET} ${prUrl}`);
      } else {
        // PR might already exist
        console.log(`${FG_YELLOW}Note:${RESET} ${result.stderr.trim()}`);
      }
    } catch (error) {
      console.error(`${FG_RED}Failed to create PR:${RESET}`, error);
    }
  }

  // Return to default branch
  gitInDir(targetDir, 'checkout', defaultBranch);

  console.log(`\n${FG_GREEN}Done!${RESET}`);
}

function getWorkspaceFiles(dir: string): string[] {
  const files: string[] = [];

  const scan = (currentDir: string, prefix: string = '') => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip internal files
      if (entry.name === '.boxel-history' ||
          entry.name === '.boxel-sync.json' ||
          entry.name === '.DS_Store' ||
          (entry.name.startsWith('.') && entry.name !== '.realm.json' && entry.name !== '.boxelignore')) {
        continue;
      }

      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        scan(path.join(currentDir, entry.name), relPath);
      } else {
        files.push(relPath);
      }
    }
  };

  scan(dir);
  return files;
}

function getFilesRecursive(dir: string): string[] {
  const files: string[] = [];

  const scan = (currentDir: string, prefix: string = '') => {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') continue;

      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        scan(path.join(currentDir, entry.name), relPath);
      } else {
        files.push(relPath);
      }
    }
  };

  scan(dir);
  return files;
}

function detectSubfolder(workspaceDir: string): string | undefined {
  // Check if workspace contains a specific subfolder structure
  // For boxel-ai-website, we want to preserve that path
  const manifest = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.boxel-sync.json'), 'utf-8'));
  const url = manifest.workspaceUrl || '';

  // Extract workspace name from URL
  const match = url.match(/\/([^\/]+)\/?$/);
  if (match) {
    return match[1];
  }

  return undefined;
}

function generateBranchName(milestoneName?: string): string {
  const date = new Date().toISOString().split('T')[0];
  if (milestoneName) {
    const slug = milestoneName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30);
    return `boxel/${slug}-${date}`;
  }
  return `boxel/update-${date}`;
}

function generatePrBody(milestoneName?: string, hash?: string, fileCount?: number): string {
  const lines = ['## Summary'];

  if (milestoneName) {
    lines.push(`Update from Boxel milestone: **${milestoneName}**`);
    if (hash) {
      lines.push(`Checkpoint: \`${hash}\``);
    }
  } else {
    lines.push('Update from Boxel workspace (current state)');
  }

  if (fileCount) {
    lines.push(`\nFiles synced: ${fileCount}`);
  }

  lines.push('\n---');
  lines.push('*Generated by boxel-cli share command*');

  return lines.join('\n');
}

function getDefaultBranch(dir: string): string {
  try {
    const result = spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    if (result.status === 0) {
      return result.stdout.trim().replace('refs/remotes/origin/', '');
    }
  } catch {
    // Ignore
  }
  return 'main';
}

function gitInDir(dir: string, ...args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }

  return result.stdout;
}
