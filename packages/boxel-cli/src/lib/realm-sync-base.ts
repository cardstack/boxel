import type { ProfileManager } from './profile-manager';
import * as fs from 'fs';
import * as path from 'path';
import ignoreModule from 'ignore';

const ignore = (ignoreModule as any).default || ignoreModule;
type Ignore = ReturnType<typeof ignoreModule>;

// Files that must never be pushed, deleted, or overwritten on the server via CLI.
export const PROTECTED_FILES = new Set(['.realm.json']);

export function isProtectedFile(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return PROTECTED_FILES.has(normalizedPath);
}

export const SupportedMimeType = {
  CardSource: 'application/vnd.card+source',
  DirectoryListing: 'application/vnd.api+json',
  Mtimes: 'application/vnd.api+json',
} as const;

export interface SyncOptions {
  realmUrl: string;
  localDir: string;
  dryRun?: boolean;
}

export abstract class RealmSyncBase {
  protected normalizedRealmUrl: string;
  private ignoreCache = new Map<string, Ignore>();

  constructor(
    protected options: SyncOptions,
    protected profileManager: ProfileManager,
  ) {
    this.normalizedRealmUrl = this.normalizeRealmUrl(options.realmUrl);
  }

  private normalizeRealmUrl(url: string): string {
    try {
      const urlObj = new URL(url);

      const pathPart = urlObj.pathname;
      const lastSegment = pathPart.split('/').filter(Boolean).pop() || '';

      if (lastSegment.includes('.')) {
        console.warn(
          `Warning: "${url}" looks like a file URL, not a realm URL.` +
            `\n   Realm URLs should point to a directory (e.g., ${urlObj.origin}${pathPart.replace(/\/[^/]*\.[^/]*$/, '/')})`,
        );
      } else if (!url.endsWith('/')) {
        console.warn(
          `Warning: Realm URL should end with a trailing slash.` +
            `\n   Did you mean "${url}/"?`,
        );
      }

      return urlObj.href.replace(/\/+$/, '') + '/';
    } catch {
      throw new Error(`Invalid workspace URL: ${url}`);
    }
  }

  protected buildDirectoryUrl(dir = ''): string {
    if (!dir) {
      return this.normalizedRealmUrl;
    }
    const cleanDir = dir.replace(/^\/+|\/+$/g, '');
    return `${this.normalizedRealmUrl}${cleanDir}/`;
  }

  protected buildFileUrl(relativePath: string): string {
    const cleanPath = relativePath.replace(/^\/+/, '');
    return `${this.normalizedRealmUrl}${cleanPath}`;
  }

