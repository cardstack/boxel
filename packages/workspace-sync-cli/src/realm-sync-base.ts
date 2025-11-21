import {
  MatrixClient,
  passwordFromSeed,
} from '@cardstack/runtime-common/matrix-client';
import { RealmAuthClient } from '@cardstack/runtime-common/realm-auth-client';
import * as fs from 'fs';
import * as path from 'path';
import { SupportedMimeType } from '@cardstack/runtime-common/router';
import ignore, { type Ignore } from 'ignore';

export interface SyncOptions {
  workspaceUrl: string;
  localDir: string;
  dryRun?: boolean;
}

export abstract class RealmSyncBase {
  protected matrixClient: MatrixClient;
  protected realmAuthClient: RealmAuthClient;
  protected normalizedRealmUrl: string;
  private ignoreCache = new Map<string, Ignore>();

  constructor(
    protected options: SyncOptions,
    matrixUrl: string,
    username: string,
    password: string,
  ) {
    this.matrixClient = new MatrixClient({
      matrixURL: new URL(matrixUrl),
      username,
      password,
    });

    // Normalize the realm URL once at construction
    this.normalizedRealmUrl = this.normalizeRealmUrl(options.workspaceUrl);

    this.realmAuthClient = new RealmAuthClient(
      new URL(this.normalizedRealmUrl),
      this.matrixClient,
      globalThis.fetch,
    );
  }

  async initialize() {
    console.log('Logging into Matrix...');
    await this.matrixClient.login();
    console.log('Matrix login successful');
  }

  private normalizeRealmUrl(url: string): string {
    // Ensure the workspace URL is properly formatted
    try {
      const urlObj = new URL(url);
      // Ensure it ends with a single slash for consistency
      return urlObj.href.replace(/\/+$/, '') + '/';
    } catch (error) {
      throw new Error(`Invalid workspace URL: ${url}`);
    }
  }

  protected buildDirectoryUrl(dir: string = ''): string {
    // For directory listings, we need trailing slashes
    if (!dir) {
      return this.normalizedRealmUrl; // Already has trailing slash
    }

    // Remove leading/trailing slashes from dir and add trailing slash
    const cleanDir = dir.replace(/^\/+|\/+$/g, '');
    return `${this.normalizedRealmUrl}${cleanDir}/`;
  }

  protected buildFileUrl(relativePath: string): string {
    // For file operations, we don't want trailing slashes
    const cleanPath = relativePath.replace(/^\/+/, ''); // Remove leading slashes only
    return `${this.normalizedRealmUrl}${cleanPath}`;
  }

  protected async getRemoteFileList(dir = ''): Promise<Map<string, boolean>> {
    const files = new Map<string, boolean>();

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
          return files; // Directory doesn't exist, return empty
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Authentication failed (${response.status}): Cannot access workspace. Check your Matrix credentials and workspace permissions.`,
          );
        }
        throw new Error(
          `Failed to get directory listing: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        data?: {
          relationships?: Record<string, { meta: { kind: string } }>;
        };
      };

