import { MatrixClient, passwordFromSeed } from './matrix-client.js';
import { RealmAuthClient } from './realm-auth-client.js';
import * as fs from 'fs';
import * as path from 'path';
import ignoreModule from 'ignore';
const ignore = ignoreModule.default || ignoreModule;
export const SupportedMimeType = {
    CardJson: 'application/vnd.card+json',
    CardSource: 'application/vnd.card+source',
    DirectoryListing: 'application/vnd.api+json',
    Mtimes: 'application/vnd.api+json',
};
export class RealmSyncBase {
    options;
    matrixClient;
    realmAuthClient;
    normalizedRealmUrl;
    ignoreCache = new Map();
    constructor(options, matrixUrl, username, password) {
        this.options = options;
        this.matrixClient = new MatrixClient({
            matrixURL: new URL(matrixUrl),
            username,
            password,
        });
        // Normalize the realm URL once at construction
        this.normalizedRealmUrl = this.normalizeRealmUrl(options.workspaceUrl);
        this.realmAuthClient = new RealmAuthClient(new URL(this.normalizedRealmUrl), this.matrixClient);
    }
    async initialize() {
        console.log('Logging into Matrix...');
        await this.matrixClient.login();
        console.log('Matrix login successful');
    }
    normalizeRealmUrl(url) {
        try {
            const urlObj = new URL(url);
            // Ensure it ends with a single slash for consistency
            return urlObj.href.replace(/\/+$/, '') + '/';
        }
        catch {
            throw new Error(`Invalid workspace URL: ${url}`);
        }
    }
    buildDirectoryUrl(dir = '') {
        if (!dir) {
            return this.normalizedRealmUrl;
        }
        const cleanDir = dir.replace(/^\/+|\/+$/g, '');
        return `${this.normalizedRealmUrl}${cleanDir}/`;
    }
    buildFileUrl(relativePath) {
        const cleanPath = relativePath.replace(/^\/+/, '');
        return `${this.normalizedRealmUrl}${cleanPath}`;
    }
    async getRemoteFileList(dir = '') {
        const files = new Map();
        try {
            const url = this.buildDirectoryUrl(dir);
            const jwt = await this.realmAuthClient.getJWT();
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/vnd.api+json',
                    Authorization: jwt,
                },
            });
            if (!response.ok) {
                if (response.status === 404) {
                    return files;
                }
                if (response.status === 401 || response.status === 403) {
                    throw new Error(`Authentication failed (${response.status}): Cannot access workspace. Check your Matrix credentials and workspace permissions.`);
                }
                throw new Error(`Failed to get directory listing: ${response.status} ${response.statusText}`);
            }
            const data = (await response.json());
            if (data.data && data.data.relationships) {
                for (const [name, info] of Object.entries(data.data.relationships)) {
                    const entry = info;
                    const isFile = entry.meta.kind === 'file';
                    const entryPath = dir ? path.posix.join(dir, name) : name;
                    if (isFile) {
                        if (!this.shouldIgnoreRemoteFile(entryPath)) {
                            files.set(entryPath, true);
                        }
                    }
                    else {
                        const subdirFiles = await this.getRemoteFileList(entryPath);
                        for (const [subPath, isFileEntry] of subdirFiles) {
                            files.set(subPath, isFileEntry);
                        }
                    }
                }
            }
        }
        catch (error) {
            if (error instanceof Error) {
                if (error.message.includes('Authentication failed') ||
                    error.message.includes('Cannot access workspace') ||
                    error.message.includes('401') ||
                    error.message.includes('403')) {
                    throw error;
                }
            }
            console.error(`Error reading remote directory ${dir}:`, error);
            throw error;
        }
        // Check for .realm.json in root directory
        if (!dir) {
            try {
                const realmJsonUrl = this.buildFileUrl('.realm.json');
                const jwt = await this.realmAuthClient.getJWT();
                const response = await fetch(realmJsonUrl, {
                    method: 'HEAD',
                    headers: {
                        Authorization: jwt,
                    },
                });
                if (response.ok) {
                    files.set('.realm.json', true);
                }
            }
            catch {
                console.log('Note: .realm.json not found in remote realm');
            }
        }
        return files;
    }
    async getRemoteMtimes() {
        const mtimes = new Map();
        try {
            const url = `${this.normalizedRealmUrl}_mtimes`;
            const jwt = await this.realmAuthClient.getJWT();
            const response = await fetch(url, {
                headers: {
                    Accept: SupportedMimeType.Mtimes,
                    Authorization: jwt,
                },
            });
            if (!response.ok) {
                if (response.status === 404) {
                    console.log('Note: _mtimes endpoint not available, will upload all files');
                    return mtimes;
                }
                throw new Error(`Failed to get mtimes: ${response.status} ${response.statusText}`);
            }
            const data = (await response.json());
            if (data.data?.attributes?.mtimes) {
                const remoteMtimeEntries = Object.entries(data.data.attributes.mtimes);
                if (process.env.DEBUG) {
                    console.log(`Remote mtimes received: ${remoteMtimeEntries.length} entries`);
                    if (remoteMtimeEntries.length > 0) {
                        console.log(`Sample: ${remoteMtimeEntries[0][0]} = ${remoteMtimeEntries[0][1]}`);
                    }
                }
                for (const [fileUrl, mtime] of remoteMtimeEntries) {
                    // Convert full URL to relative path
                    const relativePath = fileUrl.replace(this.normalizedRealmUrl, '');
                    if (!this.shouldIgnoreRemoteFile(relativePath)) {
                        mtimes.set(relativePath, mtime);
                    }
                }
            }
            else if (process.env.DEBUG) {
                console.log('No mtimes in response:', JSON.stringify(data).slice(0, 200));
            }
        }
        catch (error) {
            console.warn('Could not fetch remote mtimes, will upload all files:', error);
        }
        return mtimes;
    }
    async getLocalFileListWithMtimes(dir = '') {
        const files = new Map();
        const fullDir = path.join(this.options.localDir, dir);
        if (!fs.existsSync(fullDir)) {
            return files;
        }
        const entries = fs.readdirSync(fullDir);
        for (const entry of entries) {
            const fullPath = path.join(fullDir, entry);
            const relativePath = dir ? path.posix.join(dir, entry) : entry;
            const stats = fs.statSync(fullPath);
            if (this.shouldIgnoreFile(relativePath, fullPath)) {
                continue;
            }
            if (stats.isFile()) {
                files.set(relativePath, {
                    path: fullPath,
                    mtime: stats.mtimeMs,
                });
            }
            else if (stats.isDirectory()) {
                const subdirFiles = await this.getLocalFileListWithMtimes(relativePath);
                for (const [subPath, fileInfo] of subdirFiles) {
                    files.set(subPath, fileInfo);
                }
            }
        }
        return files;
    }
    async getLocalFileList(dir = '') {
        const files = new Map();
        const fullDir = path.join(this.options.localDir, dir);
        if (!fs.existsSync(fullDir)) {
            return files;
        }
        const entries = fs.readdirSync(fullDir);
        for (const entry of entries) {
            const fullPath = path.join(fullDir, entry);
            const relativePath = dir ? path.posix.join(dir, entry) : entry;
            const stats = fs.statSync(fullPath);
            if (this.shouldIgnoreFile(relativePath, fullPath)) {
                continue;
            }
            if (stats.isFile()) {
                files.set(relativePath, fullPath);
            }
            else if (stats.isDirectory()) {
                const subdirFiles = await this.getLocalFileList(relativePath);
                for (const [subPath, fullSubPath] of subdirFiles) {
                    files.set(subPath, fullSubPath);
                }
            }
        }
        return files;
    }
    async uploadFile(relativePath, localPath) {
        console.log(`Uploading: ${relativePath}`);
        if (this.options.dryRun) {
            console.log(`[DRY RUN] Would upload ${relativePath}`);
            return;
        }
        const content = fs.readFileSync(localPath, 'utf8');
        const url = this.buildFileUrl(relativePath);
        const jwt = await this.realmAuthClient.getJWT();
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=UTF-8',
                Authorization: jwt,
                Accept: SupportedMimeType.CardSource,
            },
            body: content,
        });
        if (!response.ok) {
            throw new Error(`Failed to upload: ${response.status} ${response.statusText}`);
        }
        console.log(`  Uploaded: ${relativePath}`);
    }
    async downloadFile(relativePath, localPath) {
        console.log(`Downloading: ${relativePath}`);
        if (this.options.dryRun) {
            console.log(`[DRY RUN] Would download ${relativePath}`);
            return;
        }
        const url = this.buildFileUrl(relativePath);
        const jwt = await this.realmAuthClient.getJWT();
        // Use appropriate Accept header based on file type
        const acceptHeader = relativePath.endsWith('.json')
            ? SupportedMimeType.CardJson
            : relativePath.endsWith('.gts')
                ? SupportedMimeType.CardSource
                : '*/*';
        const response = await fetch(url, {
            headers: {
                Authorization: jwt,
                Accept: acceptHeader,
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
        }
        const content = await response.text();
        const localDir = path.dirname(localPath);
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }
        fs.writeFileSync(localPath, content, 'utf8');
        console.log(`  Downloaded: ${relativePath}`);
    }
    async deleteFile(relativePath) {
        console.log(`Deleting remote: ${relativePath}`);
        if (this.options.dryRun) {
            console.log(`[DRY RUN] Would delete ${relativePath}`);
            return;
        }
        const url = this.buildFileUrl(relativePath);
        const jwt = await this.realmAuthClient.getJWT();
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                Authorization: jwt,
                Accept: SupportedMimeType.CardSource,
            },
        });
        if (!response.ok && response.status !== 404) {
            throw new Error(`Failed to delete: ${response.status} ${response.statusText}`);
        }
        console.log(`  Deleted: ${relativePath}`);
    }
    async deleteLocalFile(localPath) {
        console.log(`Deleting local: ${localPath}`);
        if (this.options.dryRun) {
            console.log(`[DRY RUN] Would delete local file ${localPath}`);
            return;
        }
        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
            console.log(`  Deleted: ${localPath}`);
        }
    }
    getIgnoreInstance(dirPath) {
        if (this.ignoreCache.has(dirPath)) {
            return this.ignoreCache.get(dirPath);
        }
        const ig = ignore();
        let currentPath = dirPath;
        const rootPath = this.options.localDir;
        while (currentPath.startsWith(rootPath)) {
            const gitignorePath = path.join(currentPath, '.gitignore');
            if (fs.existsSync(gitignorePath)) {
                try {
                    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
                    ig.add(gitignoreContent);
                }
                catch (error) {
                    console.warn(`Warning: Could not read .gitignore file at ${gitignorePath}:`, error);
                }
            }
            const boxelignorePath = path.join(currentPath, '.boxelignore');
            if (fs.existsSync(boxelignorePath)) {
                try {
                    const boxelignoreContent = fs.readFileSync(boxelignorePath, 'utf8');
                    ig.add(boxelignoreContent);
                }
                catch (error) {
                    console.warn(`Warning: Could not read .boxelignore file at ${boxelignorePath}:`, error);
                }
            }
            const parentPath = path.dirname(currentPath);
            if (parentPath === currentPath)
                break;
            currentPath = parentPath;
        }
        this.ignoreCache.set(dirPath, ig);
        return ig;
    }
    shouldIgnoreFile(relativePath, fullPath) {
        const fileName = path.basename(relativePath);
        // Always ignore the sync manifest
        if (fileName === '.boxel-sync.json') {
            return true;
        }
        if (fileName.startsWith('.')) {
            if (fileName === '.realm.json') {
                return false;
            }
            return true;
        }
        const dirPath = path.dirname(fullPath);
        const ig = this.getIgnoreInstance(dirPath);
        const normalizedPath = relativePath.replace(/\\/g, '/');
        return ig.ignores(normalizedPath);
    }
    shouldIgnoreRemoteFile(relativePath) {
        const fileName = path.basename(relativePath);
        if (fileName.startsWith('.')) {
            if (fileName === '.realm.json') {
                return false;
            }
            return true;
        }
        return false;
    }
}
function deriveRealmUsername(workspaceUrl) {
    let url;
    try {
        url = new URL(workspaceUrl);
    }
    catch {
        throw new Error(`Invalid workspace URL: ${workspaceUrl}`);
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
        throw new Error(`Cannot derive realm username from workspace URL (${workspaceUrl}). Please provide MATRIX_USERNAME`);
    }
    if (segments[0] === 'published') {
        if (!segments[1]) {
            throw new Error(`Cannot derive published realm username from workspace URL (${workspaceUrl}). Missing published realm id.`);
        }
        return `realm/published_${segments[1]}`;
    }
    if (segments.length >= 2) {
        return `realm/${segments[0]}_${segments[1]}`;
    }
    return `${segments[0]}_realm`;
}
export async function validateMatrixEnvVars(workspaceUrl) {
    // Try profile manager first
    const { getProfileManager } = await import('./profile-manager.js');
    const profileManager = getProfileManager();
    const credentials = await profileManager.getActiveCredentials();
    if (credentials) {
        return {
            matrixUrl: credentials.matrixUrl,
            username: credentials.username,
            password: credentials.password,
        };
    }
    // Fall back to environment variables
    const matrixUrl = process.env.MATRIX_URL;
    const envUsername = process.env.MATRIX_USERNAME;
    let password = process.env.MATRIX_PASSWORD;
    const realmSecret = process.env.REALM_SECRET_SEED;
    let username = envUsername;
    if (!matrixUrl) {
        console.error('MATRIX_URL environment variable is required');
        console.error('Or run "boxel profile add" to create a profile.');
        process.exit(1);
    }
    if (!username) {
        if (!realmSecret) {
            console.error('Either MATRIX_USERNAME or REALM_SECRET_SEED environment variable is required');
            process.exit(1);
        }
        username = deriveRealmUsername(workspaceUrl);
        console.log(`Derived realm Matrix username '${username}' from workspace URL using REALM_SECRET_SEED`);
    }
    if (!password && realmSecret) {
        password = await passwordFromSeed(username, realmSecret);
        console.log('Generated password from REALM_SECRET_SEED for realm user authentication');
    }
    if (!password) {
        console.error('Either MATRIX_PASSWORD or REALM_SECRET_SEED environment variable is required');
        process.exit(1);
    }
    return { matrixUrl, username, password };
}
//# sourceMappingURL=realm-sync-base.js.map