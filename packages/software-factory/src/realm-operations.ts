/**
 * Shared realm operations for the software-factory scripts.
 *
 * Centralizes HTTP-based realm API calls so they're easy to find and
 * refactor to boxel-cli tool calls (CS-10529).
 */

import { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

export { SupportedMimeType };

/**
 * Ensure a card instance path ends with `.json`. The realm API uses
 * `card+source` content negotiation which requires the full file path
 * including extension.
 */
export function ensureJsonExtension(path: string): string {
  if (!path.endsWith('.json')) {
    return `${path}.json`;
  }
  return path;
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
  status?: number;
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
        status: response.status,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    let text = await response.text();
    try {
      let document = JSON.parse(text) as LooseSingleCardDocument;
      return { ok: true, status: response.status, document };
    } catch {
      // Non-JSON content (e.g., .gts source files) — return as raw text
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
 * Fetch the TRANSPILED JavaScript output for a realm module.
 *
 * Runtime evaluation errors (from eval/instantiate validation) carry
 * line/column references that point to the transpiled output, not the
 * raw .gts source. Use this to inspect what the realm server actually
 * compiled.
 *
 * The realm resolves the module URL without the .gts extension, so we
 * strip it before fetching (the caller may pass with or without .gts).
 */
export async function readTranspiledModule(
  realmUrl: string,
  path: string,
  options?: RealmFetchOptions,
): Promise<{
  ok: boolean;
  status?: number;
  content?: string;
  error?: string;
}> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let modulePath = path.endsWith('.gts') ? path.slice(0, -'.gts'.length) : path;
  let url = new URL(modulePath, ensureTrailingSlash(realmUrl)).href;

  try {
    let response = await fetchImpl(url, {
      method: 'GET',
      headers: buildAuthHeaders(options?.authorization, SupportedMimeType.All),
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
    return { ok: true, status: response.status, content: text };
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
// Issue Comments
// ---------------------------------------------------------------------------

/**
 * Append a comment to an issue card using read-patch-write.
 * Issue descriptions are immutable — all post-creation context goes through comments.
 */
export async function addCommentToIssue(
  realmUrl: string,
  path: string,
  comment: { body: string; author: string; datetime?: string },
  options?: RealmFetchOptions,
): Promise<{ ok: boolean; error?: string }> {
  let filePath = ensureJsonExtension(path);

  let existing = await readFile(realmUrl, filePath, options);
  if (!existing.ok || !existing.document) {
    return {
      ok: false,
      error: `Failed to read issue at ${filePath}: ${existing.error ?? 'no document'}`,
    };
  }

  let attrs = (existing.document.data?.attributes ?? {}) as Record<
    string,
    unknown
  >;
  let existingComments = Array.isArray(attrs.comments)
    ? (attrs.comments as unknown[])
    : [];

  existingComments.push({
    body: comment.body,
    author: comment.author,
    datetime: comment.datetime ?? new Date().toISOString(),
  });

  attrs.comments = existingComments;
  attrs.updatedAt = new Date().toISOString();
  existing.document.data.attributes = attrs;

  return writeFile(
    realmUrl,
    filePath,
    JSON.stringify(existing.document, null, 2),
    options,
  );
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
// Lint
// ---------------------------------------------------------------------------

/** A single lint diagnostic message (mirrors ESLint's Linter.LintMessage). */
export interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2; // 1 = warning, 2 = error
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/** Response from the realm `_lint` endpoint (mirrors ESLint's Linter.FixReport). */
export interface LintFileResponse {
  fixed: boolean;
  output: string;
  messages: LintMessage[];
}

/**
 * Lint a single file's source code via the realm's `_lint` endpoint.
 * The endpoint runs ESLint with `@cardstack/boxel` rules and Prettier formatting.
 */
export async function lintFile(
  realmUrl: string,
  source: string,
  filename: string,
  options?: RealmFetchOptions,
): Promise<LintFileResponse> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;
  let normalizedUrl = ensureTrailingSlash(realmUrl);
  let lintUrl = `${normalizedUrl}_lint`;

  let headers: Record<string, string> = {
    Accept: SupportedMimeType.JSON,
    'Content-Type': SupportedMimeType.CardSource,
    'X-Filename': filename,
    'X-HTTP-Method-Override': 'QUERY',
  };
  if (options?.authorization) {
    headers['Authorization'] = options.authorization;
  }

  let response = await fetchImpl(lintUrl, {
    method: 'POST',
    headers,
    body: source,
  });

  if (!response.ok) {
    let body = await response.text().catch(() => '(no body)');
    throw new Error(
      `_lint returned HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  return (await response.json()) as LintFileResponse;
}

// ---------------------------------------------------------------------------
// Validation Artifact Sequence Numbers
// ---------------------------------------------------------------------------

/**
 * Get the next sequence number for a validation artifact by searching
 * existing cards of the given type in the realm. Each slug (issue) gets its
 * own independent sequence starting from 1.
 *
 * Shared by TestValidationStep and LintValidationStep so that sequence
 * numbering is derived from realm state (survives process restarts).
 */
export async function getNextValidationSequenceNumber(
  slug: string,
  prefix: string,
  moduleUrl: string,
  cardName: string,
  options: RealmFetchOptions & { targetRealmUrl: string },
): Promise<number> {
  let result = await searchRealm(
    options.targetRealmUrl,
    {
      filter: {
        on: { module: moduleUrl, name: cardName },
      },
      sort: [{ by: 'sequenceNumber', direction: 'desc' }],
    },
    { authorization: options.authorization, fetch: options.fetch },
  );

  if (!result?.ok || !result.data) {
    return 1;
  }

  let targetRealmUrl = ensureTrailingSlash(options.targetRealmUrl);
  let fullPrefix = `${prefix}${slug}-`;
  let maxSeq = 0;

  for (let card of result.data) {
    let cardId = (card as { id?: string }).id ?? '';
    let relativePath = cardId.startsWith(targetRealmUrl)
      ? cardId.slice(targetRealmUrl.length)
      : cardId;
    if (relativePath.startsWith(fullPrefix)) {
      let attrs = (card as { attributes?: { sequenceNumber?: number } })
        .attributes;
      let seq = attrs?.sequenceNumber ?? 0;
      if (seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  return maxSeq + 1;
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

  let headers = buildAuthHeaders(
    options?.authorization,
    SupportedMimeType.JSONAPI,
  );

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
    // _mtimes returns JSON:API format: { data: { attributes: { mtimes: {...} } } }
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
 * Download all files from a remote realm to a local directory.
 * Delegates to boxel-cli's pull implementation which handles auth
 * via the active profile.
 *
 * Returns the list of relative file paths that were downloaded.
 */
export async function pullRealmFiles(
  realmUrl: string,
  localDir: string,
): Promise<{ files: string[]; error?: string }> {
  let client = new BoxelCLIClient();
  return client.pull(realmUrl, localDir);
}
