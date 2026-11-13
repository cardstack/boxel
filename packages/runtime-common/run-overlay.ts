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

// The realm route a run commits its overlay at: a `POST` carrying the run's
// token, with no body. It answers the files it saved, or a refusal that says
// why nothing was saved.
export const RUN_COMMIT_PATH = '/_run-commit';

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
  // The attempt's staged files would come to more than
  // `RUN_OVERLAY_MAX_BYTES`.
  | { kind: 'over-bytes'; limit: number }
  // The run isn't running, another attempt owns it, or its commit is claimed.
  | { kind: 'not-running' };

// One staged file, as the overlay holds it.
export interface RunOverlayFile {
  path: string;
  content: Uint8Array<ArrayBuffer>;
  // The MD5 of the content, as Postgres computes it, which a commit's claim
  // compares to the files it read.
  md5: string;
}

// The most bytes an attempt's overlay holds, all its staged files together.
// The overlay is stored inline and its commit reads every staged file into
// memory at once, so this bound is one the server can hold, whatever a run's
// `writes` cap and the realm's per-file limits allow.
export const RUN_OVERLAY_MAX_BYTES = 100 * 1024 * 1024;

// Stages `content` at `path` in the attempt's overlay. The run's row is
// locked for the check, so two calls racing to stage the run's last file
// under its cap can't both win, and the call is refused once the run has
// stopped running or another attempt owns it. Rewriting a path the attempt
// already staged replaces it and doesn't count against the cap again: the cap
// counts files written, not writes made. The overlay's bytes, with this file
// in place of any the attempt staged at its path, stay within `maxBytes`.
export async function stageRunOverlayFile(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
  path: string,
  content: Uint8Array,
  writesCap: number,
  maxBytes = RUN_OVERLAY_MAX_BYTES,
): Promise<RunOverlayStageResult> {
  let result = await stageRunOverlayFiles(
    dbAdapter,
    key,
    [{ path, content }],
    writesCap,
    maxBytes,
  );
  return result.kind === 'staged'
    ? { kind: 'staged', created: result.created.length > 0 }
    : result;
}

export type RunOverlayStageFilesResult =
  // Every file is staged. `created` names the paths the attempt had not
  // staged before.
  | { kind: 'staged'; created: string[] }
  | Exclude<RunOverlayStageResult, { kind: 'staged' }>;

// Stages every one of `files` in the attempt's overlay, or none of them: one
// transaction holds the run's row lock for the checks and every insert. The
// checks are `stageRunOverlayFile`'s, applied to the overlay as these files
// leave it: the files it holds, these included, stay within `writesCap`, and
// their bytes within `maxBytes`. A path named twice stages its last content.
export async function stageRunOverlayFiles(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
  files: { path: string; content: Uint8Array }[],
  writesCap: number,
  maxBytes = RUN_OVERLAY_MAX_BYTES,
): Promise<RunOverlayStageFilesResult> {
  let byPath = new Map(files.map(({ path, content }) => [path, content]));
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [run] = await txQuery([
      'SELECT state, attempt, commit_started_at FROM automation_runs WHERE id =',
      param(key.runId),
      'FOR UPDATE',
    ]);
    // A run whose commit is claimed has its files read for the batch; a file
    // staged after that would be acknowledged and never land.
    if (
      !run ||
      run.state !== 'running' ||
      Number(run.attempt) !== key.attempt ||
      run.commit_started_at != null
    ) {
      return { kind: 'not-running' } as const;
    }
    let rows = (await txQuery([
      'SELECT path, size FROM run_overlay_files WHERE run_id =',
      param(key.runId),
      'AND attempt =',
      param(key.attempt),
    ])) as { path: string; size: number | string }[];
    let stagedBefore = new Set(rows.map((row) => String(row.path)));
    let created = [...byPath.keys()].filter((path) => !stagedBefore.has(path));
    if (created.length > 0 && stagedBefore.size + created.length > writesCap) {
      return { kind: 'over-cap', cap: writesCap } as const;
    }
    let bytes = rows
      .filter((row) => !byPath.has(String(row.path)))
      .reduce((sum, row) => sum + Number(row.size), 0);
    for (let content of byPath.values()) {
      bytes += content.byteLength;
    }
    if (bytes > maxBytes) {
      return { kind: 'over-bytes', limit: maxBytes } as const;
    }
    for (let [path, content] of byPath) {
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
    }
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
    "SELECT path, encode(content, 'base64') AS content, md5(content) AS md5 FROM run_overlay_files WHERE run_id =",
    param(key.runId),
    'AND attempt =',
    param(key.attempt),
    'ORDER BY path',
  ]);
  return rows.map((row) => ({
    path: String(row.path),
    content: fromBase64(String(row.content)),
    md5: String(row.md5),
  }));
}

export type RunOverlayCommitClaim =
  // The commit is claimed, and the overlay holds exactly the files read.
  | { kind: 'claimed' }
  // The overlay changed since the files were read. Nothing is claimed.
  | { kind: 'overlay-changed' }
  // The run isn't running under this attempt, or its commit was claimed
  // before. `committed` says whether that earlier claim's batch landed.
  | { kind: 'refused'; committed: boolean; claimedByThisAttempt: boolean };

// Claims the attempt's one commit (`commit_started_at`), only while the run
// is running, owned by `key.attempt` and has never claimed one, and only when
// the attempt's overlay still holds exactly `files`, compared by path and
// content hash. The run's row is locked for both checks and the claim, and
// staging refuses a run whose commit is claimed, so the files read are the
// files the batch sends.
export async function claimRunOverlayCommit(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
  files: { path: string; md5: string }[],
): Promise<RunOverlayCommitClaim> {
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [run] = await txQuery([
      'SELECT state, attempt, commit_started_at, committed_at FROM automation_runs WHERE id =',
      param(key.runId),
      'FOR UPDATE',
    ]);
    if (
      !run ||
      run.state !== 'running' ||
      Number(run.attempt) !== key.attempt ||
      run.commit_started_at != null
    ) {
      return {
        kind: 'refused',
        committed: run?.committed_at != null,
        claimedByThisAttempt:
          run?.commit_started_at != null &&
          Number(run?.attempt) === key.attempt,
      } as const;
    }
    let rows = await txQuery([
      'SELECT path, md5(content) AS md5 FROM run_overlay_files WHERE run_id =',
      param(key.runId),
      'AND attempt =',
      param(key.attempt),
    ]);
    // Compared as maps of path to hash, so no ordering (the database's
    // collation or the script's) can make one set of files read as two.
    let now = new Map(rows.map((r) => [String(r.path), String(r.md5)]));
    let unchanged =
      now.size === files.length &&
      files.every(({ path, md5 }) => now.get(path) === md5);
    if (!unchanged) {
      return { kind: 'overlay-changed' } as const;
    }
    await txQuery([
      'UPDATE automation_runs SET commit_started_at = now() WHERE id =',
      param(key.runId),
    ]);
    return { kind: 'claimed' } as const;
  });
}

// Releases a commit claim whose batch is known to have written nothing: the
// batch refused an entry before writing any file. The run can then claim
// again, and a retry doesn't read the claim as an interrupted commit. A claim
// whose batch landed, or may have landed in part, is never released.
export async function releaseRunOverlayCommitClaim(
  dbAdapter: DBAdapter,
  key: RunOverlayKey,
): Promise<void> {
  await query(dbAdapter, [
    'UPDATE automation_runs SET commit_started_at = NULL WHERE id =',
    param(key.runId),
    "AND state = 'running' AND attempt =",
    param(key.attempt),
    'AND committed_at IS NULL',
  ]);
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
