import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isIgnoredTreeSegment } from '@cardstack/deck/tree-hash';

// Tier 2 of the live-tree design (docs/deck-live-autopublish.md): seal-grained
// history UNDER the auto-publish loop. Tier 1 — the content-addressed store —
// already makes every settled state immutable and addressable; what it cannot
// do is name the states BETWEEN publishes, attribute them, or serve a state
// that was never published. A history backend supplies exactly those three:
//
//   seal   — turn the current working tree into a named, immutable state
//   fileAt — serve any sealed state, published or not
//   restore— move the live tree back to a sealed state
//
// The contract is deliberately narrow. Version registration stays in the
// store's meta.json (bookmarks are NOT used).
//
// A changeId is OPAQUE to every caller: deckd produces jj change ids,
// but nothing outside this package may assume that.

export interface HistoryEntry {
  changeId: string;
  commitId: string;
  timestamp: string;
  description: string;
  filesSummary: string[];
  // The seal's author, when one was supplied. Undefined for the default
  // identity — the debounced auto-sealer and restores — because surfacing
  // the bot as an actor would be noise, not attribution.
  author?: string;
}

export interface RestorePlan {
  // Paths to write with the target revision's content (adds, modifications,
  // and the new side of renames/copies).
  writes: string[];
  // Paths present in the live tree but not in the target (deletes and the
  // old side of renames).
  deletes: string[];
}

export interface HistoryActor {
  name: string;
  email?: string;
}

export interface HistoryBackend {
  // Which implementation is live — reported by the server's capability
  // block. Production is deckd.
  readonly kind: 'deckd';
  // Creates a named branch workspace backed by the source Realm's one shared
  // `.deck/history/repo`. `revisionId` is the exact source Checkpoint parent.
  fork(
    sourceDir: string,
    targetDir: string,
    revisionId: string,
    workspaceName: string,
  ): Promise<void>;
  // Removes a prepared named branch workspace without deleting shared
  // History ancestry. Used when later index/ref preparation fails.
  discard(dir: string): Promise<void>;
  // Notes a file mutation for the debounced sealer. Fire-and-forget: a
  // burst of saves becomes ONE seal.
  noteMutation(dir: string, path: string): void;
  // Cancels any pending debounce and seals immediately when the tree is
  // dirty. Returns the sealed changeId, or undefined when there was
  // nothing to seal.
  flush(dir: string): Promise<string | undefined>;
  seal(
    dir: string,
    message: string,
    actor?: HistoryActor,
  ): Promise<string | undefined>;
  // Seals a tree already materialized by the Repository three-way merge as
  // one History change with exact target and source parents.
  merge(
    dir: string,
    targetRevisionId: string,
    sourceRevisionId: string,
    message: string,
    actor?: HistoryActor,
  ): Promise<string>;
  // The newest sealed changeId (not the working copy). Undefined before the
  // first seal.
  head(dir: string): Promise<string | undefined>;
  /**
   * Newest-first.
   * - `limit` caps how many seals are materialised.
   * - `before` (change/commit id): only seals strictly older than this tip.
   * - `flush: false` skips sealing the working copy first — required for
   *   cheap read paths like `/_activity` that must not pay seal cost.
   */
  list(
    dir: string,
    options?: { limit?: number; before?: string; flush?: boolean },
  ): Promise<HistoryEntry[]>;
  fileAt(
    dir: string,
    revisionId: string,
    path: string,
  ): Promise<Buffer | undefined>;
  restorePlan(dir: string, revisionId: string): Promise<RestorePlan>;
  // The full tree listing at a revision. This is part of the current deckd
  // contract because a restore must distinguish an empty tree from a daemon
  // that cannot enumerate one.
  fileListAt(dir: string, revisionId: string): Promise<string[]>;
  // Drops pending debounce timers so a process can exit promptly.
  close(): void;
}

// A change id (reverse-hex) or commit id (hex) prefix. Strict validation is
// what lets an id be spliced into a revset with no injection surface —
// revset operators are all punctuation.
const REVISION_ID = /^[0-9a-z]{1,64}$/;
export function isValidRevisionId(id: string): boolean {
  return REVISION_ID.test(id);
}

export function isValidHistoryPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\0')) {
    return false;
  }
  return !path.split('/').some((segment) => segment === '..' || segment === '');
}

export interface RestoreResult {
  changeId: string;
  written: string[];
  deleted: string[];
  // The seal the tree was on before the restore. A restore never rewrites
  // history: the state you left is sealed first, so a restore is itself
  // undoable.
  from?: string;
}

