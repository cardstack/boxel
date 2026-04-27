import { deleteFile, type DeleteResult } from '../commands/file/delete';
import { read as fileRead, type ReadResult } from '../commands/file/read';
import {
  lint as coreLint,
  type LintResult,
  type LintMessage,
} from '../commands/file/lint';
import {
  listFiles as coreListFiles,
  type ListFilesResult,
} from '../commands/file/list';
import {
  readTranspiledModule,
  type ReadTranspiledResult,
} from '../commands/read-transpiled';
import { write as coreWrite, type WriteResult } from '../commands/file/write';
import {
  cancelIndexing as coreCancelIndexing,
  type CancelIndexingResult,
} from '../commands/realm/cancel-indexing';
import { createRealm as coreCreateRealm } from '../commands/realm/create';
import { pull as realmPull } from '../commands/realm/pull';
import { getProfileManager, type ProfileManager } from './profile-manager';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

export type { ReadResult, ListFilesResult, ReadTranspiledResult };

const MIME = {
  CardSource: 'application/vnd.card+source',
  CardJson: 'application/vnd.card+json',
  JSON: 'application/json',
  JSONAPI: 'application/vnd.api+json',
} as const;

export interface CreateRealmOptions {
  /** URL slug for the realm (lowercase, numbers, hyphens). */
  realmName: string;
  /** Human-readable display name. */
  displayName: string;
  backgroundURL?: string;
  iconURL?: string;
  /** Wait for the realm to pass its readiness check (default: true). */
  waitForReady?: boolean;
}

export interface CreateRealmResult {
  realmUrl: string;
  created: boolean;
}

export interface PullOptions {
  /** Delete local files that don't exist in the realm (default: false). */
  delete?: boolean;
}

export interface PullResult {
  /** Relative file paths that were downloaded. */
  files: string[];
  error?: string;
}

export type { DeleteResult };
export type { WriteResult };

export interface SearchResult {
  ok: boolean;
  status?: number;
  data?: Record<string, unknown>[];
  error?: string;
}

export interface RunCommandResult {
  status: 'ready' | 'error' | 'unusable';
  /** Serialized command result (JSON string), or null. */
  result?: string | null;
  error?: string | null;
}

export type { LintMessage, LintResult };

export interface WaitForReadyResult {
  ready: boolean;
  error?: string;
}

export interface WaitForFileOptions {
  timeoutMs?: number;
  pollMs?: number;
}

export interface AtomicResult {
  ok: boolean;
  response?: unknown;
  error?: string;
}

export type { CancelIndexingResult };

export class BoxelCLIClient {
  private pm: ProfileManager;

  constructor(pm?: ProfileManager) {
    this.pm = pm ?? getProfileManager();
  }

  /**
   * Ensure a boxel profile exists, migrating from env vars if needed.
   * Call once at process startup (e.g. factory entrypoint) before any
   * BoxelCLIClient operations.
   */
  static async ensureProfile(opts?: {
    realmServerUrl?: string;
  }): Promise<void> {
    if (opts?.realmServerUrl && !process.env.REALM_SERVER_URL) {
      process.env.REALM_SERVER_URL = opts.realmServerUrl;
    }
    let pm = getProfileManager();
    let result = await pm.migrateFromEnv();
    if (result?.profileId) {
      pm.switchProfile(result.profileId);
    }
  }

  /**
   * Returns the active profile's identifying info, or null if no profile
   * is active. Intended for callers that need to validate profile state.
   */
  getActiveProfile(): { matrixId: string; realmServerUrl: string } | null {
    let active = this.pm.getActiveProfile();
    if (!active) return null;
    return {
      matrixId: active.id,
      realmServerUrl: active.profile.realmServerUrl,
    };
  }

  /**
   * Read a file from a realm. Always returns raw text content.
   * Callers should parse the content themselves if needed (e.g. JSON).
   *
   * Delegates to the standalone `read()` in `commands/file/read.ts`
   * so the CLI and programmatic API share one implementation.
   */
  async read(realmUrl: string, path: string): Promise<ReadResult> {
    return fileRead(realmUrl, path, { profileManager: this.pm });
  }

