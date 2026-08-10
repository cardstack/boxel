import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import fsExtra from 'fs-extra';
import { logger } from '@cardstack/runtime-common';

const { existsSync } = fsExtra;
const execFileAsync = promisify(execFile);
const log = logger('realm-server:history');

// Spike gate (BPM Phase 0R): the entire history sidecar is inert unless this
// env var is set, so a deployment that doesn't opt in carries zero new
// behavior — no jj repos are created, no adapter callbacks fire, and the
// /_history routes fall through to the realm's own 404.
export function isRealmHistoryEnabled(): boolean {
  return process.env.ENABLE_REALM_HISTORY === 'true';
}

const JJ_BIN = process.env.JJ_BIN ?? 'jj';
// A change id (reverse-hex) or commit id (hex) prefix. Strict validation is
// what lets us splice the id into a revset without any injection surface —
// revset operators are all punctuation.
const REVISION_ID = /^[0-9a-z]{1,64}$/;
const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const MAX_BUFFER = 64 * 1024 * 1024;

export interface HistoryEntry {
  changeId: string;
  commitId: string;
  timestamp: string;
  description: string;
  filesSummary: string[];
}

export interface RestorePlan {
  // Paths to write with the target revision's content (adds, modifications,
  // and the new side of renames/copies).
  writes: string[];
  // Paths present in the working copy but not the target (deletes and the old
  // side of renames).
  deletes: string[];
}

export function isValidRevisionId(id: string): boolean {
  return REVISION_ID.test(id);
}

export function isValidHistoryPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\0')) {
    return false;
  }
  return !path.split('/').some((segment) => segment === '..' || segment === '');
}

// Expands git-style rename summaries. jj prints renames/copies as
// `R {old => new}` or with a shared prefix/suffix, e.g. `R sub/{a => b}.txt`.
function expandRenamePath(raw: string): { from: string; to: string } {
  let match = raw.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (!match) {
    return { from: raw, to: raw };
  }
  let [, prefix, from, to, suffix] = match;
  return { from: `${prefix}${from}${suffix}`, to: `${prefix}${to}${suffix}` };
}

export class RealmHistoryManager {
  // One promise chain per realm dir: every jj invocation for a realm runs
  // strictly after the previous one. jj has its own working-copy lock, but a
  // snapshot must never race a seal in the same process.
  #queues: Map<string, Promise<unknown>> = new Map();
  #pendingSeals: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; paths: Set<string> }
  > = new Map();
  #debounceMs: number;

  constructor(opts?: { debounceMs?: number }) {
    this.#debounceMs = opts?.debounceMs ?? 1000;
  }

  // Called by the NodeAdapter after every file write/remove on an opted-in
  // realm. Debounced so one card save (instance JSON + companion files) seals
  // as a single jj change.
  noteMutation(dir: string, path: string): void {
    let pending = this.#pendingSeals.get(dir);
    if (pending) {
      clearTimeout(pending.timer);
      pending.paths.add(path);
    } else {
      pending = { paths: new Set([path]), timer: undefined as any };
      this.#pendingSeals.set(dir, pending);
    }
    pending.timer = setTimeout(() => {
      this.#pendingSeals.delete(dir);
      let summary = [...pending!.paths].slice(0, 3).join(', ');
      let extra =
        pending!.paths.size > 3 ? ` (+${pending!.paths.size - 3} more)` : '';
      this.seal(dir, `save: ${summary}${extra}`).catch((e) =>
        log.error(`failed to seal realm history at ${dir}: ${e.message}`),
      );
    }, this.#debounceMs);
  }

  // Cancels any pending debounce and seals immediately if the working copy is
  // dirty. Called before every read so history is always current.
  async flush(dir: string): Promise<void> {
    let pending = this.#pendingSeals.get(dir);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pendingSeals.delete(dir);
      let summary = [...pending.paths].slice(0, 3).join(', ');
      let extra =
        pending.paths.size > 3 ? ` (+${pending.paths.size - 3} more)` : '';
      await this.seal(dir, `save: ${summary}${extra}`);
    } else {
      // Even without a pending debounce the working copy may hold writes made
      // before the sidecar was enabled, or made around process restarts.
      await this.seal(dir, 'save');
    }
  }