// Moves the live tree back to a sealed state by REPLAYING it as ordinary
// file writes — never by rewinding the history. The watcher then sees a
// normal change and auto-publishes it as the next dev version, so a restore
// is an edit like any other and the store's immutability holds.
export async function applyRestore(
  backend: HistoryBackend,
  dir: string,
  revisionId: string,
): Promise<RestoreResult> {
  if (!isValidRevisionId(revisionId)) {
    throw new Error(`invalid revision id: ${JSON.stringify(revisionId)}`);
  }
  // restorePlan flushes first — the state being left behind gets sealed
  // before anything is overwritten.
  let plan = await backend.restorePlan(dir, revisionId);
  let from = await backend.head(dir);
  let written: string[] = [];
  for (let path of plan.writes.filter(isRestorable)) {
    if (!isValidHistoryPath(path)) {
      throw new Error(`refusing to restore unsafe path: ${path}`);
    }
    let bytes = await backend.fileAt(dir, revisionId, path);
    if (bytes === undefined) {
      throw new Error(`${path} is missing from ${revisionId}`);
    }
    let destination = join(dir, ...path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    written.push(path);
  }
  let deleted: string[] = [];
  for (let path of plan.deletes.filter(isRestorable)) {
    if (!isValidHistoryPath(path)) {
      throw new Error(`refusing to delete unsafe path: ${path}`);
    }
    await rm(join(dir, ...path.split('/')), { force: true });
    deleted.push(path);
  }
  return { changeId: revisionId, written, deleted, from };
}

// A restore replays TREE content. Anything the tree hash ignores — a
// depot's `.deck` store above all — is machinery that happens to sit in the
// same directory, and rewinding it would undo published versions. Backends
// exclude it from sealing too; this is the belt to that suspenders, and it
// also protects trees sealed before those rules existed.
function isRestorable(path: string): boolean {
  return !path.split('/').some((segment) => isIgnoredTreeSegment(segment));
}

// Per-directory serialization: every history
// operation on a tree runs strictly after the previous one.
export class DirQueue {
  #queues: Map<string, Promise<unknown>> = new Map();

  run<T>(dir: string, task: () => Promise<T>): Promise<T> {
    let prior = this.#queues.get(dir) ?? Promise.resolve();
    let next = prior.then(task, task);
    // Park the chain on a settled promise so one failure doesn't poison the
    // queue forever; the caller still sees the rejection via `next`.
    this.#queues.set(
      dir,
      next.catch(() => undefined),
    );
    return next;
  }
}

// The debounced sealer: a burst of saves collapses into
// one seal whose message names the paths that moved.
export class SealDebouncer {
  #pending: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; paths: Set<string> }
  > = new Map();
  #debounceMs: number;
  #seal: (dir: string, message: string) => Promise<unknown>;
  #onError?: (error: unknown) => void;

  constructor(options: {
    debounceMs: number;
    seal: (dir: string, message: string) => Promise<unknown>;
    onError?: (error: unknown) => void;
  }) {
    this.#debounceMs = options.debounceMs;
    this.#seal = options.seal;
    this.#onError = options.onError;
  }

  note(dir: string, path: string): void {
    let pending = this.#pending.get(dir);
    if (pending) {
      clearTimeout(pending.timer);
      pending.paths.add(path);
    } else {
      pending = { paths: new Set([path]), timer: undefined as never };
      this.#pending.set(dir, pending);
    }
    pending.timer = setTimeout(() => {
      this.#pending.delete(dir);
      this.#seal(dir, messageFor(pending!.paths)).catch((error) =>
        this.#onError?.(error),
      );
    }, this.#debounceMs);
    // Never hold the process open for a debounce timer.
    pending.timer.unref?.();
  }

  // Returns the message for any pending burst, cancelling its timer, or
  // undefined when nothing was pending.
  take(dir: string): string | undefined {
    let pending = this.#pending.get(dir);
    if (!pending) {
      return undefined;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(dir);
    return messageFor(pending.paths);
  }

  close(): void {
    for (let pending of this.#pending.values()) {
      clearTimeout(pending.timer);
    }
    this.#pending.clear();
  }
}

function messageFor(paths: Set<string>): string {
  let summary = [...paths].slice(0, 3).join(', ');
  let extra = paths.size > 3 ? ` (+${paths.size - 3} more)` : '';
  return `save: ${summary}${extra}`;
}
