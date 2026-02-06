import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MatrixClient } from '../lib/matrix-client.js';
import { RealmAuthClient } from '../lib/realm-auth-client.js';
import { getProfileManager, formatProfileBadge } from '../lib/profile-manager.js';
function computeFileHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
}
export async function checkCommand(filePath, options) {
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
    // Resolve the file path
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        console.error(`File not found: ${absolutePath}`);
        process.exit(1);
    }
    // Find the workspace root (directory containing .boxel-sync.json)
    let workspaceRoot = path.dirname(absolutePath);
    let manifestPath = '';
    while (workspaceRoot !== '/') {
        const candidatePath = path.join(workspaceRoot, '.boxel-sync.json');
        if (fs.existsSync(candidatePath)) {
            manifestPath = candidatePath;
            break;
        }
        workspaceRoot = path.dirname(workspaceRoot);
    }
    if (!manifestPath) {
        console.error('No .boxel-sync.json found. Run sync first to establish tracking.');
        process.exit(1);
    }
    // Load manifest
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    // Ensure workspace URL ends with trailing slash
    const workspaceUrl = manifest.workspaceUrl.endsWith('/')
        ? manifest.workspaceUrl
        : manifest.workspaceUrl + '/';
    // Get relative path from workspace root
    const relativePath = path.relative(workspaceRoot, absolutePath);
    // Read local file
    const localContent = fs.readFileSync(absolutePath, 'utf-8');
    const localHash = computeFileHash(localContent);
    const localMtime = fs.statSync(absolutePath).mtimeMs;
    // Check manifest state
    const manifestEntry = manifest.files[relativePath];
    console.log(`Checking: ${relativePath}`);
    console.log(`Workspace: ${workspaceUrl}`);
    console.log('');
    // Authenticate and check remote
    console.log('Fetching remote state...');
    const matrixClient = new MatrixClient({
        matrixURL: new URL(matrixUrl),
        username: matrixUsername,
        password: matrixPassword
    });
    await matrixClient.login();
    const realmAuth = new RealmAuthClient(new URL(workspaceUrl), matrixClient);
    const jwt = await realmAuth.getJWT();
    // Get remote mtime
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
    // Parse mtimes response - keys are full URLs
    const mtimesData = await mtimesResponse.json();
    // Convert full URLs to relative paths
    const remoteMtimes = {};
    if (mtimesData.data?.attributes?.mtimes) {
        for (const [fullUrl, mtime] of Object.entries(mtimesData.data.attributes.mtimes)) {
            const relPath = fullUrl.replace(workspaceUrl, '');
            remoteMtimes[relPath] = mtime;
        }
    }
    const remoteMtime = remoteMtimes[relativePath];
    // Analysis
    console.log('Status:');
    let localChanged = false;
    let remoteChanged = false;
    let isNew = false;
    if (!manifestEntry) {
        if (remoteMtime === undefined) {
            console.log('  ✨ NEW FILE - not yet synced to remote');
            isNew = true;
        }
        else {
            console.log('  ⚠️  UNTRACKED - exists on remote but not in sync manifest');
            console.log('     Run sync to establish tracking');
        }
    }
    else {
        // Check local changes
        if (localHash !== manifestEntry.localHash) {
            localChanged = true;
            console.log('  📝 LOCAL MODIFIED - changed since last sync');
        }
        // Check remote changes
        if (remoteMtime === undefined) {
            console.log('  ❌ DELETED ON REMOTE - file no longer exists on server');
        }
        else if (remoteMtime !== manifestEntry.remoteMtime) {
            remoteChanged = true;
            console.log('  ☁️  REMOTE MODIFIED - changed on server since last sync');
            console.log(`     Last synced remote mtime: ${new Date(manifestEntry.remoteMtime * 1000).toISOString()}`);
            console.log(`     Current remote mtime: ${new Date(remoteMtime * 1000).toISOString()}`);
        }
        if (!localChanged && !remoteChanged && remoteMtime !== undefined) {
            console.log('  ✅ IN SYNC - safe to edit');
        }
    }
    console.log('');
    // Recommendations
    if (remoteChanged && !localChanged) {
        console.log('Recommendation: Pull remote changes before editing');
        console.log(`  boxel sync ${workspaceRoot} ${workspaceUrl}`);
        if (options.sync) {
            console.log('\nPulling remote changes...');
            const fileUrl = new URL(relativePath, workspaceUrl).toString();
            const response = await fetch(fileUrl, {
                headers: {
                    'Authorization': `Bearer ${jwt}`,
                    'Accept': 'application/vnd.card+source'
                }
            });
            if (response.ok) {
                const content = await response.text();
                fs.writeFileSync(absolutePath, content);
                // Update manifest
                manifest.files[relativePath] = {
                    localHash: computeFileHash(content),
                    remoteMtime: remoteMtime
                };
                manifest.lastSyncTime = Date.now();
                fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
                console.log('✅ File updated from remote. Safe to edit now.');
            }
            else {
                console.error(`Failed to pull: ${response.status}`);
            }
        }
    }
    else if (localChanged && remoteChanged) {
        console.log('⚠️  CONFLICT - both local and remote have changes');
        console.log('Recommendation: Run sync to resolve conflict');
        console.log(`  boxel sync ${workspaceRoot} ${workspaceUrl}`);
    }
    else if (localChanged && !remoteChanged) {
        console.log('You have local changes. Push when ready:');
        console.log(`  boxel sync ${workspaceRoot} ${workspaceUrl}`);
    }
    else if (isNew) {
        console.log('Push to remote when ready:');
        console.log(`  boxel sync ${workspaceRoot} ${workspaceUrl}`);
    }
}
//# sourceMappingURL=check.js.map