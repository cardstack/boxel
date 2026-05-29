import type { RealmAuthenticator } from './realm-authenticator';
import * as fs from 'fs/promises';
import * as path from 'path';
import ignoreModule from 'ignore';
import pLimit from 'p-limit';
import { isBinaryFilename } from '@cardstack/runtime-common/infer-content-type';

const ignore = (ignoreModule as any).default || ignoreModule;
type Ignore = ReturnType<typeof ignoreModule>;

// Files that must never be pushed, deleted, or overwritten on the server via CLI.
// The `realm.json` RealmConfig card is intentionally NOT protected — `boxel
// realm push/sync` is the supported way to manage it. The set is empty; it
// stays an exported helper so a protected file can be added without a
// fan-out edit through every command.
export const PROTECTED_FILES = new Set<string>([]);
const DELETE_TIMEOUT_MS = 10_000;
const DELETE_TIMEOUT_PROBE_MS = 3_000;

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

/**
 * Decode an `atomic:results` `data.id` (or any href the realm echoes
 * back with URL-encoded path segments). Used so paths that contain
 * spaces or other characters that get percent-encoded on the wire
 * round-trip to the same relative path the local listing uses.
 * Falls back to the raw value on a malformed escape so a single bad
 * entry can't kill the whole sync.
 */
function decodeAtomicResultId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

// Builds a structured upload error: the message embeds the response
// status + statusText + a snippet of the response body (the realm
// returns useful detail there — size limits, missing scopes, etc.),
// and a `status` property is attached so the batch helper can route
// the failure without re-parsing the message.
async function throwUploadError(
  response: Response,
  relativePath: string,
): Promise<never> {
  const bodyText = await response.text().catch(() => '');
  const message = `Failed to upload ${relativePath}: ${response.status} ${response.statusText}${
    bodyText ? ` — ${bodyText.slice(0, 200)}` : ''
  }`;
  const err = new Error(message) as Error & {
    status?: number;
    body?: string;
  };
  err.status = response.status;
  err.body = bodyText;
  throw err;
}

// Shared shape for per-file upload errors that need to bubble back to
// callers (push.ts / sync.ts) so they can format hints and decide which
// successes to persist alongside the failures.
type UploadFailure = { path: string; status: number; title: string };

export const SupportedMimeType = {
  CardSource: 'application/vnd.card+source',
  DirectoryListing: 'application/vnd.api+json',
  Mtimes: 'application/vnd.api+json',
  OctetStream: 'application/octet-stream',
} as const;

export interface SyncOptions {
  realmUrl: string;
  localDir: string;
  dryRun?: boolean;
  /**
   * Append `?waitForIndex=true` to the `_atomic` POST so the realm-server
   * returns only after the indexer has processed the batch. The
   * `_atomic` handler hardcoded `waitForIndex: false` after CS-11003
   * PR 2 (deferred `+source` POST), so callers that read indexed state
   * (search / list) immediately after a sync race the indexer. Off by
   * default.
   */
  waitForIndex?: boolean;
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

      const response = await this.remoteLimit(() =>
        this.authenticator.authedRealmFetch(url, {
          headers: {
            Accept: 'application/vnd.api+json',
          },
        }),
      );

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
              return (async () => {
                const subdirFiles = await this.getRemoteFileList(entryPath);
                return Array.from(subdirFiles.entries());
              })();
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
          const rawRelativePath = fileUrl.replace(this.normalizedRealmUrl, '');
          // Realm `_mtimes` keys are URL-encoded (e.g. spaces → %20).
          // The local file listing uses decoded paths
          // (`Knowledge Articles/foo.json`), so leaving the remote
          // form encoded makes the diff treat the encoded and decoded
          // variants as two separate files — sync then "downloads"
          // the remote copy alongside the existing local one and
          // duplicates the workspace.
          let relativePath: string;
          try {
            relativePath = decodeURIComponent(rawRelativePath);
          } catch {
            // Malformed percent escape — fall back to the raw value
            // so a single bad entry doesn't kill the whole sync.
            relativePath = rawRelativePath;
          }
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

    if (isBinaryFilename(relativePath)) {
      await this.uploadBinaryFile(relativePath, localPath);
      console.log(`  Uploaded: ${relativePath}`);
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
      await throwUploadError(response, relativePath);
    }

