import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MatrixClient } from '../lib/matrix-client.js';
import { RealmAuthClient } from '../lib/realm-auth-client.js';
import { resolveWorkspace, getAllWorkspacesStatus } from '../lib/workspace-resolver.js';
import { getProfileManager, formatProfileBadge } from '../lib/profile-manager.js';

interface SyncManifest {
  workspaceUrl: string;
  lastSyncTime: number;
  files: Record<string, { localHash: string; remoteMtime: number }>;
}

interface FileStatus {
  file: string;
  status: 'new-remote' | 'new-local' | 'modified-remote' | 'modified-local' | 'conflict' | 'deleted-remote' | 'deleted-local';
  localMtime?: number;
  remoteMtime?: number;
}

function computeFileHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

export async function statusCommand(
  workspaceRef: string | undefined,
  options: { pull?: boolean; all?: boolean }
): Promise<void> {
  // Get credentials from profile manager (falls back to env vars)
  const profileManager = getProfileManager();
  const credentials = await profileManager.getActiveCredentials();

  if (!credentials) {
    console.error('No credentials found. Run "boxel profile add" or set environment variables.');
    process.exit(1);
  }

  const { matrixUrl, username: matrixUsername, password: matrixPassword, profileId } = credentials;

  // Show active profile if using one
  if (profileId) {
    console.log(`${formatProfileBadge(profileId)}\n`);
  }

  // Authenticate
  const matrixClient = new MatrixClient({
    matrixURL: new URL(matrixUrl),
    username: matrixUsername,
    password: matrixPassword
  });
  await matrixClient.login();

  // Handle --all flag
  if (options.all) {
    await statusAll(matrixClient);
    return;
  }

  // Default to current directory if no ref provided
  const ref = workspaceRef || '.';

  // Resolve workspace reference
  const resolved = await resolveWorkspace(ref, matrixClient);

  if (!resolved.manifest) {
    console.error(`No .boxel-sync.json found in ${resolved.localDir}`);
    console.error(`Run: boxel sync ${resolved.localDir} ${resolved.workspaceUrl}`);
    process.exit(1);
  }

  await statusSingle(resolved.localDir, resolved.workspaceUrl, resolved.manifest, matrixClient, options);
}

async function statusAll(matrixClient: MatrixClient): Promise<void> {
  console.log('Checking all workspaces...\n');

  const workspaces = await getAllWorkspacesStatus(matrixClient);

  for (const ws of workspaces) {
    const canWrite = ws.permissions.includes('write');
    const accessIcon = canWrite ? '✏️ ' : '👁️ ';

    if (!ws.hasSyncManifest) {
      console.log(`${accessIcon} ${ws.shortName}`);
      console.log(`   Not synced locally`);
      console.log(`   Run: boxel sync ./${ws.shortName.split('/').pop()} ${ws.url}`);
      console.log('');
      continue;
    }

    // Load manifest and check status
    const manifestPath = path.join(ws.localDir!, '.boxel-sync.json');
    const manifest: SyncManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const workspaceUrl = manifest.workspaceUrl.endsWith('/')
      ? manifest.workspaceUrl
      : manifest.workspaceUrl + '/';

    // Get remote status
    const realmAuth = new RealmAuthClient(new URL(workspaceUrl), matrixClient);
    const jwt = await realmAuth.getJWT();

    const mtimesUrl = `${workspaceUrl}_mtimes`;
    const mtimesResponse = await fetch(mtimesUrl, {
      headers: {
        'Authorization': jwt,
        'Accept': 'application/vnd.api+json'
      }
    });

    if (!mtimesResponse.ok) {
      console.log(`${accessIcon} ${ws.shortName}`);
      console.log(`   ❌ Failed to fetch remote status`);
      console.log('');
      continue;
    }

    const changes = await analyzeChanges(ws.localDir!, workspaceUrl, manifest, mtimesResponse);

    console.log(`${accessIcon} ${ws.shortName}`);
    console.log(`   Local: ${ws.localDir}`);

    if (changes.length === 0) {
      console.log(`   ✅ In sync`);
    } else {
      const newRemote = changes.filter(c => c.status === 'new-remote').length;
      const modRemote = changes.filter(c => c.status === 'modified-remote').length;
      const newLocal = changes.filter(c => c.status === 'new-local').length;
      const modLocal = changes.filter(c => c.status === 'modified-local').length;
      const conflicts = changes.filter(c => c.status === 'conflict').length;

      const parts: string[] = [];
      if (newRemote > 0) parts.push(`☁️ +${newRemote}`);
      if (modRemote > 0) parts.push(`☁️ ~${modRemote}`);
      if (newLocal > 0) parts.push(`📝 +${newLocal}`);
      if (modLocal > 0) parts.push(`📝 ~${modLocal}`);
      if (conflicts > 0) parts.push(`⚠️ !${conflicts}`);

      console.log(`   ${parts.join('  ')}`);
    }
    console.log('');
  }
}

