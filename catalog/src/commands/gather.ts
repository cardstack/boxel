import { CheckpointManager } from '../lib/checkpoint-manager.js';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ANSI color codes
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_CYAN = '\x1b[36m';
const FG_RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

interface GatherOptions {
  source: string;
  subfolder?: string;
  branch?: string;
  dryRun?: boolean;
  noCheckpoint?: boolean;
}

export async function gatherCommand(
  workspace: string,
  options: GatherOptions
): Promise<void> {
  const workspaceDir = path.resolve(workspace);
  const sourceDir = path.resolve(options.source);

  // Validate workspace
  const manifestPath = path.join(workspaceDir, '.boxel-sync.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`${FG_RED}Error:${RESET} No .boxel-sync.json found in workspace.`);
    process.exit(1);
  }

  // Validate source is a git repo
  if (!fs.existsSync(path.join(sourceDir, '.git'))) {
    console.error(`${FG_RED}Error:${RESET} Source directory is not a git repository: ${sourceDir}`);
    process.exit(1);
  }

  // Determine source subfolder in git repo
  let subfolder = options.subfolder;
  if (!subfolder) {
    // Try auto-detect, but fall back to root if not found
    const detected = detectSubfolder(workspaceDir);
    if (detected && fs.existsSync(path.join(sourceDir, detected))) {
      subfolder = detected;
    }
  }

  const srcContentDir = (subfolder && subfolder !== '.') ? path.join(sourceDir, subfolder) : sourceDir;

  if (!fs.existsSync(srcContentDir)) {
    console.error(`${FG_RED}Error:${RESET} Source directory not found: ${srcContentDir}`);
    process.exit(1);
  }

  console.log(`\n${FG_CYAN}Source:${RESET} ${srcContentDir}`);
  console.log(`${FG_CYAN}Target:${RESET} ${workspaceDir}`);

  // Optionally checkout a specific branch
  if (options.branch) {
    console.log(`${FG_CYAN}Branch:${RESET} ${options.branch}`);
    try {
      gitInDir(sourceDir, 'checkout', options.branch);
    } catch (e) {
      console.error(`${FG_RED}Error:${RESET} Could not checkout branch: ${options.branch}`);
      process.exit(1);
    }
  }

  // Get current branch for info
  const currentBranch = gitInDir(sourceDir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  const currentCommit = gitInDir(sourceDir, 'rev-parse', '--short', 'HEAD').trim();
  console.log(`${FG_CYAN}Git state:${RESET} ${currentBranch} @ ${currentCommit}`);

  // Get list of files to copy from source
  const files = getContentFiles(srcContentDir);
  console.log(`\nFound ${FG_GREEN}${files.length}${RESET} files to gather`);

  if (options.dryRun) {
    console.log(`\n${FG_YELLOW}Dry run - no changes will be made${RESET}\n`);
    console.log('Would copy:');
    for (const file of files.slice(0, 15)) {
      console.log(`  ${file}`);
    }
    if (files.length > 15) {
      console.log(`  ... and ${files.length - 15} more`);
    }
    return;
  }

  // Files to skip (preserve workspace's version)
  // - .realm.json: realm config (name, icon, background)
  // - .boxel-sync.json: local sync state
  // - index.json: contains realm-specific URLs and metadata
  // - cards-grid.json: realm index card
  const skipFiles = new Set(['.realm.json', '.boxel-sync.json', 'index.json', 'cards-grid.json']);

  // Copy files from source to workspace
  console.log(`\n${FG_CYAN}Copying files...${RESET}`);
  let copied = 0;
  let skipped = 0;

  for (const file of files) {
    // Skip files that should preserve workspace's version
    if (skipFiles.has(file)) {
      skipped++;
      continue;
    }

    const srcPath = path.join(srcContentDir, file);
    const destPath = path.join(workspaceDir, file);

    // Ensure directory exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.copyFileSync(srcPath, destPath);
    copied++;
  }

  console.log(`Copied ${FG_GREEN}${copied}${RESET} files${skipped > 0 ? ` (skipped ${skipped} preserved files)` : ''}`);

  // Create checkpoint
  if (!options.noCheckpoint) {
    const manager = new CheckpointManager(workspaceDir);
    if (manager.isInitialized()) {
      console.log(`\n${FG_CYAN}Creating checkpoint...${RESET}`);

      const changes = files
        .filter(f => !skipFiles.has(f))
        .map(f => ({
          file: f,
          status: 'modified' as const,
        }));

      const checkpoint = manager.createCheckpoint(
        'manual',
        changes,
        `Gather from ${currentBranch}@${currentCommit}`
      );

      if (checkpoint) {
        console.log(`${FG_GREEN}Checkpoint:${RESET} ${checkpoint.shortHash}`);
      }
    }
  }

  console.log(`\n${FG_GREEN}Done!${RESET}`);
  console.log(`\nNext steps:`);
  console.log(`  ${FG_CYAN}boxel sync . --prefer-local${RESET}  Push gathered changes to Boxel server`);
}

function getContentFiles(dir: string): string[] {
  const files: string[] = [];

  const scan = (currentDir: string, prefix: string = '') => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip git and common non-content files
      if (entry.name === '.git' ||
          entry.name === '.github' ||
          entry.name === '.vscode' ||
          entry.name === 'node_modules' ||
          entry.name === '.DS_Store' ||
          entry.name === 'package.json' ||
          entry.name === 'pnpm-lock.yaml' ||
          entry.name === 'package-lock.json' ||
          entry.name === 'yarn.lock' ||
          entry.name === 'tsconfig.json' ||
          entry.name === 'LICENSE' ||
          entry.name === 'README.md' ||
          entry.name === 'CHANGELOG.md' ||
          entry.name === '.boxelignore' ||
          entry.name === '.editorconfig' ||
          entry.name === '.eslintrc.js' ||
          entry.name === '.prettierrc.js' ||
          entry.name === '.gitignore' ||
          entry.name === '.npmrc' ||
          entry.name === '.nvmrc') {
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

function detectSubfolder(workspaceDir: string): string | undefined {
  // Check manifest for workspace URL to detect subfolder
  const manifest = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.boxel-sync.json'), 'utf-8'));
  const url = manifest.workspaceUrl || '';

  // Extract workspace name from URL
  const match = url.match(/\/([^\/]+)\/?$/);
  if (match) {
    return match[1];
  }

  return undefined;
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