    console.log(`  Uploaded: ${relativePath}`);
  }

  // Uploads a single binary file (PNG, PDF, font, etc.) per the host
  // pattern: a per-file POST with Content-Type: application/octet-stream
  // and the raw bytes as the body. The realm-server routes octet-stream
  // POSTs to upsertBinaryFile, which writes the bytes verbatim without
  // any string conversion. Used by both uploadFile (single-shot) and
  // uploadFilesAtomic (mixed-batch fallback for the binary entries it
  // splits out of the atomic JSON payload).
  protected async uploadBinaryFile(
    relativePath: string,
    localPath: string,
  ): Promise<void> {
    const bytes = await fs.readFile(localPath);
    const url = this.buildFileUrl(relativePath);

    const response = await this.authenticator.authedRealmFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': SupportedMimeType.OctetStream,
      },
      body: bytes,
    });

    if (!response.ok) {
      await throwUploadError(response, relativePath);
    }
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
      perFile: UploadFailure[];
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

    // The /_atomic endpoint embeds each file's content inside a JSON
    // `attributes.content` string, which can't carry raw binary bytes.
    // Match the host pattern: keep /_atomic for text files only, and
    // for each binary file fall back to a per-file octet-stream POST
    // (the same wire format `uploadBinaryFile` uses for a single binary).
    // The two batches run concurrently — neither helper rejects, so the
    // outer Promise.all just joins their structured results.
    const textEntries: Array<[string, string]> = [];
    const binaryEntries: Array<[string, string]> = [];
    for (const entry of entries) {
      if (isBinaryFilename(entry[0])) {
        binaryEntries.push(entry);
      } else {
        textEntries.push(entry);
      }
    }

    const [binaryOutcome, textOutcome] = await Promise.all([
      this.uploadBinaryBatch(binaryEntries),
      this.uploadTextAtomic(textEntries, addPaths),
    ]);

    const succeeded = [...textOutcome.succeeded, ...binaryOutcome.succeeded];

    if (textOutcome.fatal) {
      return {
        succeeded,
        error: {
          status: textOutcome.fatal.status,
          perFile: [...textOutcome.failed, ...binaryOutcome.failed],
          message: textOutcome.fatal.message,
        },
      };
    }

    if (binaryOutcome.failed.length > 0) {
      return {
        succeeded,
        error: {
          status: binaryOutcome.failed[0].status,
          perFile: binaryOutcome.failed,
          message: `Binary upload failed for ${binaryOutcome.failed.length} file(s)`,
        },
      };
    }

    return { succeeded };
  }

  // Fan out the per-file octet-stream POSTs for the binary slice of an
  // atomic batch. Each upload is wrapped in try/catch so a single failure
  // is folded into the result instead of rejecting the fan-out;
  // Promise.allSettled is used at the boundary as defense-in-depth so a
  // future change that drops the inner catch still surfaces a structured
  // failure rather than silently aborting other in-flight uploads.
  private async uploadBinaryBatch(
    binaryEntries: Array<[string, string]>,
  ): Promise<{ succeeded: string[]; failed: UploadFailure[] }> {
    if (binaryEntries.length === 0) {
      return { succeeded: [], failed: [] };
    }

    const settled = await Promise.allSettled(
      binaryEntries.map(([relativePath, localPath]) =>
        this.remoteLimit(async () => {
          try {
            await this.uploadBinaryFile(relativePath, localPath);
            console.log(`  Uploaded: ${relativePath}`);
            return { relativePath, ok: true as const };
          } catch (err) {
            const errWithStatus = err as { status?: number };
            const status =
              typeof errWithStatus?.status === 'number'
                ? errWithStatus.status
                : 500;
            const title = err instanceof Error ? err.message : String(err);
            return {
              relativePath,
              ok: false as const,
              status,
              title,
            };
          }
        }),
      ),
    );

    const succeeded: string[] = [];
    const failed: UploadFailure[] = [];
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        if (outcome.value.ok) {
          succeeded.push(outcome.value.relativePath);
        } else {
          failed.push({
            path: outcome.value.relativePath,
            status: outcome.value.status,
            title: outcome.value.title,
          });
        }
      } else {
        failed.push({
          path: binaryEntries[i][0],
          status: 500,
          title: String(outcome.reason),
        });
      }
    }

    return { succeeded, failed };
  }

  // POST the text slice of a mixed batch to /_atomic and decode the
  // result. `fatal` is set when the server rejected the whole batch
  // (non-201) — callers map that to a top-level error message; `failed`
  // carries the per-operation errors the server returned alongside.
  private async uploadTextAtomic(
    textEntries: Array<[string, string]>,
    addPaths: Set<string>,
  ): Promise<{
    succeeded: string[];
    failed: UploadFailure[];
    fatal?: { status: number; message: string };
  }> {
    if (textEntries.length === 0) {
      return { succeeded: [], failed: [] };
    }

    const operations = await Promise.all(
      textEntries.map(async ([relativePath, localPath]) => {
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

    const url = this.options.waitForIndex
      ? `${this.normalizedRealmUrl}_atomic?waitForIndex=true`
      : `${this.normalizedRealmUrl}_atomic`;
    const response = await this.authenticator.authedRealmFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      body: JSON.stringify({ 'atomic:operations': operations }),
    });

    const hrefToRelative = new Map(
      textEntries.map(([rel]) => [this.buildFileUrl(rel), rel]),
    );

    if (response.status === 201) {
      const body = (await response.json()) as {
        'atomic:results'?: Array<{ data?: { id?: string } }>;
      };
      // The realm normalizes hrefs: a path with a space goes out as
      // `Knowledge Articles/...` but comes back URL-encoded as
      // `Knowledge%20Articles/...`. Decode the response id before the
      // map lookup so we resolve back to the original relative path
      // instead of falling through to the raw encoded URL.
      const atomicSucceeded = (body['atomic:results'] ?? [])
        .map((r) => r.data?.id)
        .filter((id): id is string => typeof id === 'string')
        .map((id) => decodeAtomicResultId(id))
        .map((id) => hrefToRelative.get(id) ?? id);
      for (const rel of atomicSucceeded) {
        console.log(`  Uploaded: ${rel}`);
      }
      return { succeeded: atomicSucceeded, failed: [] };
    }

    let errorBody: {
      errors?: Array<{ title?: string; detail?: string; status?: number }>;
    } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // ignore JSON parse failures — fall through to the generic message
    }

    const failed: UploadFailure[] = (errorBody.errors ?? []).map((e) => {
      const detail = e.detail ?? '';
      const match = detail.match(/Resource (\S+) /);
      const href = match ? decodeAtomicResultId(match[1]) : '';
      return {
        path: hrefToRelative.get(href) ?? href,
        status: e.status ?? response.status,
        title: e.title ?? 'Error',
      };
    });

    return {
      succeeded: [],
      failed,
      fatal: {
        status: response.status,
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

    const localDir = path.dirname(localPath);
    await fs.mkdir(localDir, { recursive: true });

    if (isBinaryFilename(relativePath)) {
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(localPath, buffer);
    } else {
      const content = await response.text();
      await fs.writeFile(localPath, content, 'utf8');
    }
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
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.authenticator.authedRealmFetch(url, {
        method: 'DELETE',
        headers: {
          Accept: SupportedMimeType.CardSource,
        },
        signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
      });
    } catch (error) {
      let elapsedMs = Date.now() - startedAt;
      console.error(
        `  Delete request failed after ${elapsedMs}ms: ${relativePath}`,
      );
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        let deleteApplied = await this.verifyDeleteApplied(relativePath);
        if (deleteApplied === true) {
          console.warn(
            `  Delete response timed out after ${DELETE_TIMEOUT_MS}ms, but ${relativePath} is already gone on the realm; continuing`,
          );
          return;
        }
        throw new Error(
          `Timed out deleting ${relativePath} after ${DELETE_TIMEOUT_MS}ms`,
          { cause: error },
        );
      }
      throw error;
    }

    let elapsedMs = Date.now() - startedAt;
    console.log(
      `  Delete response for ${relativePath}: ${response.status} ${response.statusText} (${elapsedMs}ms)`,
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to delete: ${response.status} ${response.statusText}`,
      );
    }

    console.log(`  Deleted: ${relativePath}`);
  }

  private async verifyDeleteApplied(
    relativePath: string,
  ): Promise<boolean | 'unknown'> {
    const url = this.buildFileUrl(relativePath);
    try {
      const response = await this.authenticator.authedRealmFetch(url, {
        headers: {
          Accept: SupportedMimeType.CardSource,
        },
        signal: AbortSignal.timeout(DELETE_TIMEOUT_PROBE_MS),
      });
      console.warn(
        `  Delete-timeout probe for ${relativePath}: ${response.status} ${response.statusText}`,
      );
      return response.status === 404 ? true : false;
    } catch (probeError) {
      console.warn(
        `  Delete-timeout probe failed for ${relativePath}:`,
        probeError,
      );
      return 'unknown';
    }
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