async function analyzeChanges(
  localDir: string,
  workspaceUrl: string,
  manifest: SyncManifest,
  mtimesResponse: Response
): Promise<FileStatus[]> {
  const mtimesData = await mtimesResponse.json() as {
    data?: { attributes?: { mtimes?: Record<string, number> } }
  };

  const remoteMtimes: Record<string, number> = {};
  if (mtimesData.data?.attributes?.mtimes) {
    for (const [fullUrl, mtime] of Object.entries(mtimesData.data.attributes.mtimes)) {
      const relPath = fullUrl.replace(workspaceUrl, '');
      remoteMtimes[relPath] = mtime;
    }
  }

  // Get local files
  const localFiles = new Set<string>();
  function scanDir(dir: string, prefix: string = '') {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), relPath);
      } else {
        localFiles.add(relPath);
      }
    }
  }
  scanDir(localDir);

  // Analyze changes
  const changes: FileStatus[] = [];
  const allFiles = new Set([...Object.keys(remoteMtimes), ...localFiles]);

  for (const file of allFiles) {
    const manifestEntry = manifest.files[file];
    const remoteMtime = remoteMtimes[file];
    const localPath = path.join(localDir, file);
    const existsLocally = localFiles.has(file);

    if (!manifestEntry) {
      if (remoteMtime && !existsLocally) {
        changes.push({ file, status: 'new-remote', remoteMtime });
      } else if (!remoteMtime && existsLocally) {
        changes.push({ file, status: 'new-local' });
      }
      continue;
    }

    const remoteChanged = remoteMtime !== undefined && remoteMtime !== manifestEntry.remoteMtime;
    let localChanged = false;

    if (existsLocally) {
      const content = fs.readFileSync(localPath, 'utf-8');
      const hash = computeFileHash(content);
      localChanged = hash !== manifestEntry.localHash;
    }

    if (!existsLocally && remoteMtime) {
      changes.push({ file, status: 'deleted-local', remoteMtime });
    } else if (existsLocally && !remoteMtime) {
      changes.push({ file, status: 'deleted-remote' });
    } else if (remoteChanged && localChanged) {
      changes.push({ file, status: 'conflict', remoteMtime });
    } else if (remoteChanged) {
      changes.push({ file, status: 'modified-remote', remoteMtime });
    } else if (localChanged) {
      changes.push({ file, status: 'modified-local' });
    }
  }

  return changes;
}

