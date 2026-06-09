/**
 * Local-filesystem primitives for the factory's target-realm I/O.
 *
 * Every target-realm read/write/delete happens against a local workspace
 * directory; synchronization with the realm is done via `client.pull` /
 * `client.sync` at well-defined points in the loop.
 *
 * Result shapes mirror `BoxelCLIClient.ReadResult` / `WriteResult` /
 * `DeleteResult`:
 * - `readCard` returns `{ ok: false, status: 404 }` when the file is
 *   missing.
 * - Non-JSON payloads surface via `content`; parseable JSON surfaces via
 *   `document`.
 *
 * Workspace directories are derived deterministically from the realm URL
 * (`os.tmpdir() + /boxel-factory-workspaces/<slug>`), so re-runs against
 * the same realm reuse the same on-disk state.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { ensureJsonExtension } from './realm-operations.ts';
import { validateRealmRelativePath } from './realm-relative-path.ts';

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface WorkspaceReadResult {
  ok: boolean;
  /** 404 when the file does not exist; unset otherwise. */
  status?: number;
  /** Parsed JSON document (for .json files). */
  document?: Record<string, unknown>;
  /** Raw text content (for non-JSON files like .gts). */
  content?: string;
  error?: string;
}

export interface WorkspaceWriteResult {
  ok: boolean;
  error?: string;
}

export interface WorkspaceDeleteResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Workspace directory resolution
// ---------------------------------------------------------------------------

/**
 * Derive a stable workspace directory path for a target realm URL.
 *
 * The slug preserves the protocol so that `http://host/realm/` and
 * `https://host/realm/` map to distinct workspaces — otherwise two
 * unrelated realms could share state. Any character that isn't safe
 * in a filesystem path is replaced with `_`, e.g.
 * `http_localhost_4201_my-realm` from `http://localhost:4201/my-realm/`.
 * The slug is deterministic so repeated factory runs against the same
 * realm reuse the same on-disk workspace.
 */
export function resolveWorkspaceDir(realmUrl: string): string {
  let slug = realmUrl.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return join(tmpdir(), 'boxel-factory-workspaces', slug);
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Resolve a realm-relative `path` against `workspaceDir` and reject any
 * value that escapes the workspace.
 *
 * Defense in depth — every workspace-fs primitive routes its `path`
 * argument through here so an agent-supplied path can't escape via
 * absolute paths, `..` traversal, percent-encoded variants, or symlink
 * tricks even if the calling tool forgets to validate. Throws on
 * unsafe input; returns the absolute path on success.
 */
function resolveSafeWorkspacePath(workspaceDir: string, path: string): string {
  let validationError = validateRealmRelativePath(path);
  if (validationError) {
    throw new Error(validationError);
  }
  let absolute = resolve(workspaceDir, path);
  let rel = relative(resolve(workspaceDir), absolute);
  if (rel.startsWith('..') || rel === '..') {
    throw new Error(`Path "${path}" resolves outside the workspace directory.`);
  }
  return absolute;
}

// ---------------------------------------------------------------------------
// Read / Write / Delete
// ---------------------------------------------------------------------------

/**
 * Read a file from the local workspace. Attempts to parse the content as
 * JSON; falls back to returning raw text. Returns `status: 404` for
 * missing files (matching the convention callers already use to branch
 * on `client.read` results).
 */
export async function readCard(
  workspaceDir: string,
  path: string,
): Promise<WorkspaceReadResult> {
  let absolute: string;
  try {
    absolute = resolveSafeWorkspacePath(workspaceDir, path);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let text: string;
  try {
    text = await readFile(absolute, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, status: 404 };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    let document = JSON.parse(text) as Record<string, unknown>;
    return { ok: true, document };
  } catch {
    return { ok: true, content: text };
  }
}

/**
 * Write a file to the local workspace. Creates any missing parent
 * directories so callers don't need to care about directory layout.
 */
export async function writeCard(
  workspaceDir: string,
  path: string,
  content: string,
): Promise<WorkspaceWriteResult> {
  let absolute: string;
  try {
    absolute = resolveSafeWorkspacePath(workspaceDir, path);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Delete a file from the local workspace. Idempotent — treats missing
 * files as a successful delete.
 */
export async function deleteCard(
  workspaceDir: string,
  path: string,
): Promise<WorkspaceDeleteResult> {
  let absolute: string;
  try {
    absolute = resolveSafeWorkspacePath(workspaceDir, path);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    await rm(absolute, { force: true });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * `readCard` with automatic `.json` extension handling. Use when you
 * have a card id (`Issues/foo`) rather than a concrete file path.
 */
export async function readCardById(
  workspaceDir: string,
  cardId: string,
): Promise<WorkspaceReadResult> {
  return readCard(workspaceDir, ensureJsonExtension(cardId));
}

// ---------------------------------------------------------------------------
// Existence + stats
// ---------------------------------------------------------------------------

/**
 * Whether a file exists in the workspace. Swallows permission / I/O
 * errors and reports them as absence — callers that need the distinction
 * should use `readCard` directly.
 */
export async function workspaceFileExists(
  workspaceDir: string,
  path: string,
): Promise<boolean> {
  let absolute: string;
  try {
    absolute = resolveSafeWorkspacePath(workspaceDir, path);
  } catch {
    return false;
  }
  try {
    await stat(absolute);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the workspace directory exists on disk. Safe to call
 * repeatedly — creates parents if needed, no-ops if already present.
 */
export async function ensureWorkspaceDir(workspaceDir: string): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });
}

/**
 * Remove the workspace directory and everything under it, then recreate
 * it empty. Used when the target realm is known to be fresh (e.g. just
 * created by `bootstrapFactoryTargetRealm`), so any pre-existing local
 * state from a prior run is guaranteed to be orphaned.
 */
export async function resetWorkspaceDir(workspaceDir: string): Promise<void> {
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
}