  /**
   * Fetch the TRANSPILED JavaScript output for a realm module. Thin
   * wrapper around the `read-transpiled` CLI command — delegates to
   * `readTranspiledModule()` in `commands/read-transpiled.ts` so the
   * CLI and programmatic API share one implementation.
   */
  async readTranspiled(
    realmUrl: string,
    path: string,
  ): Promise<ReadTranspiledResult> {
    return readTranspiledModule(realmUrl, path, { profileManager: this.pm });
  }

  /**
   * Write a file to a realm. Content is sent as-is with card+source MIME type.
   * Path should include the file extension.
   *
   * Delegates to `write()` in `commands/file/write.ts` so the CLI and
   * programmatic API share one implementation.
   */
  async write(
    realmUrl: string,
    path: string,
    content: string,
  ): Promise<WriteResult> {
    return coreWrite(realmUrl, path, content, { profileManager: this.pm });
  }

  /**
   * Delete a file from a realm. Delegates to the standalone
   * `deleteFile()` command in `commands/file/delete.ts` so the CLI
   * and programmatic API share one implementation.
   */
  async delete(realmUrl: string, path: string): Promise<DeleteResult> {
    return deleteFile(realmUrl, path, {
      profileManager: this.pm,
    });
  }

  /**
   * Search a realm using the `_search` endpoint.
   */
  async search(
    realmUrl: string,
    query: Record<string, unknown>,
  ): Promise<SearchResult> {
    let searchUrl = `${ensureTrailingSlash(realmUrl)}_search`;

    try {
      let response = await this.pm.authedRealmFetch(searchUrl, {
        method: 'QUERY',
        headers: {
          Accept: MIME.CardJson,
          'Content-Type': MIME.JSON,
        },
        body: JSON.stringify(query),
      });

      if (!response.ok) {
        let body = await response.text();
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
        };
      }

      let result = (await response.json()) as {
        data?: Record<string, unknown>[];
      };
      return { ok: true, data: result.data };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * List all file paths in a realm via the `_mtimes` endpoint.
   * Returns relative paths (e.g., `hello.gts`, `Cards/my-card.json`).
   */
  async listFiles(realmUrl: string): Promise<ListFilesResult> {
    return coreListFiles(realmUrl, { profileManager: this.pm });
  }

  /**
   * Execute a Boxel host command on the realm server via the `_run-command`
   * endpoint. Uses the server-scoped token.
   */
  async runCommand(
    realmServerUrl: string,
    realmUrl: string,
    command: string,
    commandInput?: Record<string, unknown>,
  ): Promise<RunCommandResult> {
    let url = `${ensureTrailingSlash(realmServerUrl)}_run-command`;
    let body = {
      data: {
        type: 'run-command',
        attributes: {
          realmURL: realmUrl,
          command,
          commandInput: commandInput ?? null,
        },
      },
    };

    let response: Response;
    try {
      response = await this.pm.authedRealmServerFetch(url, {
        method: 'POST',
        headers: {
          Accept: MIME.JSONAPI,
          'Content-Type': MIME.JSONAPI,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        status: 'error',
        error: `run-command fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!response.ok) {
      return {
        status: 'error',
        error: `run-command HTTP ${response.status}: ${await response.text().catch(() => '(no body)')}`,
      };
    }

    let json = (await response.json()) as {
      data?: {
        attributes?: {
          status?: string;
          cardResultString?: string | null;
          error?: string | null;
        };
      };
    };
    let attrs = json.data?.attributes;
    return {
      status: (attrs?.status as RunCommandResult['status']) ?? 'error',
      result: attrs?.cardResultString ?? null,
      error: attrs?.error ?? null,
    };
  }

  /**
   * Lint a single file's source code via the realm's `_lint` endpoint.
   * Delegates to the standalone `lint()` in `commands/file/lint.ts`.
   */
  async lint(
    realmUrl: string,
    source: string,
    filename: string,
  ): Promise<LintResult> {
    return coreLint(realmUrl, source, filename, { profileManager: this.pm });
  }

  /**
   * Poll `_readiness-check` until the realm is ready or the timeout is reached.
   */
  async waitForReady(
    realmUrl: string,
    timeoutMs = 30_000,
  ): Promise<WaitForReadyResult> {
    let readinessUrl = `${ensureTrailingSlash(realmUrl)}_readiness-check`;
    let startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      try {
        let response = await this.pm.authedRealmFetch(readinessUrl, {
          method: 'GET',
          headers: { Accept: MIME.JSON },
        });
        if (response.ok) {
          return { ready: true };
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    return {
      ready: false,
      error: `Realm not ready after ${timeoutMs}ms: ${readinessUrl}`,
    };
  }

  /**
   * Poll a specific realm file path until it exists (non-404) or the timeout
   * is reached. Useful after writing a file to wait for the realm to finish
   * processing it before reading it back.
   */
  async waitForFile(
    realmUrl: string,
    path: string,
    options?: WaitForFileOptions,
  ): Promise<boolean> {
    let timeoutMs = options?.timeoutMs ?? 30_000;
    let pollMs = options?.pollMs ?? 300;
    let startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      let result = await this.read(realmUrl, path);
      if (result.ok) {
        return true;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    return false;
  }

  /**
   * Execute a batch of operations atomically against a realm.
   * Operations is a JSON string of the `atomic:operations` array.
   */
  async atomicOperation(
    realmUrl: string,
    operations: string,
  ): Promise<AtomicResult> {
    let atomicUrl = `${ensureTrailingSlash(realmUrl)}_atomic`;

    try {
      let response = await this.pm.authedRealmFetch(atomicUrl, {
        method: 'POST',
        headers: {
          Accept: MIME.JSONAPI,
          'Content-Type': MIME.JSONAPI,
        },
        body: JSON.stringify({ 'atomic:operations': JSON.parse(operations) }),
      });

      if (!response.ok) {
        let body = await response.text();
        return {
          ok: false,
          error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
        };
      }

      let result = await response.json();
      return { ok: true, response: result };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Cancel all indexing jobs (running + pending) for a realm.
   */
  async cancelAllIndexingJobs(realmUrl: string): Promise<CancelIndexingResult> {
    return coreCancelIndexing(realmUrl, {
      profileManager: this.pm,
      cancelPending: true,
    });
  }

  /**
   * Return the cached per-realm JWT for a realm URL, acquiring it via the
   * realm server if necessary. Intended for scenarios like Playwright's
   * `page.route()` that need a raw token to inject into browser-side fetches.
   * Prefer `read`/`write`/`search` in normal code paths.
   */
  async getRealmToken(realmUrl: string): Promise<string | undefined> {
    return this.pm.getRealmTokenForUrl(realmUrl);
  }

  /**
   * Perform an arbitrary fetch against a realm URL with the per-realm JWT
   * injected automatically. Prefer the typed `read`/`write`/`search`
   * helpers. Use this only for endpoints the typed helpers don't cover
   * (e.g., loading a brief card from a source realm with custom headers).
   */
  async authedFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    return this.pm.authedRealmFetch(input, init);
  }

  /**
   * Perform an arbitrary fetch against a realm server URL with the server
   * JWT injected. Use for server-level endpoints not exposed as typed
   * helpers (e.g., `_request-forward` for the OpenRouter proxy).
   */
  async authedServerFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    return this.pm.authedRealmServerFetch(input, init);
  }

  async pull(
    realmUrl: string,
    localDir: string,
    options?: PullOptions,
  ): Promise<PullResult> {
    return realmPull(realmUrl, localDir, {
      delete: options?.delete,
      profileManager: this.pm,
    });
  }

  async createRealm(options: CreateRealmOptions): Promise<CreateRealmResult> {
    let result = await coreCreateRealm(options.realmName, options.displayName, {
      background: options.backgroundURL,
      icon: options.iconURL,
      profileManager: this.pm,
      waitForReady: options.waitForReady !== false,
    });

    return {
      realmUrl: result.realmUrl,
      created: result.created,
    };
  }
}
