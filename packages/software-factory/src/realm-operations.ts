/**
 * Shared realm operations for the software-factory scripts.
 *
 * Centralizes HTTP-based realm API calls so they're easy to find and
 * refactor to boxel-cli tool calls (CS-10529).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

export { SupportedMimeType };

export function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Realm operations use a caller-supplied `fetch` that is already
 * authenticated for the realm being targeted. Production callers pass
 * `createRealmFetch(realmUrl)` (from `@cardstack/boxel-cli`); tests pass
 * a stub. The functions in this module never touch JWTs themselves.
 */
export interface RealmFetchOptions {
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
  accept = SupportedMimeType.JSON,
): Record<string, string> {
  return { Accept: accept };
}

export function buildCardSourceHeaders(): Record<string, string> {
  return {
    Accept: SupportedMimeType.CardSource,
    'Content-Type': SupportedMimeType.CardSource,
  };
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
      headers: buildAuthHeaders(SupportedMimeType.CardSource),
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
      headers: buildCardSourceHeaders(),
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
      headers: buildAuthHeaders(SupportedMimeType.CardSource),
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
// File polling
// ---------------------------------------------------------------------------

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
// Fetch Realm Filenames
// ---------------------------------------------------------------------------

/**
 * Fetch the list of file paths from a realm via the `_mtimes` endpoint.
 * Returns relative file paths (e.g., `hello.gts`, `Cards/my-card.json`).
 */
export async function fetchRealmFilenames(
  realmUrl: string,
  options?: RealmFetchOptions,
): Promise<{ filenames: string[]; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedRealmUrl = ensureTrailingSlash(realmUrl);

  let headers = buildAuthHeaders(SupportedMimeType.JSONAPI);

  let mtimesUrl = `${normalizedRealmUrl}_mtimes`;
  let mtimesResponse: Response;
  try {
    mtimesResponse = await fetchImpl(mtimesUrl, { method: 'GET', headers });
  } catch (err) {
    return {
      filenames: [],
      error: `Failed to fetch _mtimes: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!mtimesResponse.ok) {
    let body = await mtimesResponse.text();
    return {
      filenames: [],
      error: `_mtimes returned HTTP ${mtimesResponse.status}: ${body.slice(0, 300)}`,
    };
  }

  let mtimes: Record<string, number>;
  try {
    let json = await mtimesResponse.json();
    mtimes =
      (json as { data?: { attributes?: { mtimes?: Record<string, number> } } })
        ?.data?.attributes?.mtimes ?? json;
  } catch {
    return {
      filenames: [],
      error: 'Failed to parse _mtimes response as JSON',
    };
  }

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
}

// ---------------------------------------------------------------------------
// Pull Realm Files
// ---------------------------------------------------------------------------

/**
 * Download all files from a remote realm to a local directory using the
 * `_mtimes` endpoint to discover file paths.
 *
 * TODO: Replace with `boxel pull` once CS-10529 is implemented.
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

  let headers = buildAuthHeaders(SupportedMimeType.JSONAPI);

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
        headers: buildAuthHeaders(SupportedMimeType.CardSource),
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