async function statusSingle(
  localDir: string,
  workspaceUrl: string,
  manifest: SyncManifest,
  matrixClient: MatrixClient,
  options: { pull?: boolean }
): Promise<void> {
  workspaceUrl = workspaceUrl.endsWith('/') ? workspaceUrl : workspaceUrl + '/';

  console.log(`Workspace: ${workspaceUrl}`);
  console.log(`Local: ${localDir}`);
  console.log(`Last sync: ${new Date(manifest.lastSyncTime).toISOString()}`);
  console.log('');
  console.log('Checking for changes...');

  const realmAuth = new RealmAuthClient(new URL(workspaceUrl), matrixClient);
  const jwt = await realmAuth.getJWT();

  const mtimesUrl = `${workspaceUrl}_mtimes`;
  const mtimesResponse = await fetch(mtimesUrl, {
    headers: {
      'Authorization': jwt,
      'Accept': 'application/vnd.api+json'
    }
  });

  if (!mtimesResponse.ok) {
    console.error(`Failed to fetch remote mtimes: ${mtimesResponse.status}`);
    process.exit(1);
  }

  // Clone response for analyzeChanges since it consumes the body
  const mtimesData = await mtimesResponse.json() as {
    data?: { attributes?: { mtimes?: Record<string, number> } }
  };

  const remoteMtimes: Record<string, number> = {};
  if (mtimesData.data?.attributes?.mtimes) {
    for (const [fullUrl, mtime] of Object.entries(mtimesData.data.attributes.mtimes)) {
      const relPath = fullUrl.replace(workspaceUrl, '');
      remoteMtimes[relPath] = mtime;
    }
  }

  // Get local files
  const localFiles = new Set<string>();
  function scanDir(dir: string, prefix: string = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name), relPath);
      } else {
        localFiles.add(relPath);
      }
    }
  }
  scanDir(localDir);

  // Analyze changes
  const changes: FileStatus[] = [];
  const allFiles = new Set([...Object.keys(remoteMtimes), ...localFiles]);

  for (const file of allFiles) {
    const manifestEntry = manifest.files[file];
    const remoteMtime = remoteMtimes[file];
    const localPath = path.join(localDir, file);
    const existsLocally = localFiles.has(file);

    if (!manifestEntry) {
      if (remoteMtime && !existsLocally) {
        changes.push({ file, status: 'new-remote', remoteMtime });
      } else if (!remoteMtime && existsLocally) {
        changes.push({ file, status: 'new-local' });
      }
      continue;
    }

    const remoteChanged = remoteMtime !== undefined && remoteMtime !== manifestEntry.remoteMtime;
    let localChanged = false;

    if (existsLocally) {
      const content = fs.readFileSync(localPath, 'utf-8');
      const hash = computeFileHash(content);
      localChanged = hash !== manifestEntry.localHash;
    }

    if (!existsLocally && remoteMtime) {
      changes.push({ file, status: 'deleted-local', remoteMtime });
    } else if (existsLocally && !remoteMtime) {
      changes.push({ file, status: 'deleted-remote' });
    } else if (remoteChanged && localChanged) {
      changes.push({ file, status: 'conflict', remoteMtime });
    } else if (remoteChanged) {
      changes.push({ file, status: 'modified-remote', remoteMtime });
    } else if (localChanged) {
      changes.push({ file, status: 'modified-local' });
    }
  }

  // Display results
  if (changes.length === 0) {
    console.log('✅ Everything is in sync');
    return;
  }

  const newRemote = changes.filter(c => c.status === 'new-remote');
  const newLocal = changes.filter(c => c.status === 'new-local');
  const modifiedRemote = changes.filter(c => c.status === 'modified-remote');
  const modifiedLocal = changes.filter(c => c.status === 'modified-local');
  const conflicts = changes.filter(c => c.status === 'conflict');
  const deletedLocal = changes.filter(c => c.status === 'deleted-local');
  const deletedRemote = changes.filter(c => c.status === 'deleted-remote');

  console.log('');

  if (newRemote.length > 0) {
    console.log(`☁️  New on remote (${newRemote.length}):`);
    for (const c of newRemote) {
      console.log(`   + ${c.file}`);
    }
    console.log('');
  }

  if (modifiedRemote.length > 0) {
    console.log(`☁️  Modified on remote (${modifiedRemote.length}):`);
    for (const c of modifiedRemote) {
      console.log(`   ~ ${c.file}`);
    }
    console.log('');
  }

  if (newLocal.length > 0) {
    console.log(`📝 New locally (${newLocal.length}):`);
    for (const c of newLocal) {
      console.log(`   + ${c.file}`);
    }
    console.log('');
  }

  if (modifiedLocal.length > 0) {
    console.log(`📝 Modified locally (${modifiedLocal.length}):`);
    for (const c of modifiedLocal) {
      console.log(`   ~ ${c.file}`);
    }
    console.log('');
  }

  if (conflicts.length > 0) {
    console.log(`⚠️  Conflicts (${conflicts.length}):`);
    for (const c of conflicts) {
      console.log(`   ! ${c.file}`);
    }
    console.log('');
  }

  if (deletedLocal.length > 0) {
    console.log(`🗑️  Deleted locally (${deletedLocal.length}):`);
    for (const c of deletedLocal) {
      console.log(`   - ${c.file}`);
    }
    console.log('');
  }

  if (deletedRemote.length > 0) {
    console.log(`🗑️  Deleted on remote (${deletedRemote.length}):`);
    for (const c of deletedRemote) {
      console.log(`   - ${c.file}`);
    }
    console.log('');
  }

  // Pull if requested
  const toPull = [...newRemote, ...modifiedRemote];
  if (options.pull && toPull.length > 0) {
    console.log(`Pulling ${toPull.length} files from remote...`);

    const manifestPath = path.join(localDir, '.boxel-sync.json');

    for (const change of toPull) {
      const fileUrl = `${workspaceUrl}${change.file}`;
      const response = await fetch(fileUrl, {
        headers: {
          'Authorization': jwt,
          'Accept': 'application/vnd.card+source'
        }
      });

      if (response.ok) {
        const content = await response.text();
        const filePath = path.join(localDir, change.file);

        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, content);

        // Update manifest
        manifest.files[change.file] = {
          localHash: computeFileHash(content),
          remoteMtime: change.remoteMtime!
        };

        console.log(`   ✓ ${change.file}`);
      } else {
        console.log(`   ✗ ${change.file} (${response.status})`);
      }
    }

    manifest.lastSyncTime = Date.now();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('\n✅ Pull complete');
  } else if (toPull.length > 0) {
    console.log(`Run with --pull to download ${toPull.length} remote changes`);
  }

  if (conflicts.length > 0) {
    console.log('\nTo resolve conflicts, run: boxel sync');
  }
}
