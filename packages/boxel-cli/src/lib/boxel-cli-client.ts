import { createRealm as coreCreateRealm } from '../commands/realm/create';
import { pull as realmPull } from '../commands/realm/pull';
import { getProfileManager, type ProfileManager } from './profile-manager';

const MIME = {
  CardSource: 'application/vnd.card+source',
  CardJson: 'application/vnd.card+json',
  JSON: 'application/json',
  JSONAPI: 'application/vnd.api+json',
} as const;

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

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
  // TODO: Remove once pull/push/sync/search are added to BoxelCLIClient.
  // Callers should not manage tokens directly — this is transitional glue
  // until the factory uses BoxelCLIClient for all realm operations.
  authorization: string;
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

export interface ReadResult {
  ok: boolean;
  status?: number;
  /** Parsed JSON document (for .json files). */
  document?: Record<string, unknown>;
  /** Raw text content (for non-JSON files like .gts). */
  content?: string;
  error?: string;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

export interface SearchResult {
  ok: boolean;
  status?: number;
  data?: Record<string, unknown>[];
  error?: string;
}

export interface ListFilesResult {
  filenames: string[];
  error?: string;
}

export interface RunCommandResult {
  status: 'ready' | 'error' | 'unusable';
  /** Serialized command result (JSON string), or null. */
  result?: string | null;
  error?: string | null;
}

export interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface LintResult {
  fixed: boolean;
  output: string;
  messages: LintMessage[];
}

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

export interface CancelIndexingResult {
  ok: boolean;
  error?: string;
}

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
   * Read a file from a realm. Returns parsed JSON for .json files,
   * raw text for everything else (.gts, etc.).
   */
  async read(realmUrl: string, path: string): Promise<ReadResult> {
    let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

    try {
      let response = await this.pm.authedRealmFetch(url, {
        method: 'GET',
        headers: { Accept: MIME.CardSource },
      });

      if (!response.ok) {
        let body = await response.text();
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
        };
      }

      let text = await response.text();
      try {
        let document = JSON.parse(text) as Record<string, unknown>;
        return { ok: true, status: response.status, document };
      } catch {
        return { ok: true, status: response.status, content: text };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Write a file to a realm. Content is sent as-is with card+source MIME type.
   * Path should include the file extension.
   */
  async write(
    realmUrl: string,
    path: string,
    content: string,
  ): Promise<WriteResult> {
    let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

    try {
      let response = await this.pm.authedRealmFetch(url, {
        method: 'POST',
        headers: {
          Accept: MIME.CardSource,
          'Content-Type': MIME.CardSource,
        },
        body: content,
      });

      if (!response.ok) {
        let body = await response.text();
        return {
          ok: false,
          error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
        };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Delete a file from a realm.
   */
  async delete(realmUrl: string, path: string): Promise<DeleteResult> {
    let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

    try {
      let response = await this.pm.authedRealmFetch(url, {
        method: 'DELETE',
        headers: { Accept: MIME.CardSource },
      });

      if (!response.ok) {
        let body = await response.text();
        return {
          ok: false,
          error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
        };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
    let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
    let mtimesUrl = `${normalizedRealmUrl}_mtimes`;

    try {
      let response = await this.pm.authedRealmFetch(mtimesUrl, {
        method: 'GET',
        headers: { Accept: MIME.JSONAPI },
      });

      if (!response.ok) {
        let body = await response.text();
        return {
          filenames: [],
          error: `_mtimes returned HTTP ${response.status}: ${body.slice(0, 300)}`,
        };
      }

      let json = (await response.json()) as {
        data?: { attributes?: { mtimes?: Record<string, number> } };
      };
      let mtimes =
        json?.data?.attributes?.mtimes ??
        (json as unknown as Record<string, number>);

      let filenames: string[] = [];
      for (let fullUrl of Object.keys(mtimes)) {
        if (!fullUrl.startsWith(normalizedRealmUrl)) {
          continue;
        }
        let relativePath = fullUrl.slice(normalizedRealmUrl.length);
        if (!relativePath || relativePath.endsWith('/')) {
          continue;
        }
        filenames.push(relativePath);
      }

      return { filenames: filenames.sort() };
    } catch (err) {
      return {
        filenames: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
   */
  async lint(
    realmUrl: string,
    source: string,
    filename: string,
  ): Promise<LintResult> {
    let lintUrl = `${ensureTrailingSlash(realmUrl)}_lint`;
    let response = await this.pm.authedRealmFetch(lintUrl, {
      method: 'POST',
      headers: {
        Accept: MIME.JSON,
        'Content-Type': MIME.CardSource,
        'X-Filename': filename,
        'X-HTTP-Method-Override': 'QUERY',
      },
      body: source,
    });

    if (!response.ok) {
      let body = await response.text().catch(() => '(no body)');
      throw new Error(
        `_lint returned HTTP ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    return (await response.json()) as LintResult;
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
    let cancelUrl = `${ensureTrailingSlash(realmUrl)}_cancel-indexing-job`;

    try {
      let response = await this.pm.authedRealmFetch(cancelUrl, {
        method: 'POST',
        headers: {
          Accept: MIME.JSON,
          'Content-Type': MIME.JSON,
        },
        body: JSON.stringify({ cancelPending: true }),
      });

      if (!response.ok) {
        let body = await response.text();
        return {
          ok: false,
          error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
        };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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

    if (!result.realmToken) {
      throw new Error(
        `Realm "${options.realmName}" was created, but no authorization token was returned.`,
      );
    }

    return {
      realmUrl: result.realmUrl,
      created: result.created,
      authorization: result.realmToken,
    };
  }
}
