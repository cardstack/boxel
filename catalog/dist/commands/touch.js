import { RealmSyncBase, validateMatrixEnvVars } from '../lib/realm-sync-base.js';
import { resolveWorkspace } from '../lib/workspace-resolver.js';
import { MatrixClient } from '../lib/matrix-client.js';
import { getProfileManager, formatProfileBadge } from '../lib/profile-manager.js';
import * as fs from 'fs';
class RealmToucher extends RealmSyncBase {
    touchOptions;
    hasError = false;
    filesToTouch;
    constructor(touchOptions, matrixUrl, username, password) {
        super(touchOptions, matrixUrl, username, password);
        this.touchOptions = touchOptions;
        this.filesToTouch = touchOptions.files || [];
    }
    async touch() {
        console.log(`Touching files in ${this.options.workspaceUrl} to force re-indexing`);
        console.log('Testing workspace access...');
        try {
            await this.getRemoteFileList('');
        }
        catch (error) {
            console.error('Failed to access workspace:', error);
            throw new Error('Cannot proceed: Authentication or access failed. ' +
                'Please check your Matrix credentials and workspace permissions.');
        }
        console.log('Workspace access verified\n');
        // Get local files
        const localFiles = await this.getLocalFileList();
        // Determine which files to touch
        let filesToProcess;
        if (this.filesToTouch.length > 0) {
            // Touch specific files
            filesToProcess = new Map();
            for (const filePattern of this.filesToTouch) {
                for (const [relativePath, localPath] of localFiles) {
                    if (relativePath === filePattern ||
                        relativePath.includes(filePattern) ||
                        relativePath.endsWith(filePattern)) {
                        filesToProcess.set(relativePath, localPath);
                    }
                }
            }
            if (filesToProcess.size === 0) {
                console.log(`No files matched: ${this.filesToTouch.join(', ')}`);
                return;
            }
        }
        else {
            // Touch all .json and .gts files
            filesToProcess = new Map();
            for (const [relativePath, localPath] of localFiles) {
                if (relativePath.endsWith('.json') || relativePath.endsWith('.gts')) {
                    filesToProcess.set(relativePath, localPath);
                }
            }
        }
        console.log(`Touching ${filesToProcess.size} file(s)...\n`);
        let touched = 0;
        for (const [relativePath, localPath] of filesToProcess) {
            try {
                // Read file content
                let content = fs.readFileSync(localPath, 'utf8');
                // Make a trivial mutation that doesn't change semantics
                if (relativePath.endsWith('.json')) {
                    content = this.touchJson(content);
                }
                else if (relativePath.endsWith('.gts')) {
                    content = this.touchGts(content);
                }
                // Write back locally
                fs.writeFileSync(localPath, content);
                // Upload to remote
                if (!this.options.dryRun) {
                    await this.uploadFile(relativePath, localPath);
                    console.log(`  Touched: ${relativePath}`);
                    touched++;
                }
                else {
                    console.log(`  [DRY RUN] Would touch: ${relativePath}`);
                }
            }
            catch (error) {
                this.hasError = true;
                console.error(`Error touching ${relativePath}:`, error);
            }
        }
        console.log(`\nTouched ${touched} file(s) to trigger re-indexing`);
    }
    touchJson(content) {
        try {
            const data = JSON.parse(content);
            // Add or update a _touched timestamp in meta
            if (data.data && data.data.meta) {
                data.data.meta._touched = Date.now();
            }
            else if (data.data) {
                data.data.meta = { _touched: Date.now() };
            }
            return JSON.stringify(data, null, 2) + '\n';
        }
        catch {
            // If JSON parsing fails, just add/toggle trailing newline
            if (content.endsWith('\n\n')) {
                return content.slice(0, -1);
            }
            else if (content.endsWith('\n')) {
                return content + '\n';
            }
            else {
                return content + '\n';
            }
        }
    }
    touchGts(content) {
        // For .gts files, toggle a comment at the end
        const touchComment = '// touched for re-index';
        if (content.includes(touchComment)) {
            // Remove the touch comment
            return content.replace(new RegExp(`\\n?${touchComment}\\n?`, 'g'), '\n');
        }
        else {
            // Add the touch comment at the end
            if (content.endsWith('\n')) {
                return content + touchComment + '\n';
            }
            else {
                return content + '\n' + touchComment + '\n';
            }
        }
    }
    // Required by abstract base class
    async sync() {
        await this.touch();
    }
}
export async function touchCommand(workspaceRef, files, options) {
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
    let localDir;
    let workspaceUrl;
    // Resolve workspace reference
    console.log('Resolving workspace...');
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
    // Validate
    const { matrixUrl: validatedMatrixUrl, username, password } = await validateMatrixEnvVars(workspaceUrl);
    if (!fs.existsSync(localDir)) {
        console.error(`Local directory does not exist: ${localDir}`);
        console.error('Run "boxel sync" first to pull the workspace locally.');
        process.exit(1);
    }
    try {
        const toucher = new RealmToucher({
            workspaceUrl,
            localDir,
            files: files.length > 0 ? files : (options.all ? [] : []),
            dryRun: options.dryRun,
        }, validatedMatrixUrl, username, password);
        await toucher.initialize();
        await toucher.touch();
        if (toucher.hasError) {
            console.log('Touch completed with errors. View logs for details.');
            process.exit(2);
        }
        else {
            console.log('Touch completed successfully');
        }
    }
    catch (error) {
        console.error('Touch failed:', error);
        process.exit(1);
    }
}
//# sourceMappingURL=touch.js.map