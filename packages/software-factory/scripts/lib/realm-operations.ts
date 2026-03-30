/**
 * Shared realm operations for the software-factory scripts.
 *
 * Centralizes HTTP-based realm API calls so they're easy to find and
 * refactor to boxel-cli tool calls when --jwt support is added (CS-10529).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const cardSourceMimeType = 'application/vnd.card+source';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Note: also exists in @cardstack/runtime-common/paths but not exported
// from the package index. Kept here to avoid subpath import issues.
export function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function buildAuthHeaders(
  authorization?: string,
  accept = 'application/json',
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
    Accept: cardSourceMimeType,
    'Content-Type': cardSourceMimeType,
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
): Promise<{ data?: Record<string, unknown>[] } | undefined> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmUrl);
  let searchUrl = `${normalizedUrl}_search`;

  let headers: Record<string, string> = {
    Accept: 'application/vnd.card+json',
    'Content-Type': 'application/json',
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
      return undefined;
    }

    return (await response.json()) as { data?: Record<string, unknown>[] };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Card Read / Write
// ---------------------------------------------------------------------------

/**
 * Read a card from a realm as card source JSON.
 */
export async function readCardSource(
  realmUrl: string,
  cardPath: string,
  options?: RealmFetchOptions,
): Promise<{
  ok: boolean;
  document?: LooseSingleCardDocument;
  error?: string;
}> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let url = new URL(cardPath, ensureTrailingSlash(realmUrl)).href;

  try {
    let response = await fetchImpl(url, {
      method: 'GET',
      headers: buildAuthHeaders(options?.authorization, cardSourceMimeType),
    });

    if (!response.ok) {
      let body = await response.text();
      return {
        ok: false,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    let document = (await response.json()) as LooseSingleCardDocument;
    return { ok: true, document };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Write a card to a realm using card source MIME type.
 * The path should include the `.json` extension.
 */
export async function writeCardSource(
  realmUrl: string,
  cardPathWithExtension: string,
  document: LooseSingleCardDocument,
  options?: RealmFetchOptions,
): Promise<{ ok: boolean; error?: string }> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let url = new URL(cardPathWithExtension, ensureTrailingSlash(realmUrl)).href;

  try {
    let response = await fetchImpl(url, {
      method: 'POST',
      headers: buildCardSourceHeaders(options?.authorization),
      body: JSON.stringify(document, null, 2),
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
    Accept: 'application/json',
    'Content-Type': 'application/json',
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
        Accept: 'application/json',
        'Content-Type': 'application/json',
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

  // _mtimes requires Accept: application/vnd.api+json (SupportedMimeType.Mtimes)
  let headers = buildAuthHeaders(options?.authorization, 'application/vnd.api+json');

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
    mtimes = (await mtimesResponse.json()) as Record<string, number>;
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
        headers: buildAuthHeaders(options?.authorization, '*/*'),
      });

      if (!fileResponse.ok) {
        continue;
      }

      let content = await fileResponse.arrayBuffer();
      writeFileSync(localPath, Buffer.from(content));
      downloadedFiles.push(relativePath);
    } catch {
      continue;
    }
  }

  return { files: downloadedFiles.sort() };
}
