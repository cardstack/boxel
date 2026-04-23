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
import { dirname, join } from 'node:path';

import { ensureJsonExtension } from './realm-operations';

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
 * Slug derivation strips the protocol and replaces any characters that
 * aren't safe in a filesystem path with `_`, yielding e.g.
 * `localhost_4201_my-realm_` from `http://localhost:4201/my-realm/`.
 * The slug is deterministic so repeated factory runs against the same
 * realm reuse the same on-disk workspace.
 */
export function resolveWorkspaceDir(realmUrl: string): string {
  let slug = realmUrl
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return join(tmpdir(), 'boxel-factory-workspaces', slug);
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
  let absolute = join(workspaceDir, path);

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
  let absolute = join(workspaceDir, path);
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
  let absolute = join(workspaceDir, path);
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

// ---------------------------------------------------------------------------
// Card conveniences (auto .json extension)
// ---------------------------------------------------------------------------

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

/**
 * `writeCard` with automatic `.json` extension handling.
 */
export async function writeCardById(
  workspaceDir: string,
  cardId: string,
  content: string,
): Promise<WorkspaceWriteResult> {
  return writeCard(workspaceDir, ensureJsonExtension(cardId), content);
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
  try {
    await stat(join(workspaceDir, path));
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
