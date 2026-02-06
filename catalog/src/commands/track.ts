import * as fs from 'fs';
import * as path from 'path';
import { CheckpointManager, type CheckpointChange } from '../lib/checkpoint-manager.js';

interface TrackOptions {
  debounce?: number;
  interval?: number;  // Minimum seconds between checkpoints
  quiet?: boolean;
}

export async function trackCommand(
  workspaceRef: string,
  options: TrackOptions
): Promise<void> {
  const debounceMs = (options.debounce ?? 3) * 1000;
  const minIntervalMs = (options.interval ?? 10) * 1000;  // Min 10s between checkpoints
  const workspaceDir = path.resolve(workspaceRef || '.');

  if (!fs.existsSync(workspaceDir)) {
    console.error(`Directory not found: ${workspaceDir}`);
    process.exit(1);
  }

  // Check for .boxel-sync.json to confirm it's a boxel workspace
  const syncManifestPath = path.join(workspaceDir, '.boxel-sync.json');
  if (!fs.existsSync(syncManifestPath)) {
    console.error('Not a synced Boxel workspace (no .boxel-sync.json)');
    console.error('Run "boxel sync" first to initialize the workspace.');
    process.exit(1);
  }

  // Initialize checkpoint manager
  const checkpointManager = new CheckpointManager(workspaceDir);
  if (!checkpointManager.isInitialized()) {
    checkpointManager.init();
  }

  // Track file state for change detection
  const fileStates = new Map<string, { mtime: number; size: number }>();
  let debounceTimer: NodeJS.Timeout | null = null;
  let pendingChanges = new Map<string, 'added' | 'modified' | 'deleted'>();
  let lastCheckpointTime = Date.now();
  let isCheckingChanges = false; // Mutex to prevent concurrent checkForChanges calls

  // Initialize file states
  const initializeFileStates = (dir: string, prefix = '') => {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip internal files
      if (entry.name.startsWith('.boxel-') || entry.name === '.git') continue;
      if (entry.name.startsWith('.') && entry.name !== '.realm.json') continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        initializeFileStates(fullPath, relativePath);
      } else {
        const stats = fs.statSync(fullPath);
        fileStates.set(relativePath, { mtime: stats.mtimeMs, size: stats.size });
      }
    }
  };

  initializeFileStates(workspaceDir);

  // Get workspace name for display
  const urlParts = workspaceDir.split('/');
  const workspaceName = urlParts[urlParts.length - 1];

  console.log(`⇆  Tracking local changes: ${workspaceName}`);
  console.log(`   Directory: ${workspaceDir}`);
  console.log(`   Debounce: ${debounceMs / 1000}s, Min interval: ${minIntervalMs / 1000}s`);
  console.log(`   Press Ctrl+C to stop\n`);

  let intervalTimer: NodeJS.Timeout | null = null;

  const applyPendingChanges = (force = false) => {
    if (pendingChanges.size === 0) return;

    // Check minimum interval between checkpoints (unless forced on exit)
    const timeSinceLastCheckpoint = Date.now() - lastCheckpointTime;
    if (!force && timeSinceLastCheckpoint < minIntervalMs) {
      // Schedule for later if not already scheduled
      if (!intervalTimer) {
        const waitMs = minIntervalMs - timeSinceLastCheckpoint;
        if (!options.quiet) {
          console.log(`  ⏳ Waiting ${Math.ceil(waitMs / 1000)}s before next checkpoint...`);
        }
        intervalTimer = setTimeout(() => {
          intervalTimer = null;
          applyPendingChanges();
        }, waitMs);
      }
      return;
    }

    const changes: CheckpointChange[] = [];
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const [file, status] of pendingChanges.entries()) {
      changes.push({ file, status });
      if (status === 'added') added.push(file);
      else if (status === 'modified') modified.push(file);
      else deleted.push(file);
    }

    if (!options.quiet) {
      console.log(`\n[${timestamp()}] 📦 Creating checkpoint (${changes.length} changes)...`);
      if (added.length > 0) {
        console.log(`  + ${added.length} new: ${added.slice(0, 3).join(', ')}${added.length > 3 ? '...' : ''}`);
      }
      if (modified.length > 0) {
        console.log(`  ~ ${modified.length} modified: ${modified.slice(0, 3).join(', ')}${modified.length > 3 ? '...' : ''}`);
      }
      if (deleted.length > 0) {
        console.log(`  - ${deleted.length} deleted: ${deleted.slice(0, 3).join(', ')}${deleted.length > 3 ? '...' : ''}`);
      }
    }

    const checkpoint = checkpointManager.createCheckpoint('local', changes);
    if (checkpoint) {
      console.log(`  ⇆  Checkpoint: ${checkpoint.shortHash} ${checkpoint.isMajor ? '[MAJOR]' : '[minor]'} ${checkpoint.message}`);
    }

    pendingChanges.clear();
    lastCheckpointTime = Date.now();
  };

  const checkForChanges = () => {
    // Prevent concurrent execution (fs.watch and setInterval can trigger simultaneously)
    if (isCheckingChanges) return;
    isCheckingChanges = true;

    try {
      checkForChangesImpl();
    } finally {
      isCheckingChanges = false;
    }
  };

  const checkForChangesImpl = () => {
    const currentFiles = new Map<string, { mtime: number; size: number }>();

    const scanDir = (dir: string, prefix = '') => {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip internal files
        if (entry.name.startsWith('.boxel-') || entry.name === '.git') continue;
        if (entry.name.startsWith('.') && entry.name !== '.realm.json') continue;

        const fullPath = path.join(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          scanDir(fullPath, relativePath);
        } else {
          try {
            const stats = fs.statSync(fullPath);
            currentFiles.set(relativePath, { mtime: stats.mtimeMs, size: stats.size });
          } catch {
            // File may have been deleted between readdir and stat
          }
        }
      }
    };

    scanDir(workspaceDir);

    let hasNewChanges = false;

    // Check for new/modified files
    for (const [file, current] of currentFiles.entries()) {
      const previous = fileStates.get(file);
      if (!previous) {
        // New file
        if (!pendingChanges.has(file)) {
          pendingChanges.set(file, 'added');
          hasNewChanges = true;
        }
      } else if (current.mtime > previous.mtime || current.size !== previous.size) {
        // Modified file
        if (!pendingChanges.has(file) || pendingChanges.get(file) !== 'modified') {
          pendingChanges.set(file, 'modified');
          hasNewChanges = true;
        }
      }
    }

    // Check for deleted files
    for (const file of fileStates.keys()) {
      if (!currentFiles.has(file)) {
        if (!pendingChanges.has(file)) {
          pendingChanges.set(file, 'deleted');
          hasNewChanges = true;
        }
      }
    }

    // Update file states
    fileStates.clear();
    for (const [file, state] of currentFiles.entries()) {
      fileStates.set(file, state);
    }

    if (hasNewChanges) {
      if (!options.quiet) {
        console.log(`\n[${timestamp()}] 🔔 Changes detected (${pendingChanges.size} pending)`);
      }

      // Reset debounce timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        applyPendingChanges();
        debounceTimer = null;
      }, debounceMs);
    }
  };

  // Use fs.watch for efficient file watching
  // Note: recursive option is only supported on macOS and Windows.
  // On Linux, we rely on the polling fallback (setInterval) below.
  const watchers: fs.FSWatcher[] = [];
  const isLinux = process.platform === 'linux';

  if (isLinux && !options.quiet) {
    console.log(`   Note: On Linux, file watching uses polling only (fs.watch recursive not supported)\n`);
  }

  const watchDir = (dir: string) => {
    try {
      const watcher = fs.watch(dir, { recursive: !isLinux }, (eventType, filename) => {
        if (!filename) return;

        // Skip internal files
        if (filename.startsWith('.boxel-') || filename.includes('.git')) return;
        if (filename.startsWith('.') && filename !== '.realm.json') return;

        // Debounced check for changes
        checkForChanges();
      });

      watcher.on('error', (error) => {
        if (!options.quiet) {
          console.error(`Watch error:`, error);
        }
      });

      watchers.push(watcher);
    } catch (error) {
      console.error(`Failed to watch directory:`, error);
    }
  };

  watchDir(workspaceDir);

  // Also poll periodically as a fallback (some editors don't trigger fs.watch reliably)
  const pollInterval = setInterval(checkForChanges, 2000);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(pollInterval);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (intervalTimer) {
      clearTimeout(intervalTimer);
    }
    // Apply any pending changes before exit (force = true to skip interval check)
    if (pendingChanges.size > 0) {
      if (!options.quiet) {
        console.log('\n\nApplying pending changes before exit...');
      }
      applyPendingChanges(true);
    }
    for (const watcher of watchers) {
      watcher.close();
    }
    if (!options.quiet) {
      console.log('\n⇆  Tracking stopped');
    }
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

function timestamp(): string {
  const now = new Date();
  return now.toISOString().substring(11, 19); // HH:MM:SS in UTC
}
