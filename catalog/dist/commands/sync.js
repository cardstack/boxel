import { RealmSyncBase, validateMatrixEnvVars } from '../lib/realm-sync-base.js';
import { resolveWorkspace } from '../lib/workspace-resolver.js';
import { MatrixClient } from '../lib/matrix-client.js';
import { CheckpointManager } from '../lib/checkpoint-manager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as readline from 'readline';
function isOldManifest(manifest) {
    if (!manifest || typeof manifest !== 'object')
        return false;
    const m = manifest;
    if (typeof m.files !== 'object' || !m.files)
        return false;
    // Check if files values are strings (old format) vs objects (new format)
    const firstValue = Object.values(m.files)[0];
    return typeof firstValue === 'string';
}
function computeFileHash(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
}
function loadManifest(localDir, remoteMtimes) {
    const manifestPath = path.join(localDir, '.boxel-sync.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            // Check if it's the old format and migrate
            if (isOldManifest(data)) {
                console.log('Migrating manifest from push-only format to sync format...');
                const oldManifest = data;
                const newManifest = {
                    workspaceUrl: oldManifest.workspaceUrl,
                    lastSyncTime: Date.now(),
                    files: {},
                };
                // Convert old format to new format
                for (const [filePath, hash] of Object.entries(oldManifest.files)) {
                    newManifest.files[filePath] = {
                        localHash: hash,
                        remoteMtime: remoteMtimes?.get(filePath) || 0,
                    };
                }
                return newManifest;
            }
            return data;
        }
        catch {
            return null;
        }
    }
    return null;
}
function saveManifest(localDir, manifest) {
    const manifestPath = path.join(localDir, '.boxel-sync.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
async function promptUser(question, options) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        const optionsStr = options.map((o, i) => `[${o[0].toUpperCase()}] ${o}`).join('  ');
        rl.question(`${question}\n${optionsStr}\n> `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase());
        });
    });
}
class RealmSyncer extends RealmSyncBase {
    syncOptions;
    hasError = false;
    constructor(syncOptions, matrixUrl, username, password) {
        super(syncOptions, matrixUrl, username, password);
        this.syncOptions = syncOptions;
    }
    getConflictStrategy() {
        if (this.syncOptions.preferLocal)
            return 'local';
        if (this.syncOptions.preferRemote)
            return 'remote';
        if (this.syncOptions.preferNewest)
            return 'newest';
        return 'manual';
    }
    async sync() {
        console.log(`Starting bidirectional sync: ${this.options.localDir} <-> ${this.options.workspaceUrl}`);
        // Test access
        console.log('Testing workspace access...');
        try {
            await this.getRemoteFileList('');
        }
        catch (error) {
            console.error('Failed to access workspace:', error);
            throw new Error('Cannot proceed: Authentication or access failed.');
        }
        console.log('Workspace access verified\n');
        // Get current state from both sides
        console.log('Scanning local files...');
        const localFiles = await this.getLocalFileList();
        console.log(`Found ${localFiles.size} local files`);
        console.log('Fetching remote state...');
        const remoteMtimes = await this.getRemoteMtimes();
        const remoteFiles = await this.getRemoteFileList();
        console.log(`Found ${remoteFiles.size} remote files`);
        // Load manifest (pass remoteMtimes for migration)
        const manifest = loadManifest(this.options.localDir, remoteMtimes);
        const isFirstSync = !manifest || manifest.workspaceUrl !== this.options.workspaceUrl;
        if (isFirstSync) {
            console.log('\nFirst sync detected - will analyze all files');
        }
        console.log('');
        // Determine actions for each file
        const actions = this.computeActions(localFiles, remoteMtimes, remoteFiles, manifest, isFirstSync);
        // Summarize actions
        const pushActions = actions.filter(a => a.type === 'push');
        const pullActions = actions.filter(a => a.type === 'pull');
        const conflicts = actions.filter(a => a.type === 'conflict');
        const deleteLocalActions = actions.filter(a => a.type === 'delete-local');
        const deleteRemoteActions = actions.filter(a => a.type === 'delete-remote');
        const noActions = actions.filter(a => a.type === 'none');
        console.log('Sync Summary:');
        console.log(`  Push (local → remote): ${pushActions.length} files`);
        console.log(`  Pull (remote → local): ${pullActions.length} files`);
        console.log(`  Conflicts: ${conflicts.length} files`);
        if (deleteLocalActions.length > 0) {
            console.log(`  Delete local (removed from server): ${deleteLocalActions.length} files`);
        }
        if (this.syncOptions.delete && deleteRemoteActions.length > 0) {
            console.log(`  Delete remote: ${deleteRemoteActions.length} files`);
        }
        console.log(`  Unchanged: ${noActions.length} files`);
        console.log('');
        if (this.options.dryRun) {
            console.log('[DRY RUN] Would perform the following actions:\n');
            for (const action of actions) {
                if (action.type !== 'none') {
                    console.log(`  ${action.type.toUpperCase()}: ${action.relativePath}`);
                    console.log(`    Reason: ${action.reason}`);
                }
            }
            return;
        }
        // Execute actions
        const newManifest = {
            workspaceUrl: this.options.workspaceUrl,
            lastSyncTime: Date.now(),
            files: {},
        };
        // Handle conflicts first
        if (conflicts.length > 0) {
            console.log('Resolving conflicts...\n');
            for (const conflict of conflicts) {
                const resolution = await this.resolveConflict(conflict);
                if (resolution === 'push') {
                    pushActions.push({ ...conflict, type: 'push' });
                }
                else if (resolution === 'pull') {
                    pullActions.push({ ...conflict, type: 'pull' });
                }
                else if (resolution === 'delete-remote') {
                    deleteRemoteActions.push({ ...conflict, type: 'delete-remote' });
                }
                else {
                    // Skip - keep as is (use local version in manifest)
                    if (conflict.localPath) {
                        newManifest.files[conflict.relativePath] = {
                            localHash: computeFileHash(conflict.localPath),
                            remoteMtime: conflict.remoteMtime || 0,
                        };
                    }
                }
            }
        }
        // Execute pushes
        const pushedFiles = [];
        if (pushActions.length > 0) {
            console.log(`\nPushing ${pushActions.length} files to remote...`);
            for (const action of pushActions) {
                if (action.localPath) {
                    try {
                        await this.uploadFile(action.relativePath, action.localPath);
                        pushedFiles.push(action.relativePath);
                    }
                    catch (error) {
                        this.hasError = true;
                        console.error(`Error pushing ${action.relativePath}:`, error);
                    }
                }
            }
        }
        // Fetch actual remote mtimes after pushing to get accurate timestamps
        let updatedRemoteMtimes = remoteMtimes;
        if (pushedFiles.length > 0) {
            console.log('\nFetching updated remote timestamps...');
            updatedRemoteMtimes = await this.getRemoteMtimes();
        }
        // Update manifest for pushed files with actual remote mtimes
        for (const filePath of pushedFiles) {
            const localPath = localFiles.get(filePath);
            if (localPath) {
                newManifest.files[filePath] = {
                    localHash: computeFileHash(localPath),
                    remoteMtime: updatedRemoteMtimes.get(filePath) || Math.floor(Date.now() / 1000),
                };
            }
        }
        // Execute pulls
        if (pullActions.length > 0) {
            console.log(`\nPulling ${pullActions.length} files from remote...`);
            for (const action of pullActions) {
                const localPath = path.join(this.options.localDir, action.relativePath);
                try {
                    await this.downloadFile(action.relativePath, localPath);
                    // After pull, local file has remote content
                    newManifest.files[action.relativePath] = {
                        localHash: computeFileHash(localPath),
                        remoteMtime: action.remoteMtime || Math.floor(Date.now() / 1000),
                    };
                }
                catch (error) {
                    this.hasError = true;
                    console.error(`Error pulling ${action.relativePath}:`, error);
                }
            }
        }
        // Handle local deletions (files deleted on server) - always sync these
        // Create checkpoint BEFORE deleting so we can recover
        if (deleteLocalActions.length > 0) {
            const checkpointManager = new CheckpointManager(this.options.localDir);
            const deleteChanges = deleteLocalActions.map(a => ({
                file: a.relativePath,
                status: 'deleted',
            }));
            const preDeleteCheckpoint = checkpointManager.createCheckpoint('remote', deleteChanges, `Pre-delete checkpoint: ${deleteLocalActions.length} files removed from server`);
            if (preDeleteCheckpoint) {
                console.log(`\n📍 Checkpoint created before deletion: ${preDeleteCheckpoint.shortHash}`);
            }
            console.log(`\nDeleting ${deleteLocalActions.length} local files (removed from server)...`);
            for (const action of deleteLocalActions) {
                const localPath = path.join(this.options.localDir, action.relativePath);
                try {
                    await this.deleteLocalFile(localPath);
                    console.log(`  Deleted: ${action.relativePath}`);
                }
                catch (error) {
                    this.hasError = true;
                    console.error(`Error deleting local ${action.relativePath}:`, error);
                }
            }
        }
        // Execute remote deletions (from --delete flag or conflict resolution)
        if (deleteRemoteActions.length > 0) {
            console.log(`\nDeleting ${deleteRemoteActions.length} files from remote...`);
            for (const action of deleteRemoteActions) {
                try {
                    await this.deleteFile(action.relativePath);
                }
                catch (error) {
                    this.hasError = true;
                    console.error(`Error deleting remote ${action.relativePath}:`, error);
                }
            }
        }
        // Add unchanged files to manifest
        for (const action of noActions) {
            if (action.localPath && manifest?.files[action.relativePath]) {
                newManifest.files[action.relativePath] = {
                    localHash: computeFileHash(action.localPath),
                    remoteMtime: action.remoteMtime || manifest.files[action.relativePath].remoteMtime,
                };
            }
            else if (action.localPath) {
                newManifest.files[action.relativePath] = {
                    localHash: computeFileHash(action.localPath),
                    remoteMtime: action.remoteMtime || Math.floor(Date.now() / 1000),
                };
            }
        }
        // Save manifest
        saveManifest(this.options.localDir, newManifest);
        // Create checkpoints for changes
        if (!this.syncOptions.dryRun) {
            const checkpointManager = new CheckpointManager(this.options.localDir);
            // Create checkpoint for pulled files (remote changes)
            if (pullActions.length > 0) {
                const pullChanges = pullActions.map(a => ({
                    file: a.relativePath,
                    status: 'modified',
                }));
                const checkpoint = checkpointManager.createCheckpoint('remote', pullChanges);
                if (checkpoint) {
                    const tag = checkpoint.isMajor ? '[MAJOR]' : '[minor]';
                    console.log(`\n📍 Checkpoint created: ${checkpoint.shortHash} ${tag} ${checkpoint.message}`);
                }
            }
            // Create checkpoint for pushed files (local changes)
            if (pushedFiles.length > 0) {
                const pushChanges = pushedFiles.map(f => ({
                    file: f,
                    status: 'modified',
                }));
                const checkpoint = checkpointManager.createCheckpoint('local', pushChanges);
                if (checkpoint) {
                    const tag = checkpoint.isMajor ? '[MAJOR]' : '[minor]';
                    console.log(`\n📍 Checkpoint created: ${checkpoint.shortHash} ${tag} ${checkpoint.message}`);
                }
            }
        }
        console.log('\nSync completed');
    }
    computeActions(localFiles, remoteMtimes, remoteFiles, manifest, isFirstSync) {
        const actions = [];
        // Use remoteFiles for existence check (includes dotfiles like .realm.json)
        const allPaths = new Set([...localFiles.keys(), ...remoteFiles.keys()]);
        for (const relativePath of allPaths) {
            const localPath = localFiles.get(relativePath);
            const remoteMtime = remoteMtimes.get(relativePath);
            const baseState = manifest?.files[relativePath];
            const hasLocal = localPath !== undefined;
            // Use remoteFiles for existence, remoteMtimes for change detection
            const hasRemote = remoteFiles.has(relativePath);
            const hasBase = baseState !== undefined;
            // Compute current local hash if file exists
            const currentLocalHash = hasLocal ? computeFileHash(localPath) : undefined;
            if (isFirstSync) {
                // First sync - no base to compare against
                if (hasLocal && hasRemote) {
                    // Both exist - prefer local for first sync (user initiated)
                    actions.push({
                        type: 'push',
                        relativePath,
                        localPath,
                        reason: 'First sync, local version will be pushed',
                        remoteMtime,
                    });
                }
                else if (hasLocal && !hasRemote) {
                    actions.push({
                        type: 'push',
                        relativePath,
                        localPath,
                        reason: 'New local file',
                    });
                }
                else if (!hasLocal && hasRemote) {
                    actions.push({
                        type: 'pull',
                        relativePath,
                        reason: 'New remote file',
                        remoteMtime,
                    });
                }
            }
            else {
                // Subsequent sync - compare against base
                const localChanged = hasLocal && hasBase && currentLocalHash !== baseState.localHash;
                const localNew = hasLocal && !hasBase;
                const localDeleted = !hasLocal && hasBase;
                // For remote change detection: if file exists but no mtime available (e.g., .realm.json),
                // we can't detect changes, so assume unchanged
                const remoteChanged = hasRemote && hasBase && remoteMtime !== undefined && remoteMtime !== baseState.remoteMtime;
                const remoteNew = hasRemote && !hasBase;
                const remoteDeleted = !hasRemote && hasBase;
                if (hasLocal && hasRemote) {
                    if (localChanged && remoteChanged) {
                        // CONFLICT - both changed
                        actions.push({
                            type: 'conflict',
                            relativePath,
                            localPath,
                            reason: 'Both local and remote modified since last sync',
                            localMtime: fs.statSync(localPath).mtimeMs,
                            remoteMtime,
                        });
                    }
                    else if (localChanged || localNew) {
                        actions.push({
                            type: 'push',
                            relativePath,
                            localPath,
                            reason: localNew ? 'New local file' : 'Local file modified',
                            remoteMtime,
                        });
                    }
                    else if (remoteChanged || remoteNew) {
                        actions.push({
                            type: 'pull',
                            relativePath,
                            localPath,
                            reason: remoteNew ? 'New remote file' : 'Remote file modified',
                            remoteMtime,
                        });
                    }
                    else {
                        actions.push({
                            type: 'none',
                            relativePath,
                            localPath,
                            reason: 'No changes',
                            remoteMtime,
                        });
                    }
                }
                else if (hasLocal && !hasRemote) {
                    if (remoteDeleted && !localChanged) {
                        // Remote deleted, local unchanged - delete local
                        actions.push({
                            type: 'delete-local',
                            relativePath,
                            localPath,
                            reason: 'Deleted on remote',
                        });
                    }
                    else if (remoteDeleted && localChanged) {
                        // CONFLICT - remote deleted but local modified
                        actions.push({
                            type: 'conflict',
                            relativePath,
                            localPath,
                            reason: 'Remote deleted but local modified',
                            localMtime: fs.statSync(localPath).mtimeMs,
                        });
                    }
                    else {
                        // New local file
                        actions.push({
                            type: 'push',
                            relativePath,
                            localPath,
                            reason: 'New local file',
                        });
                    }
                }
                else if (!hasLocal && hasRemote) {
                    if (localDeleted && !remoteChanged) {
                        // Local deleted, remote unchanged - delete remote
                        actions.push({
                            type: 'delete-remote',
                            relativePath,
                            reason: 'Deleted locally',
                            remoteMtime,
                        });
                    }
                    else if (localDeleted && remoteChanged) {
                        // CONFLICT - local deleted but remote modified
                        actions.push({
                            type: 'conflict',
                            relativePath,
                            reason: 'Local deleted but remote modified',
                            remoteMtime,
                        });
                    }
                    else {
                        // New remote file
                        actions.push({
                            type: 'pull',
                            relativePath,
                            reason: 'New remote file',
                            remoteMtime,
                        });
                    }
                }
            }
        }
        return actions;
    }
    async resolveConflict(conflict) {
        const strategy = this.getConflictStrategy();
        console.log(`CONFLICT: ${conflict.relativePath}`);
        console.log(`  Reason: ${conflict.reason}`);
        if (strategy === 'local') {
            // If file was deleted locally, delete from remote too
            if (conflict.reason.includes('Local deleted')) {
                console.log('  Resolution: Deleting from remote (--prefer-local)');
                return 'delete-remote';
            }
            console.log('  Resolution: Keeping local (--prefer-local)');
            return 'push';
        }
        if (strategy === 'remote') {
            console.log('  Resolution: Keeping remote (--prefer-remote)');
            return 'pull';
        }
        if (strategy === 'newest') {
            const localMtime = conflict.localMtime || 0;
            const remoteMtimeMs = (conflict.remoteMtime || 0) * 1000;
            if (localMtime > remoteMtimeMs) {
                console.log('  Resolution: Keeping local (newest)');
                return 'push';
            }
            else {
                console.log('  Resolution: Keeping remote (newest)');
                return 'pull';
            }
        }
        // Manual resolution
        if (conflict.localMtime) {
            console.log(`  Local modified: ${new Date(conflict.localMtime).toISOString()}`);
        }
        if (conflict.remoteMtime) {
            console.log(`  Remote modified: ${new Date(conflict.remoteMtime * 1000).toISOString()}`);
        }
        const answer = await promptUser('How do you want to resolve this conflict?', ['local', 'remote', 'skip']);
        if (answer.startsWith('l')) {
            return 'push';
        }
        else if (answer.startsWith('r')) {
            return 'pull';
        }
        else {
            console.log('  Skipping...');
            return 'skip';
        }
    }
}
export async function syncCommand(workspaceRef, explicitUrl, options) {
    const matrixUrl = process.env.MATRIX_URL;
    const matrixUsername = process.env.MATRIX_USERNAME;
    const matrixPassword = process.env.MATRIX_PASSWORD;
    if (!matrixUrl || !matrixUsername || !matrixPassword) {
        console.error('Missing Matrix credentials in environment variables');
        process.exit(1);
    }
    let localDir;
    let workspaceUrl;
    // Resolve workspace reference
    if (explicitUrl) {
        // Traditional format: local-dir workspace-url
        localDir = path.resolve(workspaceRef);
        workspaceUrl = explicitUrl;
    }
    else {
        // New format: workspace reference (., ./path, @user/workspace, https://...)
        console.log('Resolving workspace...');
        // Need to create matrix client for @user/workspace resolution
        let matrixClient;
        if (workspaceRef.startsWith('@')) {
            matrixClient = new MatrixClient({
                matrixURL: new URL(matrixUrl),
                username: matrixUsername,
                password: matrixPassword
            });
            await matrixClient.login();
        }
        try {
            const resolved = await resolveWorkspace(workspaceRef, matrixClient);
            localDir = resolved.localDir;
            workspaceUrl = resolved.workspaceUrl;
        }
        catch (error) {
            console.error(error.message);
            process.exit(1);
        }
    }
    // Validate with the resolved URL
    const { matrixUrl: validatedMatrixUrl, username, password } = await validateMatrixEnvVars(workspaceUrl);
    // Create directory if it doesn't exist
    if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
        console.log(`Created directory: ${localDir}`);
    }
    try {
        const syncer = new RealmSyncer({
            workspaceUrl,
            localDir,
            preferLocal: options.preferLocal,
            preferRemote: options.preferRemote,
            preferNewest: options.preferNewest,
            delete: options.delete,
            dryRun: options.dryRun,
        }, validatedMatrixUrl, username, password);
        await syncer.initialize();
        await syncer.sync();
        if (syncer.hasError) {
            console.log('Sync completed with errors. View logs for details.');
            process.exit(2);
        }
        else {
            console.log('Sync completed successfully');
        }
    }
    catch (error) {
        console.error('Sync failed:', error);
        process.exit(1);
    }
}
//# sourceMappingURL=sync.js.map