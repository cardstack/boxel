// The run overlay (ADR 027 §1.2): the files an automation run has written,
// staged on the realm server instead of in the realm. A run's writes don't
// reach the realm until the run commits, and the run's own reads read
// through the overlay, so the run sees what it wrote and nobody else does.
//
// The overlay lives in Postgres (`run_overlay_files`), so every realm-server
// instance reads the same one, whichever instance a run's call lands on. A
// row is one staged file: the run, the attempt that staged it, the file's
// realm-local path and its bytes, inline. Binary content is stored inline
// like text: a run writes at most its `writes` cap of files, each within the
// realm's limit for its kind, so a run's overlay holds at most that many
// files of that size, and the overlay is gone when the run ends.
//
// An overlay is per attempt. A retry that takes the run over starts from an
// empty overlay, so writes the replaced attempt staged never reach the
// newer attempt's commit, and the run row's start drops them. Every way a run
// ends (finished, canceled, abandoned) discards its overlay in the same
// statement that ends it (`automation-runs.ts`), and deleting the run row
// deletes its overlay with it.
//
// The table is server-only and excluded from the SQLite schema dump.

import type { DBAdapter } from './db.ts';
import { param, query } from './expression.ts';

// The attempt of a run whose overlay is read or written: the token's run and
// attempt.
export interface RunOverlayKey {
  runId: string;
  attempt: number;
}

export type RunOverlayStageResult =
  // The file is staged. `created` is false when it replaced a file the
  // attempt had already staged at the same path.
  | { kind: 'staged'; created: boolean }
  // Staging another file would pass the run's `writes` cap.
  | { kind: 'over-cap'; cap: number }
  // The run isn't running, or another attempt owns it.
  | { kind: 'not-running' };

// One staged file, as the overlay holds it.
export interface RunOverlayFile {
  path: string;
  content: Uint8Array<ArrayBuffer>;
}

// Stages `content` at `path` in the attempt's overlay. The run's row is
// locked for the check, so two calls racing to stage the run's last file
// under its cap can't both win, and the call is refused once the run has
// stopped running or another attempt owns it. Rewriting a path the attempt
// already staged replaces it and doesn't count against the cap again: the cap
// counts files written, not writes made.
export async function stageRunOverlayFile(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
  path: string,
  content: Uint8Array,
  writesCap: number,
): Promise<RunOverlayStageResult> {
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [run] = await txQuery([
      'SELECT state, attempt FROM automation_runs WHERE id =',
      param(key.runId),
      'FOR UPDATE',
    ]);
    if (
      !run ||
      run.state !== 'running' ||
      Number(run.attempt) !== key.attempt
    ) {
      return { kind: 'not-running' } as const;
    }
    let [{ files, staged }] = (await txQuery([
      'SELECT count(*)::int AS files, count(*) FILTER (WHERE path =',
      param(path),
      ')::int AS staged FROM run_overlay_files WHERE run_id =',
      param(key.runId),
      'AND attempt =',
      param(key.attempt),
    ])) as { files: number; staged: number }[];
    let created = Number(staged) === 0;
    if (created && Number(files) >= writesCap) {
      return { kind: 'over-cap', cap: writesCap } as const;
    }
    await txQuery([
      'INSERT INTO run_overlay_files (run_id, attempt, path, content, size) VALUES (',
      param(key.runId),
      ',',
      param(key.attempt),
      ',',
      param(path),
      ', decode(',
      param(toBase64(content)),
      ", 'base64'),",
      param(content.byteLength),
      ') ON CONFLICT (run_id, attempt, path) DO UPDATE SET content = EXCLUDED.content, size = EXCLUDED.size, updated_at = now()',
    ]);
    return { kind: 'staged', created } as const;
  });
}

// The bytes the attempt staged at `path`, or undefined when it staged
// nothing there.
export async function readRunOverlayFile(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
  path: string,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  let [row] = await query(dbAdapter, [
    "SELECT encode(content, 'base64') AS content FROM run_overlay_files WHERE run_id =",
    param(key.runId),
    'AND attempt =',
    param(key.attempt),
    'AND path =',
    param(path),
  ]);
  return row ? fromBase64(String(row.content)) : undefined;
}

// The realm-local paths the attempt staged under the directory `dir` (a
// realm-local path with no leading or trailing slash; '' for the realm
// root), at any depth, in path order.
export async function runOverlayPathsUnder(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
  dir: string,
): Promise<string[]> {
  let rows = await query(dbAdapter, [
    'SELECT path FROM run_overlay_files WHERE run_id =',
    param(key.runId),
    'AND attempt =',
    param(key.attempt),
    ...(dir ? ['AND starts_with(path,', param(`${dir}/`), ')'] : []),
    'ORDER BY path',
  ]);
  return rows.map((row) => String(row.path));
}

// A path the attempt staged that `path` can't sit beside: a file at one of
// the directories `path` is under, or a file under `path` as a directory. A
// realm can't hold both, so the commit would fail. Undefined when there is
// none.
export async function runOverlayPathClash(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
  path: string,
): Promise<string | undefined> {
  let parents = path
    .split('/')
    .slice(0, -1)
    .map((_, i, parts) => parts.slice(0, i + 1).join('/'));
  let [row] = await query(dbAdapter, [
    'SELECT path FROM run_overlay_files WHERE run_id =',
    param(key.runId),
    'AND attempt =',
    param(key.attempt),
    'AND (starts_with(path,',
    param(`${path}/`),
    ')',
    ...parents.flatMap((parent) => ['OR path =', param(parent)]),
    ') ORDER BY path LIMIT 1',
  ]);
  return row ? String(row.path) : undefined;
}

// Every file the attempt staged, in path order.
export async function runOverlayFiles(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
): Promise<RunOverlayFile[]> {
  let rows = await query(dbAdapter, [
    "SELECT path, encode(content, 'base64') AS content FROM run_overlay_files WHERE run_id =",
    param(key.runId),
    'AND attempt =',
    param(key.attempt),
    'ORDER BY path',
  ]);
  return rows.map((row) => ({
    path: String(row.path),
    content: fromBase64(String(row.content)),
  }));
}

// Discards every file any attempt of the run staged. Returns how many were
// discarded.
export async function discardRunOverlay(
  dbAdapter: DBAdapter,
  runId: string,
): Promise<number> {
  let rows = await query(dbAdapter, [
    'DELETE FROM run_overlay_files WHERE run_id =',
    param(runId),
    'RETURNING path',
  ]);
  return rows.length;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  // Postgres's base64 encoding breaks lines every 76 characters.
  let binary = atob(text.replace(/\s/g, ''));
  let bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
