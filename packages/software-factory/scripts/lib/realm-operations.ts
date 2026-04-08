/**
 * Shared realm operations for the software-factory scripts.
 *
 * Centralizes HTTP-based realm API calls so they're easy to find and
 * refactor to boxel-cli tool calls when --jwt support is added (CS-10529).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

export { SupportedMimeType };

export function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealmFetchOptions {
  authorization?: string;
  fetch?: typeof globalThis.fetch;
}

export interface SearchRealmOptions extends RealmFetchOptions {
  realmUrl: string;
}

export type RunCommandOptions = RealmFetchOptions;

export interface RunCommandResponse {
  status: 'ready' | 'error' | 'unusable';
  /** Serialized command result (JSON string), or null. */
  result?: string | null;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildAuthHeaders(
  authorization?: string,
  accept = SupportedMimeType.JSON,
): Record<string, string> {
  let headers: Record<string, string> = { Accept: accept };
  if (authorization) {
    headers['Authorization'] = authorization;
  }
  return headers;
}

export function buildCardSourceHeaders(
  authorization?: string,
): Record<string, string> {
  let headers: Record<string, string> = {
    Accept: SupportedMimeType.CardSource,
    'Content-Type': SupportedMimeType.CardSource,
  };
  if (authorization) {
    headers['Authorization'] = authorization;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Realm Search
// ---------------------------------------------------------------------------

/**
 * Search a realm using the `_search` endpoint with a QUERY method.
 * Returns the parsed JSON response body, or undefined on failure.
 */
export async function searchRealm(
  realmUrl: string,
  query: Record<string, unknown>,
  options?: RealmFetchOptions,
): Promise<
  | { ok: true; data?: Record<string, unknown>[] }
  | { ok: false; status: number; error: string }
> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmUrl);
  let searchUrl = `${normalizedUrl}_search`;

  let headers: Record<string, string> = {
    Accept: SupportedMimeType.CardJson,
    'Content-Type': SupportedMimeType.JSON,
  };
  if (options?.authorization) {
    headers['Authorization'] = options.authorization;
  }

  try {
    let response = await fetchImpl(searchUrl, {
      method: 'QUERY',
      headers,
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

// ---------------------------------------------------------------------------
// Run Command (prerenderer)
// ---------------------------------------------------------------------------

/**
 * Execute a host command on the realm server via the `/_run-command`
 * endpoint. The command is enqueued as a job and executed in the
 * prerenderer's headless Chrome where the full card runtime (Loader,
 * CardAPI, services) is available.
 *
 * The authenticated user is derived from the JWT in the Authorization
 * header — no separate userId is needed.
 */
export async function runRealmCommand(
  realmServerUrl: string,
  realmUrl: string,
  command: string,
  commandInput?: Record<string, unknown>,
  options?: RunCommandOptions,
): Promise<RunCommandResponse> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
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

  let headers: Record<string, string> = {
    'Content-Type': 'application/vnd.api+json',
    Accept: 'application/vnd.api+json',
  };
  if (options?.authorization) {
    headers['Authorization'] = options.authorization;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
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
    status: (attrs?.status as RunCommandResponse['status']) ?? 'error',
    result: attrs?.cardResultString ?? null,
    error: attrs?.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// File Read / Write / Delete
// ---------------------------------------------------------------------------

/**
 * Read a file from a realm using the card+source MIME type.
 * Path should include the file extension (e.g. `Card/foo.json`, `my-card.gts`).
 */
export async function readFile(
  realmUrl: string,
  path: string,
  options?: RealmFetchOptions,
): Promise<{
  ok: boolean;
  document?: LooseSingleCardDocument;
  /** Raw text content for non-JSON files (e.g., .gts source). */
  content?: string;
  error?: string;
}> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  try {
    let response = await fetchImpl(url, {
      method: 'GET',
      headers: buildAuthHeaders(
        options?.authorization,
        SupportedMimeType.CardSource,
      ),
    });

    if (!response.ok) {
      let body = await response.text();
      return {
        ok: false,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    let text = await response.text();
    try {
      let document = JSON.parse(text) as LooseSingleCardDocument;
      return { ok: true, document };
    } catch {
      // Non-JSON content (e.g., .gts source files) — return as raw text
      return { ok: true, content: text };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Write a file to a realm using the card+source MIME type.
 * Path should include the file extension. Content is sent as-is.
 */
export async function writeFile(
  realmUrl: string,
  path: string,
  content: string,
  options?: RealmFetchOptions,
): Promise<{ ok: boolean; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let url = new URL(path, ensureTrailingSlash(realmUrl)).href;

  try {
    let response = await fetchImpl(url, {
      method: 'POST',
      headers: buildCardSourceHeaders(options?.authorization),
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

// ---------------------------------------------------------------------------
// Card / File Delete
// ---------------------------------------------------------------------------

/**
 * Delete a card or file from a realm.
 */
export async function deleteFile(
  realmUrl: string,
  cardPath: string,
  options?: RealmFetchOptions,
): Promise<{ ok: boolean; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let url = new URL(cardPath, ensureTrailingSlash(realmUrl)).href;

  try {
    let response = await fetchImpl(url, {
      method: 'DELETE',
      headers: buildAuthHeaders(
        options?.authorization,
        SupportedMimeType.CardSource,
      ),
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

// ---------------------------------------------------------------------------
// Atomic Batch Operations
// ---------------------------------------------------------------------------

/**
 * Execute a batch of operations atomically against a realm.
 * Operations should be a JSON string of the `atomic:operations` array.
 */
export async function atomicOperation(
  realmUrl: string,
  operations: string,
  options?: RealmFetchOptions,
): Promise<{ ok: boolean; response?: unknown; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmUrl);
  let atomicUrl = `${normalizedUrl}_atomic`;

  let headers: Record<string, string> = {
    Accept: SupportedMimeType.JSONAPI,
    'Content-Type': SupportedMimeType.JSONAPI,
  };
  if (options?.authorization) {
    headers['Authorization'] = options.authorization;
  }

  try {
    let response = await fetchImpl(atomicUrl, {
      method: 'POST',
      headers,
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

// ---------------------------------------------------------------------------
// Realm Server Session
// ---------------------------------------------------------------------------

/**
 * Obtain a realm server JWT by calling `_server-session`.
 * Requires a Matrix OpenID token.
 */
export async function getServerSession(
  realmServerUrl: string,
  openidToken: string,
  options?: { fetch?: typeof globalThis.fetch; authorization?: string },
): Promise<{ token?: string; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmServerUrl);

  let headers: Record<string, string> = {
    Accept: SupportedMimeType.JSON,
    'Content-Type': SupportedMimeType.JSON,
  };
  if (options?.authorization) {
    headers['Authorization'] = options.authorization;
  }

  try {
    let response = await fetchImpl(`${normalizedUrl}_server-session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ access_token: openidToken }),
    });

    if (!response.ok) {
      let body = await response.text();
      return {
        error: `_server-session returned HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    // The server session JWT is returned in the Authorization header
    let authorizationHeader = response.headers.get('authorization');
    if (authorizationHeader) {
      return { token: authorizationHeader };
    }

    // Fallback: check response body
    let bodyText = await response.text();
    if (!bodyText.trim()) {
      return {
        error: '_server-session succeeded but no token was returned',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return {
        error: '_server-session succeeded but response body was not valid JSON',
      };
    }

    let data = parsed as { token?: string };
    if (typeof data.token === 'string' && data.token.length > 0) {
      return { token: data.token };
    }

    return {
      error: '_server-session succeeded but no token was returned',
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Indexing Job Management
// ---------------------------------------------------------------------------

/**
 * Cancel all indexing jobs (running + pending) for a realm.
 * Uses the `_cancel-indexing-job` endpoint with `cancelPending: true`.
 */
export async function cancelAllIndexingJobs(
  realmUrl: string,
  options?: RealmFetchOptions,
): Promise<{ ok: boolean; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmUrl);
  let cancelUrl = `${normalizedUrl}_cancel-indexing-job`;

  let headers: Record<string, string> = {
    Accept: SupportedMimeType.JSON,
    'Content-Type': SupportedMimeType.JSON,
  };
  if (options?.authorization) {
    headers['Authorization'] = options.authorization;
  }

  try {
    let response = await fetchImpl(cancelUrl, {
      method: 'POST',
      headers,
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

// ---------------------------------------------------------------------------
// Realm Creation
// ---------------------------------------------------------------------------

/**
 * Create a new realm on the realm server via `_create-realm`.
 * Returns the canonical realm URL on success.
 *
 * When `matrixAuth` is provided, the new realm URL is automatically
 * added to the user's Matrix account data so it appears in their
 * workspace list in Boxel.
 */
export async function createRealm(
  realmServerUrl: string,
  options: {
    name: string;
    endpoint: string;
    iconURL?: string;
    backgroundURL?: string;
    authorization: string;
    fetch?: typeof globalThis.fetch;
    matrixAuth?: {
      userId: string;
      accessToken: string;
      matrixUrl: string;
    };
  },
): Promise<{ realmUrl: string; created: boolean; error?: string }> {
  let fetchImpl = options.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmServerUrl);

  let headers: Record<string, string> = {
    Accept: SupportedMimeType.JSONAPI,
    'Content-Type': SupportedMimeType.JSONAPI,
    Authorization: options.authorization,
  };

  let attributes: Record<string, unknown> = {
    name: options.name,
    endpoint: options.endpoint,
    iconURL: options.iconURL ?? iconURLFor(options.name),
    backgroundURL: options.backgroundURL ?? getRandomBackgroundURL(),
  };

  try {
    let response = await fetchImpl(`${normalizedUrl}_create-realm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: { type: 'realm', attributes },
      }),
    });

    let matrixAuth = options.matrixAuth;

    if (response.ok) {
      let result = (await response.json()) as { data?: { id?: string } };
      let realmUrl = result.data?.id ?? '';

      if (realmUrl && matrixAuth) {
        await addRealmToMatrixAccountData(
          matrixAuth,
          ensureTrailingSlash(realmUrl),
          fetchImpl,
        );
      }

      return { realmUrl, created: true };
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      body = 'server returned a non-serialized object body';
    }
    if (body.includes('[object Object]')) {
      body = 'server returned a non-serialized object body';
    }

    // When the realm already exists, ensure it's still registered in the
    // user's Matrix account data so it appears in the Boxel dashboard.
    if (body.includes('already exists') && matrixAuth) {
      let urlMatch = body.match(/'(https?:\/\/[^']+)'/);
      if (urlMatch) {
        await addRealmToMatrixAccountData(
          matrixAuth,
          ensureTrailingSlash(urlMatch[1]),
          fetchImpl,
        );
      }
    }

    return {
      realmUrl: '',
      created: false,
      error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
    };
  } catch (err) {
    return {
      realmUrl: '',
      created: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Realm Authentication
// ---------------------------------------------------------------------------

/**
 * Get a realm-scoped JWT by calling `_realm-auth` on the realm server.
 * Requires a server-level JWT (from `_server-session`).
 */
export async function getRealmScopedAuth(
  realmServerUrl: string,
  serverToken: string,
  options?: { fetch?: typeof globalThis.fetch },
): Promise<{ tokens: Record<string, string>; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmServerUrl);

  try {
    let response = await fetchImpl(`${normalizedUrl}_realm-auth`, {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.JSON,
        'Content-Type': SupportedMimeType.JSON,
        Authorization: serverToken,
      },
    });

    if (!response.ok) {
      let body = await response.text();
      return {
        tokens: {},
        error: `_realm-auth returned HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    let data = (await response.json()) as Record<string, string>;
    return { tokens: data };
  } catch (err) {
    return {
      tokens: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Realm Readiness
// ---------------------------------------------------------------------------

/**
 * Wait for a realm to be ready by polling `_readiness-check` until it
 * returns 200 or the timeout is reached.
 */
export async function waitForRealmReady(
  realmUrl: string,
  options?: RealmFetchOptions & { timeoutMs?: number },
): Promise<{ ready: boolean; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmUrl);
  let readinessUrl = `${normalizedUrl}_readiness-check`;
  let timeoutMs = options?.timeoutMs ?? 30_000;
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await fetchImpl(readinessUrl, {
        headers: buildAuthHeaders(options?.authorization),
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
 * Poll a specific realm file path until it exists (non-404), or the
 * timeout is reached. Useful after writing a file to wait for the
 * realm to finish processing it before reading it back.
 *
 * @returns true if the file was found, false on timeout.
 */
export async function waitForRealmFile(
  realmUrl: string,
  path: string,
  options?: RealmFetchOptions & { timeoutMs?: number; pollMs?: number },
): Promise<boolean> {
  let timeoutMs = options?.timeoutMs ?? 30_000;
  let pollMs = options?.pollMs ?? 300;
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    let result = await readFile(realmUrl, path, options);
    if (result.ok) {
      return true;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return false;
}

// ---------------------------------------------------------------------------
// Matrix Account Data
// ---------------------------------------------------------------------------

/**
 * Add a realm URL to the user's Matrix account data so it shows up
 * in their Boxel workspace list.
 */
async function addRealmToMatrixAccountData(
  matrixAuth: { userId: string; accessToken: string; matrixUrl: string },
  realmUrl: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  let accountDataUrl = new URL(
    `_matrix/client/v3/user/${encodeURIComponent(matrixAuth.userId)}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
    matrixAuth.matrixUrl,
  ).href;

  let existingRealms: string[] = [];
  try {
    let getResponse = await fetchImpl(accountDataUrl, {
      headers: { Authorization: `Bearer ${matrixAuth.accessToken}` },
    });
    if (getResponse.ok) {
      let data = (await getResponse.json()) as { realms?: string[] };
      existingRealms = Array.isArray(data.realms) ? [...data.realms] : [];
    }
  } catch {
    // Best-effort — if we can't read existing realms, start fresh
  }

  if (!existingRealms.includes(realmUrl)) {
    existingRealms.push(realmUrl);
    try {
      let putResponse = await fetchImpl(accountDataUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': SupportedMimeType.JSON,
          Authorization: `Bearer ${matrixAuth.accessToken}`,
        },
        body: JSON.stringify({ realms: existingRealms }),
      });
      if (!putResponse.ok) {
        console.warn(
          `Warning: failed to update Matrix account data for realm ${realmUrl}: HTTP ${putResponse.status}`,
        );
      }
    } catch (err) {
      console.warn(
        `Warning: failed to update Matrix account data for realm ${realmUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pull Realm Files
// ---------------------------------------------------------------------------

/**
 * Download all files from a remote realm to a local directory using the
 * `_mtimes` endpoint to discover file paths.
 *
 * TODO: Replace with `boxel pull --jwt <token>` once CS-10529 is implemented.
 *
 * Returns the list of relative file paths that were downloaded.
 */
export async function pullRealmFiles(
  realmUrl: string,
  localDir: string,
  options?: RealmFetchOptions,
): Promise<{ files: string[]; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedRealmUrl = ensureTrailingSlash(realmUrl);

  let headers = buildAuthHeaders(
    options?.authorization,
    SupportedMimeType.JSONAPI,
  );

  // Fetch mtimes to discover all file paths.
  let mtimesUrl = `${normalizedRealmUrl}_mtimes`;
  let mtimesResponse: Response;
  try {
    mtimesResponse = await fetchImpl(mtimesUrl, { method: 'GET', headers });
  } catch (err) {
    return {
      files: [],
      error: `Failed to fetch _mtimes: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!mtimesResponse.ok) {
    let body = await mtimesResponse.text();
    return {
      files: [],
      error: `_mtimes returned HTTP ${mtimesResponse.status}: ${body.slice(0, 300)}`,
    };
  }

  let mtimes: Record<string, number>;
  try {
    let json = await mtimesResponse.json();
    // _mtimes returns JSON:API format: { data: { attributes: { mtimes: {...} } } }
    mtimes =
      (json as { data?: { attributes?: { mtimes?: Record<string, number> } } })
        ?.data?.attributes?.mtimes ?? json;
  } catch {
    return { files: [], error: 'Failed to parse _mtimes response as JSON' };
  }

  // Download each file.
  let downloadedFiles: string[] = [];
  for (let fullUrl of Object.keys(mtimes)) {
    if (!fullUrl.startsWith(normalizedRealmUrl)) {
      continue;
    }
    let relativePath = fullUrl.slice(normalizedRealmUrl.length);
    if (!relativePath || relativePath.endsWith('/')) {
      continue;
    }

    let localPath = join(localDir, relativePath);
    mkdirSync(dirname(localPath), { recursive: true });

    try {
      let fileResponse = await fetchImpl(fullUrl, {
        method: 'GET',
        headers: buildAuthHeaders(
          options?.authorization,
          SupportedMimeType.CardSource,
        ),
      });

      if (!fileResponse.ok) {
        continue;
      }

      let rawText = await fileResponse.text();
      writeFileSync(localPath, rawText);
      downloadedFiles.push(relativePath);
    } catch {
      continue;
    }
  }

  return { files: downloadedFiles.sort() };
}
