import * as fs from 'fs';
import * as path from 'path';
import { MatrixClient } from '../lib/matrix-client.js';
import { RealmAuthClient } from '../lib/realm-auth-client.js';
import { resolveWorkspace } from '../lib/workspace-resolver.js';
import { CheckpointManager, type CheckpointChange } from '../lib/checkpoint-manager.js';
import { createHash } from 'crypto';
import { getEditingFiles } from '../lib/edit-lock.js';
import { getProfileManager, formatProfileBadge } from '../lib/profile-manager.js';

interface WatchOptions {
  interval?: number;
  quiet?: boolean;
  debounce?: number;
}

interface SyncManifest {
  workspaceUrl: string;
  lastSync: string;
  files: Record<string, { hash: string; mtime: number }>;
}

interface WatchedRealm {
  name: string;
  localDir: string;
  workspaceUrl: string;
  jwt: string;
  checkpointManager: CheckpointManager;
  lastKnownState: Record<string, number>;
  pendingChanges: Map<string, { status: 'added' | 'modified' | 'deleted'; mtime: number }>;
  debounceTimer: NodeJS.Timeout | null;
  lastChangeTime: number;
}

export async function watchCommand(
  workspaceRefs: string[],
  options: WatchOptions
): Promise<void> {
  const intervalMs = (options.interval || 30) * 1000;
  const debounceMs = (options.debounce ?? 5) * 1000;

  // Get credentials from profile manager (falls back to env vars)
  const profileManager = getProfileManager();
  const credentials = await profileManager.getActiveCredentials();

  if (!credentials) {
    console.error('No credentials found. Run "boxel profile add" or set environment variables.');
    process.exit(1);
  }

  const { matrixUrl, username, password, profileId } = credentials;

  // Show active profile if using one
  if (profileId) {
    console.log(`${formatProfileBadge(profileId)}\n`);
  }

  const matrixClient = new MatrixClient({
    matrixURL: new URL(matrixUrl),
    username,
    password,
  });

  await matrixClient.login();

  // Initialize all watched realms
  const realms: WatchedRealm[] = [];

  for (const workspaceRef of workspaceRefs) {
    const resolved = await resolveWorkspace(workspaceRef);
    if (!resolved.localDir) {
      console.error(`Watch requires a local directory for: ${workspaceRef}`);
      process.exit(1);
    }

    const localDir = resolved.localDir;
    const workspaceUrl = resolved.workspaceUrl;

    if (!workspaceUrl) {
      console.error(`No workspace URL found for: ${workspaceRef}. Run sync first.`);
      process.exit(1);
    }

    const normalizedUrl = workspaceUrl.endsWith('/') ? workspaceUrl : workspaceUrl + '/';

    // Get JWT for this realm
    const realmAuth = new RealmAuthClient(new URL(normalizedUrl), matrixClient);
    const jwt = await realmAuth.getJWT();

    // Initialize checkpoint manager
    const checkpointManager = new CheckpointManager(localDir);
    if (!checkpointManager.isInitialized()) {
      checkpointManager.init();
    }

    // Load initial state from manifest
    const lastKnownState: Record<string, number> = {};
    const manifestPath = path.join(localDir, '.boxel-sync.json');
    if (fs.existsSync(manifestPath)) {
      const manifest: SyncManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const [file, info] of Object.entries(manifest.files)) {
        lastKnownState[file] = info.mtime;
      }
    }

    // Extract a short name for display
    const urlParts = normalizedUrl.replace(/\/$/, '').split('/');
    const name = urlParts.slice(-2).join('/');

    realms.push({
      name,
      localDir,
      workspaceUrl: normalizedUrl,
      jwt,
      checkpointManager,
      lastKnownState,
      pendingChanges: new Map(),
      debounceTimer: null,
      lastChangeTime: 0,
    });
  }

  // Display what we're watching
  console.log(`⇅  Watching ${realms.length} realm${realms.length > 1 ? 's' : ''} (remote):`);
  for (const realm of realms) {
    console.log(`   ${realm.name} → ${realm.localDir}`);
  }
  console.log(`   Interval: ${intervalMs / 1000}s, Debounce: ${debounceMs / 1000}s`);
  console.log(`   Press Ctrl+C to stop\n`);

  const applyPendingChanges = async (realm: WatchedRealm, remoteMtimes: Record<string, number>) => {
    if (realm.pendingChanges.size === 0) return;

    const editingFiles = getEditingFiles(realm.localDir);
    const skippedFiles: string[] = [];
    const changes: CheckpointChange[] = [];
    const newFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const deletedFiles: string[] = [];

    for (const [file, info] of realm.pendingChanges.entries()) {
      if (editingFiles.includes(file)) {
        skippedFiles.push(file);
        continue;
      }
      changes.push({ file, status: info.status });
      if (info.status === 'added') newFiles.push(file);
      else if (info.status === 'modified') modifiedFiles.push(file);
      else deletedFiles.push(file);
    }

    if (skippedFiles.length > 0) {
      console.log(`\n[${timestamp()}] [${realm.name}] ⏸️  Skipped ${skippedFiles.length} file(s) being edited`);
    }

    if (changes.length === 0) {
      realm.pendingChanges.clear();
      return;
    }

    console.log(`\n[${timestamp()}] [${realm.name}] 📦 Applying ${changes.length} changes...`);

    if (newFiles.length > 0) {
      console.log(`  + ${newFiles.length} new: ${newFiles.slice(0, 3).join(', ')}${newFiles.length > 3 ? '...' : ''}`);
    }
    if (modifiedFiles.length > 0) {
      console.log(`  ~ ${modifiedFiles.length} modified: ${modifiedFiles.slice(0, 3).join(', ')}${modifiedFiles.length > 3 ? '...' : ''}`);
    }
    if (deletedFiles.length > 0) {
      console.log(`  - ${deletedFiles.length} deleted: ${deletedFiles.slice(0, 3).join(', ')}${deletedFiles.length > 3 ? '...' : ''}`);
    }

    console.log(`  Pulling changes...`);

    for (const file of [...newFiles, ...modifiedFiles]) {
      const fileUrl = `${realm.workspaceUrl}${file}`;
      const fileResponse = await fetch(fileUrl, {
        headers: {
          'Authorization': realm.jwt,
          'Accept': file.endsWith('.json')
            ? 'application/vnd.card+json'
            : file.endsWith('.gts')
              ? 'application/vnd.card+source'
              : '*/*',
        },
      });

      if (fileResponse.ok) {
        const content = await fileResponse.text();
        const localPath = path.join(realm.localDir, file);
        const localDirPath = path.dirname(localPath);

        if (!fs.existsSync(localDirPath)) {
          fs.mkdirSync(localDirPath, { recursive: true });
        }

        fs.writeFileSync(localPath, content);
      }
    }

    for (const file of deletedFiles) {
      const localPath = path.join(realm.localDir, file);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
    }

    const checkpoint = realm.checkpointManager.createCheckpoint('remote', changes);
    if (checkpoint) {
      console.log(`  📍 Checkpoint: ${checkpoint.shortHash} ${checkpoint.isMajor ? '[MAJOR]' : '[minor]'} ${checkpoint.message}`);
    }

    realm.lastKnownState = { ...remoteMtimes };

    const manifest: SyncManifest = {
      workspaceUrl: realm.workspaceUrl,
      lastSync: new Date().toISOString(),
      files: {},
    };

    for (const [file, mtime] of Object.entries(remoteMtimes)) {
      const localPath = path.join(realm.localDir, file);
      if (fs.existsSync(localPath)) {
        const content = fs.readFileSync(localPath);
        const hash = createHash('sha256').update(content).digest('hex');
        manifest.files[file] = { hash, mtime };
      }
    }

    const manifestPath = path.join(realm.localDir, '.boxel-sync.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    realm.pendingChanges.clear();
  };

  const checkRealmForChanges = async (realm: WatchedRealm) => {
    try {
      const mtimesUrl = `${realm.workspaceUrl}_mtimes`;
      const response = await fetch(mtimesUrl, {
        headers: {
          'Authorization': realm.jwt,
          'Accept': 'application/vnd.api+json',
        },
      });

      if (!response.ok) {
        if (!options.quiet) {
          console.error(`[${timestamp()}] [${realm.name}] Failed to fetch: ${response.status}`);
        }
        return;
      }

      const data = await response.json() as { data?: { attributes?: { mtimes?: Record<string, number> } } };
      const mtimesData = data?.data?.attributes?.mtimes || {};

      const remoteMtimes: Record<string, number> = {};
      for (const [fullUrl, mtime] of Object.entries(mtimesData)) {
        if (fullUrl.startsWith(realm.workspaceUrl)) {
          const relativePath = fullUrl.substring(realm.workspaceUrl.length);
          if (relativePath && !relativePath.startsWith('_')) {
            remoteMtimes[relativePath] = mtime as number;
          }
        }
      }

      let hasNewChanges = false;

      for (const [file, mtime] of Object.entries(remoteMtimes)) {
        if (!(file in realm.lastKnownState)) {
          if (!realm.pendingChanges.has(file) || realm.pendingChanges.get(file)!.mtime !== mtime) {
            realm.pendingChanges.set(file, { status: 'added', mtime });
            hasNewChanges = true;
          }
        } else if (mtime > realm.lastKnownState[file]) {
          if (!realm.pendingChanges.has(file) || realm.pendingChanges.get(file)!.mtime !== mtime) {
            realm.pendingChanges.set(file, { status: 'modified', mtime });
            hasNewChanges = true;
          }
        }
      }

      for (const file of Object.keys(realm.lastKnownState)) {
        if (!(file in remoteMtimes) && !realm.pendingChanges.has(file)) {
          realm.pendingChanges.set(file, { status: 'deleted', mtime: 0 });
          hasNewChanges = true;
        }
      }

      if (hasNewChanges) {
        realm.lastChangeTime = Date.now();
        console.log(`\n[${timestamp()}] [${realm.name}] 🔔 Changes detected (${realm.pendingChanges.size} pending)`);

        if (realm.debounceTimer) {
          clearTimeout(realm.debounceTimer);
        }

        realm.debounceTimer = setTimeout(async () => {
          await applyPendingChanges(realm, remoteMtimes);
          realm.debounceTimer = null;
        }, debounceMs);
      }

    } catch (error) {
      if (!options.quiet) {
        console.error(`\n[${timestamp()}] [${realm.name}] Error:`, error);
      }
    }
  };

  const checkAllRealms = async () => {
    // Check all realms in parallel
    await Promise.all(realms.map(realm => checkRealmForChanges(realm)));

    // Status line (quiet mode aware)
    if (!options.quiet) {
      const pendingTotal = realms.reduce((sum, r) => sum + r.pendingChanges.size, 0);
      if (pendingTotal === 0) {
        const realmStatus = realms.map(r => r.name.split('/').pop()).join(', ');
        process.stdout.write(`\r[${timestamp()}] ✓ ${realmStatus}                    `);
      }
    }
  };

  // Initial check
  await checkAllRealms();

  // Set up polling
  const intervalId = setInterval(checkAllRealms, intervalMs);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    // Clear any pending debounce timers
    for (const realm of realms) {
      if (realm.debounceTimer) {
        clearTimeout(realm.debounceTimer);
      }
    }
    console.log('\n\n⇅  Watch stopped');
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

function timestamp(): string {
  return new Date().toLocaleTimeString();
}