      if (data.data && data.data.relationships) {
        for (const [name, info] of Object.entries(data.data.relationships)) {
          const entry = info as { meta: { kind: string } };
          const isFile = entry.meta.kind === 'file';

          // Use path.posix.join for consistent forward slashes in URLs
          const entryPath = dir ? path.posix.join(dir, name) : name;

          if (isFile) {
            // Apply the same filtering logic as local files
            if (!this.shouldIgnoreRemoteFile(entryPath)) {
              files.set(entryPath, true);
            }
          } else {
            // Recursively get subdirectory files
            const subdirFiles = await this.getRemoteFileList(entryPath);
            for (const [subPath, isFileEntry] of subdirFiles) {
              files.set(subPath, isFileEntry);
            }
          }
        }
      }
    } catch (error) {
      // Re-throw authentication and other critical errors instead of silently failing
      if (error instanceof Error) {
        if (
          error.message.includes('Authentication failed') ||
          error.message.includes('Cannot access workspace') ||
          error.message.includes('401') ||
          error.message.includes('403')
        ) {
          throw error; // Don't catch auth failures - let them bubble up
        }
      }
      console.error(`Error reading remote directory ${dir}:`, error);
      throw error; // Re-throw other errors too - don't silently continue
    }

    // Special case: Check for .realm.json in the root directory
    // The realm server doesn't include dotfiles in directory listings but serves them directly
    if (!dir) {
      // Only check in root directory
      try {
        const realmJsonUrl = this.buildFileUrl('.realm.json');
        const jwt = await this.realmAuthClient.getJWT();

        const response = await fetch(realmJsonUrl, {
          method: 'HEAD', // Just check if it exists
          headers: {
            Authorization: jwt,
          },
        });

        if (response.ok) {
          files.set('.realm.json', true);
        }
      } catch (error) {
        // .realm.json doesn't exist or can't be accessed, which is fine
        console.log('Note: .realm.json not found in remote realm');
      }
    }

    return files;
  }

  protected async getLocalFileList(dir = ''): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const fullDir = path.join(this.options.localDir, dir);

    if (!fs.existsSync(fullDir)) {
      return files;
    }

    const entries = fs.readdirSync(fullDir);

    for (const entry of entries) {
      const fullPath = path.join(fullDir, entry);
      // Use path.posix.join for consistent forward slashes (URLs use forward slashes)
      const relativePath = dir ? path.posix.join(dir, entry) : entry;
      const stats = fs.statSync(fullPath);

      // Apply filtering for dotfiles and gitignore patterns
      if (this.shouldIgnoreFile(relativePath, fullPath)) {
        continue;
      }

      if (stats.isFile()) {
        files.set(relativePath, fullPath);
      } else if (stats.isDirectory()) {
        // Recursively get subdirectory files
        const subdirFiles = await this.getLocalFileList(relativePath);
        for (const [subPath, fullSubPath] of subdirFiles) {
          files.set(subPath, fullSubPath);
        }
      }
    }

    return files;
  }

  protected async uploadFile(relativePath: string, localPath: string) {
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
      throw new Error(
        `Failed to upload: ${response.status} ${response.statusText}`,
      );
    }

    console.log(`✓ Uploaded: ${relativePath}`);
  }

  protected async downloadFile(relativePath: string, localPath: string) {
    console.log(`Downloading: ${relativePath}`);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would download ${relativePath}`);
      return;
    }

    const url = this.buildFileUrl(relativePath);
    const jwt = await this.realmAuthClient.getJWT();

    const response = await fetch(url, {
      headers: {
        Authorization: jwt,
        Accept: SupportedMimeType.CardSource,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to download: ${response.status} ${response.statusText}`,
      );
    }

    const content = await response.text();

    // Ensure directory exists
    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    fs.writeFileSync(localPath, content, 'utf8');
    console.log(`✓ Downloaded: ${relativePath}`);
  }

  protected async deleteFile(relativePath: string) {
    console.log(`Deleting: ${relativePath}`);

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
      throw new Error(
        `Failed to delete: ${response.status} ${response.statusText}`,
      );
    }

    console.log(`✓ Deleted: ${relativePath}`);
  }

  protected async deleteLocalFile(localPath: string) {
    console.log(`Deleting local file: ${localPath}`);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would delete local file ${localPath}`);
      return;
    }

    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      console.log(`✓ Deleted local file: ${localPath}`);
    }
  }

  private getIgnoreInstance(dirPath: string): Ignore {
    if (this.ignoreCache.has(dirPath)) {
      return this.ignoreCache.get(dirPath)!;
    }

    const ig = ignore();

    // Find all .gitignore and .boxelignore files in the path hierarchy
    let currentPath = dirPath;
    const rootPath = this.options.localDir;

    while (currentPath.startsWith(rootPath)) {
      // Check for .gitignore file
      const gitignorePath = path.join(currentPath, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        try {
          const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
          ig.add(gitignoreContent);
        } catch (error) {
          console.warn(
            `Warning: Could not read .gitignore file at ${gitignorePath}:`,
            error,
          );
        }
      }

      // Check for .boxelignore file
      const boxelignorePath = path.join(currentPath, '.boxelignore');
      if (fs.existsSync(boxelignorePath)) {
        try {
          const boxelignoreContent = fs.readFileSync(boxelignorePath, 'utf8');
          ig.add(boxelignoreContent);
        } catch (error) {
          console.warn(
            `Warning: Could not read .boxelignore file at ${boxelignorePath}:`,
            error,
          );
        }
      }

      // Move up one directory
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) break; // Reached filesystem root
      currentPath = parentPath;
    }

    this.ignoreCache.set(dirPath, ig);
    return ig;
  }

  private shouldIgnoreFile(relativePath: string, fullPath: string): boolean {
    // Always ignore files that start with a dot, except for .realm.json
    const fileName = path.basename(relativePath);
    if (fileName.startsWith('.')) {
      // Exception: allow .realm.json to be synced
      if (fileName === '.realm.json') {
        return false;
      }
      return true;
    }

    // Check against gitignore patterns
    const dirPath = path.dirname(fullPath);
    const ig = this.getIgnoreInstance(dirPath);

    // Use forward slashes for ignore patterns (gitignore standard)
    const normalizedPath = relativePath.replace(/\\/g, '/');

    return ig.ignores(normalizedPath);
  }

  private shouldIgnoreRemoteFile(relativePath: string): boolean {
    // Apply the same dotfile filtering logic as local files
    const fileName = path.basename(relativePath);
    if (fileName.startsWith('.')) {
      // Exception: allow .realm.json to be synced
      if (fileName === '.realm.json') {
        return false;
      }
      return true;
    }

    // Note: We can't check gitignore patterns for remote files since we don't have
    // access to the remote .gitignore/.boxelignore files, but dotfile filtering
    // is the primary concern for security
    return false;
  }

  abstract sync(): Promise<void>;
}

function deriveRealmUsername(workspaceUrl: string): string {
  let url: URL;
  try {
    url = new URL(workspaceUrl);
  } catch (error) {
    throw new Error(`Invalid workspace URL: ${workspaceUrl}`);
  }

  let segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error(
      `Cannot derive realm username from workspace URL (${workspaceUrl}). Please provide MATRIX_USERNAME`,
    );
  }

  // Published realms live at /published/<id>/ and use realm/published_<id>
  if (segments[0] === 'published') {
    if (!segments[1]) {
      throw new Error(
        `Cannot derive published realm username from workspace URL (${workspaceUrl}). Missing published realm id.`,
      );
    }
    return `realm/published_${segments[1]}`;
  }

  // Realms created through the app live at /<owner>/<endpoint>/ and use realm/<owner>_<endpoint>
  if (segments.length >= 2) {
    return `realm/${segments[0]}_${segments[1]}`;
  }

  // Root realms like /base/, /skills/, or /experiments/ use <realm>_realm
  return `${segments[0]}_realm`;
}

export async function validateMatrixEnvVars(workspaceUrl: string): Promise<{
  matrixUrl: string;
  username: string;
  password: string;
}> {
  const matrixUrl = process.env.MATRIX_URL;
  const envUsername = process.env.MATRIX_USERNAME;
  let password = process.env.MATRIX_PASSWORD;
  const realmSecret = process.env.REALM_SECRET_SEED;
  let username = envUsername;

  if (!matrixUrl) {
    console.error('MATRIX_URL environment variable is required');
    process.exit(1);
  }

  if (!username) {
    if (!realmSecret) {
      console.error('Either MATRIX_USERNAME or REALM_SECRET_SEED environment variable is required');
      process.exit(1);
    }
    username = deriveRealmUsername(workspaceUrl);
    console.log(
      `Derived realm Matrix username '${username}' from workspace URL using REALM_SECRET_SEED`,
    );
  }

  // If password is not provided but realm secret is, generate password from secret
  if (!password && realmSecret) {
    password = await passwordFromSeed(username, realmSecret);
    console.log(
      'Generated password from REALM_SECRET_SEED for realm user authentication',
    );
  }

  if (!password) {
    console.error(
      'Either MATRIX_PASSWORD or REALM_SECRET_SEED environment variable is required',
    );
    process.exit(1);
  }

  return { matrixUrl, username, password: password! };
}