  // Seals the working copy as one jj change when it is dirty. Returns the
  // sealed changeId, or undefined when there was nothing to seal.
  async seal(dir: string, message: string): Promise<string | undefined> {
    return this.#enqueue(dir, async () => {
      await this.#ensureRepoUnqueued(dir);
      // Any jj invocation snapshots the working copy first; this one also
      // tells us whether there is anything to commit.
      let { stdout } = await this.#jj(dir, [
        'log',
        '--no-graph',
        '-r',
        '@',
        '-T',
        'if(empty, "empty", "dirty")',
      ]);
      if (stdout.trim() !== 'dirty') {
        return undefined;
      }
      await this.#jj(dir, ['commit', '-m', message]);
      let sealed = await this.#jj(dir, [
        'log',
        '--no-graph',
        '-r',
        '@-',
        '-T',
        'change_id',
      ]);
      return sealed.stdout.trim();
    });
  }

  async list(dir: string): Promise<HistoryEntry[]> {
    await this.flush(dir);
    return this.#enqueue(dir, async () => {
      let template =
        `change_id ++ "${FIELD_SEP}" ++ commit_id ++ "${FIELD_SEP}" ++ ` +
        `committer.timestamp().format("%Y-%m-%dT%H:%M:%S%z") ++ "${FIELD_SEP}" ++ ` +
        `description.first_line() ++ "${FIELD_SEP}" ++ ` +
        `if(empty, "empty", "change") ++ "${FIELD_SEP}" ++ ` +
        `diff.summary() ++ "${RECORD_SEP}"`;
      let { stdout } = await this.#jj(dir, [
        'log',
        '--no-graph',
        '-r',
        '::@ ~ root()',
        '-T',
        template,
      ]);
      let entries: HistoryEntry[] = [];
      for (let record of stdout.split(RECORD_SEP)) {
        if (!record.trim()) {
          continue;
        }
        let [changeId, commitId, timestamp, description, emptiness, summary] =
          record.split(FIELD_SEP);
        if (emptiness === 'empty') {
          // the (usually empty) working-copy change on top of history
          continue;
        }
        entries.push({
          changeId,
          commitId,
          timestamp,
          description,
          filesSummary: (summary ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        });
      }
      return entries;
    });
  }

  async fileAt(
    dir: string,
    revisionId: string,
    path: string,
  ): Promise<Buffer | undefined> {
    if (!isValidRevisionId(revisionId) || !isValidHistoryPath(path)) {
      return undefined;
    }
    return this.#enqueue(dir, async () => {
      await this.#ensureRepoUnqueued(dir);
      try {
        let { stdout } = await execFileAsync(
          JJ_BIN,
          [...this.#baseArgs(), 'file', 'show', '-r', revisionId, path],
          { cwd: dir, maxBuffer: MAX_BUFFER, encoding: 'buffer' },
        );
        return stdout as unknown as Buffer;
      } catch (e: any) {
        if (
          /No such path|doesn't exist|Revision.*doesn't exist/i.test(
            e.stderr?.toString() ?? '',
          )
        ) {
          return undefined;
        }
        throw e;
      }
    });
  }

  // The changes needed to make the working copy match `revisionId`, expressed
  // as paths to (re)write from that revision plus paths to delete. The caller
  // replays these through the Realm's own write path — this module never
  // mutates realm files itself.
  async restorePlan(dir: string, revisionId: string): Promise<RestorePlan> {
    if (!isValidRevisionId(revisionId)) {
      throw new Error(`invalid revision id`);
    }
    await this.flush(dir);
    return this.#enqueue(dir, async () => {
      let { stdout } = await this.#jj(dir, [
        'diff',
        '--summary',
        '--from',
        '@',
        '--to',
        revisionId,
      ]);
      let writes: string[] = [];
      let deletes: string[] = [];
      for (let line of stdout.split('\n')) {
        if (!line.trim()) {
          continue;
        }
        let match = line.match(/^([MADRC]) (.*)$/);
        if (!match) {
          throw new Error(`unrecognized diff summary line: ${line}`);
        }
        let [, status, rawPath] = match;
        switch (status) {
          case 'M':
          case 'A':
            writes.push(rawPath);
            break;
          case 'D':
            deletes.push(rawPath);
            break;
          case 'R': {
            let { from, to } = expandRenamePath(rawPath);
            writes.push(to);
            deletes.push(from);
            break;
          }
          case 'C': {
            let { to } = expandRenamePath(rawPath);
            writes.push(to);
            break;
          }
        }
      }
      return { writes, deletes };
    });
  }

  async #ensureRepoUnqueued(dir: string): Promise<void> {
    if (existsSync(join(dir, '.jj'))) {
      return;
    }
    log.info(`initializing jj history repo at ${dir}`);
    // Colocated git backend: jj gets its storage and the embedded git repo is
    // the future async GitHub-mirror source.
    await this.#jj(dir, ['git', 'init', '--colocate']);
  }

  #baseArgs(): string[] {
    return [
      '--no-pager',
      '--color=never',
      '--config',
      'user.name="realm-history"',
      '--config',
      'user.email="realm-history@boxel.localhost"',
    ];
  }

  async #jj(
    dir: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(JJ_BIN, [...this.#baseArgs(), ...args], {
      cwd: dir,
      maxBuffer: MAX_BUFFER,
    });
  }

  async #enqueue<T>(dir: string, task: () => Promise<T>): Promise<T> {
    let prior = this.#queues.get(dir) ?? Promise.resolve();
    let run = prior.then(task, task);
    // Park the chain on a settled promise so one failure doesn't poison the
    // queue forever; the caller still sees the rejection via `run`.
    this.#queues.set(
      dir,
      run.catch(() => undefined),
    );
    return run;
  }
}

let manager: RealmHistoryManager | undefined;
export function getRealmHistoryManager(): RealmHistoryManager {
  if (!manager) {
    manager = new RealmHistoryManager();
  }
  return manager;
}
