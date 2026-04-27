import type { RealmAuthenticator } from './realm-authenticator';
import * as fs from 'fs/promises';
import * as path from 'path';
import ignoreModule from 'ignore';
import pLimit from 'p-limit';

const ignore = (ignoreModule as any).default || ignoreModule;
type Ignore = ReturnType<typeof ignoreModule>;

// Files that must never be pushed, deleted, or overwritten on the server via CLI.
export const PROTECTED_FILES = new Set(['.realm.json']);

export function isProtectedFile(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return PROTECTED_FILES.has(normalizedPath);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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

const REMOTE_CONCURRENCY = 10;

// Directories that should always be skipped during local file traversal,
// regardless of .gitignore / .boxelignore content.
const ALWAYS_IGNORED_DIRS = new Set(['node_modules']);

export abstract class RealmSyncBase {
  protected normalizedRealmUrl: string;
  private ignoreCache = new Map<string, Promise<Ignore>>();
  protected remoteLimit = pLimit(REMOTE_CONCURRENCY);

  constructor(
    protected options: SyncOptions,
    protected authenticator: RealmAuthenticator,
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

      const response = await this.authenticator.authedRealmFetch(url, {
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
        const entries = Object.entries(data.data.relationships);
        const subResults = await Promise.all(
          entries.map(([name, info]) => {
            const entry = info as { meta: { kind: string } };
            const isFile = entry.meta.kind === 'file';
            const entryPath = dir ? path.posix.join(dir, name) : name;

            if (isFile) {
              if (!this.shouldIgnoreRemoteFile(entryPath)) {
                return [[entryPath, true as boolean]] as Array<
                  [string, boolean]
                >;
              }
              return [] as Array<[string, boolean]>;
            } else {
              return this.remoteLimit(async () => {
                const subdirFiles = await this.getRemoteFileList(entryPath);
                return Array.from(subdirFiles.entries());
              });
            }
          }),
        );

        for (const pairs of subResults) {
          for (const [p, isFileEntry] of pairs) {
            files.set(p, isFileEntry);
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

      const response = await this.authenticator.authedRealmFetch(url, {
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

    let entries;
    try {
      entries = await fs.readdir(fullDir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return files;
      throw err;
    }

    const subResults = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(fullDir, entry.name);
        const relativePath = dir
          ? path.posix.join(dir, entry.name)
          : entry.name;

        if (entry.isDirectory() && ALWAYS_IGNORED_DIRS.has(entry.name)) {
          return [] as Array<[string, { path: string; mtime: number }]>;
        }

        if (await this.shouldIgnoreFile(relativePath, fullPath)) {
          return [] as Array<[string, { path: string; mtime: number }]>;
        }

        if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          return [
            [relativePath, { path: fullPath, mtime: stats.mtimeMs }],
          ] as Array<[string, { path: string; mtime: number }]>;
        } else if (entry.isDirectory()) {
          const subdirFiles =
            await this.getLocalFileListWithMtimes(relativePath);
          return Array.from(subdirFiles.entries());
        }
        return [];
      }),
    );

    for (const pairs of subResults) {
      for (const [p, info] of pairs) {
        files.set(p, info);
      }
    }

    return files;
  }

  protected async getLocalFileList(dir = ''): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const fullDir = path.join(this.options.localDir, dir);

    let entries;
    try {
      entries = await fs.readdir(fullDir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') return files;
      throw err;
    }

    const subResults = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(fullDir, entry.name);
        const relativePath = dir
          ? path.posix.join(dir, entry.name)
          : entry.name;

        if (entry.isDirectory() && ALWAYS_IGNORED_DIRS.has(entry.name)) {
          return [] as Array<[string, string]>;
        }

        if (await this.shouldIgnoreFile(relativePath, fullPath)) {
          return [] as Array<[string, string]>;
        }

        if (entry.isFile()) {
          return [[relativePath, fullPath]] as Array<[string, string]>;
        } else if (entry.isDirectory()) {
          const subdirFiles = await this.getLocalFileList(relativePath);
          return Array.from(subdirFiles.entries());
        }
        return [];
      }),
    );

    for (const pairs of subResults) {
      for (const [p, fullSubPath] of pairs) {
        files.set(p, fullSubPath);
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

    const content = await fs.readFile(localPath, 'utf8');
    const url = this.buildFileUrl(relativePath);

    const response = await this.authenticator.authedRealmFetch(url, {
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

  // Batched upload via the realm's /_atomic endpoint. Returns the set of
  // paths the server reported as written plus an optional error payload
  // when the whole batch was rejected. The atomic endpoint validates
  // every operation first (existence checks for add/update), so a 409 on
  // any `add` or a 404 on any `update` causes the whole batch to fail
  // with no side effects on the realm.
  protected async uploadFilesAtomic(
    files: Map<string, string>,
    addPaths: Set<string>,
  ): Promise<{
    succeeded: string[];
    error?: {
      status: number;
      perFile: Array<{ path: string; status: number; title: string }>;
      message: string;
    };
  }> {
    const entries = Array.from(files.entries()).filter(
      ([relativePath]) => !isProtectedFile(relativePath),
    );

    if (entries.length === 0) {
      return { succeeded: [] };
    }

    if (this.options.dryRun) {
      for (const [relativePath] of entries) {
        console.log(`[DRY RUN] Would upload ${relativePath}`);
      }
      return { succeeded: [] };
    }

    const operations = await Promise.all(
      entries.map(async ([relativePath, localPath]) => {
        const content = await fs.readFile(localPath, 'utf8');
        return {
          op: addPaths.has(relativePath)
            ? ('add' as const)
            : ('update' as const),
          href: this.buildFileUrl(relativePath),
          data: {
            type: 'source' as const,
            attributes: { content },
            meta: {},
          },
        };
      }),
    );

    const url = `${this.normalizedRealmUrl}_atomic`;
    const response = await this.authenticator.authedRealmFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify({ 'atomic:operations': operations }),
    });

    if (response.status === 201) {
      const body = (await response.json()) as {
        'atomic:results'?: Array<{ data?: { id?: string } }>;
      };
      const hrefToRelative = new Map(
        entries.map(([rel]) => [this.buildFileUrl(rel), rel]),
      );
      const succeeded = (body['atomic:results'] ?? [])
        .map((r) => r.data?.id)
        .filter((id): id is string => typeof id === 'string')
        .map((id) => hrefToRelative.get(id) ?? id);
      for (const rel of succeeded) {
        console.log(`  Uploaded: ${rel}`);
      }
      return { succeeded };
    }

    let errorBody: {
      errors?: Array<{ title?: string; detail?: string; status?: number }>;
    } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // ignore JSON parse failures — fall through to the generic message
    }

    const perFile = (errorBody.errors ?? []).map((e) => {
      const detail = e.detail ?? '';
      const match = detail.match(/Resource (\S+) /);
      const href = match ? match[1] : '';
      const relMap = new Map(
        entries.map(([rel]) => [this.buildFileUrl(rel), rel]),
      );
      return {
        path: relMap.get(href) ?? href,
        status: e.status ?? response.status,
        title: e.title ?? 'Error',
      };
    });

    return {
      succeeded: [],
      error: {
        status: response.status,
        perFile,
        message: `Atomic upload failed: ${response.status} ${response.statusText}`,
      },
    };
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

    const response = await this.authenticator.authedRealmFetch(url, {
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
    await fs.mkdir(localDir, { recursive: true });

    await fs.writeFile(localPath, content, 'utf8');
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

    const response = await this.authenticator.authedRealmFetch(url, {
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

    try {
      await fs.unlink(localPath);
      console.log(`  Deleted: ${localPath}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  private getIgnoreInstance(dirPath: string): Promise<Ignore> {
    const cached = this.ignoreCache.get(dirPath);
    if (cached) return cached;

    const build = (async () => {
      const ig = ignore();
      let currentPath = dirPath;
      const rootPath = this.options.localDir;

      while (currentPath.startsWith(rootPath)) {
        const gitignorePath = path.join(currentPath, '.gitignore');
        if (await pathExists(gitignorePath)) {
          try {
            const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
            ig.add(gitignoreContent);
          } catch (error) {
            console.warn(
              `Warning: Could not read .gitignore file at ${gitignorePath}:`,
              error,
            );
          }
        }

        const boxelignorePath = path.join(currentPath, '.boxelignore');
        if (await pathExists(boxelignorePath)) {
          try {
            const boxelignoreContent = await fs.readFile(
              boxelignorePath,
              'utf8',
            );
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

      return ig;
    })();

    this.ignoreCache.set(dirPath, build);
    return build;
  }

  private async shouldIgnoreFile(
    relativePath: string,
    fullPath: string,
  ): Promise<boolean> {
    const fileName = path.basename(relativePath);

    if (fileName === '.boxel-sync.json') {
      return true;
    }

    if (fileName.startsWith('.')) {
      return true;
    }

    const dirPath = path.dirname(fullPath);
    const ig = await this.getIgnoreInstance(dirPath);
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