  protected async getRemoteFileList(dir = ''): Promise<Map<string, boolean>> {
    const files = new Map<string, boolean>();

    try {
      const url = this.buildDirectoryUrl(dir);

      const response = await this.profileManager.authedRealmFetch(url, {
        headers: {
          Accept: 'application/vnd.api+json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return files;
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
          const entryPath = dir ? path.posix.join(dir, name) : name;

          if (isFile) {
            if (!this.shouldIgnoreRemoteFile(entryPath)) {
              files.set(entryPath, true);
            }
          } else {
            const subdirFiles = await this.getRemoteFileList(entryPath);
            for (const [subPath, isFileEntry] of subdirFiles) {
              files.set(subPath, isFileEntry);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes('Authentication failed') ||
          error.message.includes('Cannot access workspace') ||
          error.message.includes('401') ||
          error.message.includes('403')
        ) {
          throw error;
        }
      }
      console.error(`Error reading remote directory ${dir}:`, error);
      throw error;
    }

    return files;
  }

  protected async getRemoteMtimes(): Promise<Map<string, number>> {
    const mtimes = new Map<string, number>();

    try {
      const url = `${this.normalizedRealmUrl}_mtimes`;

      const response = await this.profileManager.authedRealmFetch(url, {
        headers: {
          Accept: SupportedMimeType.Mtimes,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log(
            'Note: _mtimes endpoint not available, will upload all files',
          );
          return mtimes;
        }
        throw new Error(
          `Failed to get mtimes: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        data?: {
          attributes?: {
            mtimes?: Record<string, number>;
          };
        };
      };

      if (data.data?.attributes?.mtimes) {
        const remoteMtimeEntries = Object.entries(data.data.attributes.mtimes);
        if (process.env.DEBUG) {
          console.log(
            `Remote mtimes received: ${remoteMtimeEntries.length} entries`,
          );
          if (remoteMtimeEntries.length > 0) {
            console.log(
              `Sample: ${remoteMtimeEntries[0][0]} = ${remoteMtimeEntries[0][1]}`,
            );
          }
        }
        for (const [fileUrl, mtime] of remoteMtimeEntries) {
          const relativePath = fileUrl.replace(this.normalizedRealmUrl, '');
          if (!this.shouldIgnoreRemoteFile(relativePath)) {
            mtimes.set(relativePath, mtime);
          }
        }
      } else if (process.env.DEBUG) {
        console.log(
          'No mtimes in response:',
          JSON.stringify(data).slice(0, 200),
        );
      }
    } catch (error) {
      console.warn(
        'Could not fetch remote mtimes, will upload all files:',
        error,
      );
    }

    return mtimes;
  }

  protected async getLocalFileListWithMtimes(
    dir = '',
  ): Promise<Map<string, { path: string; mtime: number }>> {
    const files = new Map<string, { path: string; mtime: number }>();
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
      } else if (stats.isDirectory()) {
        const subdirFiles = await this.getLocalFileListWithMtimes(relativePath);
        for (const [subPath, fileInfo] of subdirFiles) {
          files.set(subPath, fileInfo);
        }
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
      const relativePath = dir ? path.posix.join(dir, entry) : entry;
      const stats = fs.statSync(fullPath);

      if (this.shouldIgnoreFile(relativePath, fullPath)) {
        continue;
      }

      if (stats.isFile()) {
        files.set(relativePath, fullPath);
      } else if (stats.isDirectory()) {
        const subdirFiles = await this.getLocalFileList(relativePath);
        for (const [subPath, fullSubPath] of subdirFiles) {
          files.set(subPath, fullSubPath);
        }
      }
    }

    return files;
  }

  protected async uploadFile(
    relativePath: string,
    localPath: string,
  ): Promise<void> {
    if (isProtectedFile(relativePath)) {
      console.log(`  Skipped (protected): ${relativePath}`);
      return;
    }

    console.log(`Uploading: ${relativePath}`);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would upload ${relativePath}`);
      return;
    }

    const content = fs.readFileSync(localPath, 'utf8');
    const url = this.buildFileUrl(relativePath);

    const response = await this.profileManager.authedRealmFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        Accept: SupportedMimeType.CardSource,
      },
      body: content,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to upload: ${response.status} ${response.statusText}`,
      );
    }

    console.log(`  Uploaded: ${relativePath}`);
  }

  protected async downloadFile(
    relativePath: string,
    localPath: string,
  ): Promise<void> {
    console.log(`Downloading: ${relativePath}`);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would download ${relativePath}`);
      return;
    }

    const url = this.buildFileUrl(relativePath);

    const response = await this.profileManager.authedRealmFetch(url, {
      headers: {
        Accept: SupportedMimeType.CardSource,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to download: ${response.status} ${response.statusText}`,
      );
    }

    const content = await response.text();

    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    fs.writeFileSync(localPath, content, 'utf8');
    console.log(`  Downloaded: ${relativePath}`);
  }

  protected async deleteFile(relativePath: string): Promise<void> {
    if (isProtectedFile(relativePath)) {
      console.log(`  Skipped (protected): ${relativePath}`);
      return;
    }

    console.log(`Deleting remote: ${relativePath}`);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would delete ${relativePath}`);
      return;
    }

    const url = this.buildFileUrl(relativePath);

    const response = await this.profileManager.authedRealmFetch(url, {
      method: 'DELETE',
      headers: {
        Accept: SupportedMimeType.CardSource,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to delete: ${response.status} ${response.statusText}`,
      );
    }

    console.log(`  Deleted: ${relativePath}`);
  }

  protected async deleteLocalFile(localPath: string): Promise<void> {
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

  private getIgnoreInstance(dirPath: string): Ignore {
    if (this.ignoreCache.has(dirPath)) {
      return this.ignoreCache.get(dirPath)!;
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
        } catch (error) {
          console.warn(
            `Warning: Could not read .gitignore file at ${gitignorePath}:`,
            error,
          );
        }
      }

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

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) break;
      currentPath = parentPath;
    }

    this.ignoreCache.set(dirPath, ig);
    return ig;
  }

  private shouldIgnoreFile(relativePath: string, fullPath: string): boolean {
    const fileName = path.basename(relativePath);

    if (fileName === '.boxel-sync.json') {
      return true;
    }

    if (fileName.startsWith('.')) {
      return true;
    }

    const dirPath = path.dirname(fullPath);
    const ig = this.getIgnoreInstance(dirPath);
    const normalizedPath = relativePath.replace(/\\/g, '/');

    return ig.ignores(normalizedPath);
  }

  private shouldIgnoreRemoteFile(relativePath: string): boolean {
    const fileName = path.basename(relativePath);
    if (fileName.startsWith('.')) {
      return true;
    }
    return false;
  }

  abstract sync(): Promise<void>;
}
