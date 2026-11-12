// Maintenance of a realm's repo. The recorder writes every object loose and
// captures every write, including the intermediate states a coalesced
// revision drops, so a repo collects loose files that no revision uses. A
// maintenance pass, run only while the realm's recorder holds nothing
// captured:
//
// 1. `git repack -d` packs the loose objects HEAD reaches into a new pack and
//    removes their loose copies. It packs nothing HEAD doesn't reach, so the
//    captured objects no revision uses stay loose for step 3. A repo with
//    `consolidateAtPacks` packs or more is repacked with `-a`, into one pack:
//    every pack holds only objects HEAD reaches, since nothing else is ever
//    packed and history is never rewritten, so `-a` drops nothing.
//    `--geometric` would bound the pack count too, but it packs loose objects
//    whether or not anything reaches them, where prune never removes them.
//    A `git pack-objects` that outlives its `git repack`, as one does when
//    the repack is killed, leaves its pack under a temporary name
//    (`objects/pack/.tmp-*`). Git reads that pack, but a dumb HTTP clone
//    doesn't. Once the pack is an hour old, the next pass repacks with `-a`,
//    which puts its objects in a pack of a regular name, then removes it.
// 2. `git commit-graph write --reachable --split --changed-paths` adds the
//    commits since the last write to the commit-graph, with changed-path
//    Bloom filters, so a path-filtered `git log` reads one file instead of a
//    tree per commit. It also runs on its own after every
//    `COMMIT_GRAPH_EVERY` revisions, so a busy realm's graph stays current
//    between passes.
// 3. `git prune --expire=<prune expiry>` removes the loose objects HEAD
//    doesn't reach that are older than the expiry. The expiry protects an
//    object another task is writing for a commit it hasn't made yet, as two
//    tasks can during a lease handover. Captured objects younger than the
//    expiry survive the pass, and the pass reports how many are left.
// 4. `git update-server-info` writes `info/refs` and `objects/info/packs`,
//    the files a clone over git's dumb HTTP protocol reads, so a repo can be
//    cloned read-only from a static file server. Written last, `info/refs`
//    also records the HEAD the last complete pass saw.
//
// Readers on other hosts never see an object disappear: repack removes a
// loose copy only once its pack is in place, and prune removes only objects
// HEAD doesn't reach. A reader that has listed the packs before a `-a`
// repack removed them finds the object missing, and git looks for its packs
// again before it gives up.

import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { logger } from '@cardstack/runtime-common';
import { MAIN_REF, readMain, runGit } from './repo-format.ts';

const log = logger('realm-historian:maintenance');

// How old an object HEAD doesn't reach must be before prune removes it.
export const DEFAULT_PRUNE_EXPIRY_MS = 60 * 60_000;

// How many revisions a busy realm records before its commit-graph is
// written again, outside a pass.
export const COMMIT_GRAPH_EVERY = 100;

// The pack count at which a pass repacks everything into one pack.
export const DEFAULT_CONSOLIDATE_AT_PACKS = 32;

// Git holds the commit-graph's lock for the length of one write, and a
// pack's temporary name for the length of one repack. A lock or a temporary
// pack older than this was left by a git that was killed, or that outlived
// the git that ran it. A lock left behind would fail every later write.
const STALE_AFTER_MS = 60 * 60_000;

const COMMIT_GRAPH_LOCK = [
  'objects',
  'info',
  'commit-graphs',
  'commit-graph-chain.lock',
];

export interface MaintenanceOptions {
  // Aborting it ends the pass with an `AbortError`, and leaves a repo the
  // next pass maintains. The step in progress stops, unless it is the
  // repack, which runs to its end first: SIGTERM stops `git repack` but not
  // the `git pack-objects` it runs.
  signal?: AbortSignal;
  pruneExpiryMs?: number;
  consolidateAtPacks?: number;
}

// What `git count-objects -v` reports, with sizes in bytes.
export interface ObjectCounts {
  looseObjects: number;
  looseBytes: number;
  packs: number;
  packedObjects: number;
  packBytes: number;
}

export interface MaintenanceResult {
  before: ObjectCounts;
  after: ObjectCounts;
  // Whether the repack put every pack into one.
  consolidated: boolean;
  // The loose objects HEAD doesn't reach that the pass removed.
  pruned: number;
  // How long each step took, in milliseconds.
  durations: {
    repack: number;
    commitGraph: number;
    prune: number;
    updateServerInfo: number;
    total: number;
  };
}

// Runs one maintenance pass over the repo.
export async function maintainRepo(
  gitDir: string,
  {
    signal,
    pruneExpiryMs = DEFAULT_PRUNE_EXPIRY_MS,
    consolidateAtPacks = DEFAULT_CONSOLIDATE_AT_PACKS,
  }: MaintenanceOptions = {},
): Promise<MaintenanceResult> {
  let started = performance.now();
  let before = await countObjects(gitDir, signal);
  let leftBehind = await staleTemporaryPackFiles(gitDir);
  // A temporary pack with its index is one git reads, and it may hold the
  // only copy of objects HEAD reaches: `-a` copies them into the new pack
  // before the temporary one is removed.
  let consolidated =
    before.packs >= consolidateAtPacks ||
    leftBehind.some((name) => name.endsWith('.idx'));

  let step = performance.now();
  await runGit(gitDir, [
    'repack',
    '-d',
    ...(consolidated ? ['-a'] : []),
    '-q',
    // Repack runs `update-server-info` itself unless told not to. Only the
    // pass's last step may write `info/refs`, so it names a HEAD only once
    // every step has run.
    '-n',
    // A bare repo writes a bitmap with every `-a` repack by default. It
    // speeds up serving fetches, which history doesn't do, and adds a file.
    '--no-write-bitmap-index',
  ]);
  let repack = performance.now() - step;
  signal?.throwIfAborted();
  for (let name of leftBehind) {
    log.warn(
      `removing ${join(gitDir, 'objects', 'pack', name)}, left by a git that didn't finish`,
    );
    await unlink(join(gitDir, 'objects', 'pack', name)).catch((error) => {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  step = performance.now();
  await writeCommitGraph(gitDir, { signal });
  let commitGraph = performance.now() - step;

  step = performance.now();
  // `prune -v` lists each object it removes as `<id> <type>`, and also names
  // the stale temporary files it removes, which aren't objects.
  let pruned = (
    await runGit(
      gitDir,
      ['prune', '-v', `--expire=${expiryDate(pruneExpiryMs)}`],
      { signal },
    )
  )
    .toString()
    .split('\n')
    .filter((line) => /^[0-9a-f]{40} /.test(line)).length;
  let prune = performance.now() - step;

  step = performance.now();
  await runGit(gitDir, ['update-server-info'], { signal });
  let updateServerInfo = performance.now() - step;

  let after = await countObjects(gitDir, signal);
  return {
    before,
    after,
    consolidated,
    pruned,
    durations: {
      repack,
      commitGraph,
      prune,
      updateServerInfo,
      total: performance.now() - started,
    },
  };
}

// Adds the commits HEAD reaches that the commit-graph lacks, as a new layer
// with changed-path Bloom filters, merging layers as git's split strategy
// decides.
export async function writeCommitGraph(
  gitDir: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<void> {
  await removeStaleLock(join(gitDir, ...COMMIT_GRAPH_LOCK));
  await runGit(
    gitDir,
    [
      'commit-graph',
      'write',
      '--reachable',
      '--split',
      '--changed-paths',
      '--no-progress',
    ],
    { signal },
  );
}

// Whether the last complete pass saw the repo's current HEAD: true for a
// repo with no revision, or no repo at all, which have nothing to maintain.
export async function isMaintained(gitDir: string): Promise<boolean> {
  if (!(await exists(gitDir))) {
    return true;
  }
  let head = await readMain(gitDir);
  return head === undefined || head === (await maintainedHead(gitDir));
}

// The HEAD `info/refs` names: what HEAD was when a pass last completed.
export async function maintainedHead(
  gitDir: string,
): Promise<string | undefined> {
  let refs: string;
  try {
    refs = await readFile(join(gitDir, 'info', 'refs'), 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  for (let line of refs.split('\n')) {
    let [id, ref] = line.split('\t');
    if (ref === MAIN_REF) {
      return id;
    }
  }
  return undefined;
}

export async function countObjects(
  gitDir: string,
  signal?: AbortSignal,
): Promise<ObjectCounts> {
  let fields = new Map<string, number>();
  for (let line of (await runGit(gitDir, ['count-objects', '-v'], { signal }))
    .toString()
    .split('\n')) {
    let [name, value] = line.split(': ');
    if (value !== undefined) {
      fields.set(name, Number(value));
    }
  }
  let field = (name: string) => fields.get(name) ?? 0;
  return {
    looseObjects: field('count'),
    looseBytes: field('size') * 1024,
    packs: field('packs'),
    packedObjects: field('in-pack'),
    packBytes: field('size-pack') * 1024,
  };
}

// The expiry as a date git reads: `now`, or a number of seconds ago.
function expiryDate(expiryMs: number): string {
  return expiryMs <= 0 ? 'now' : `${Math.ceil(expiryMs / 1000)}.seconds.ago`;
}

async function removeStaleLock(path: string): Promise<void> {
  let modified: number;
  try {
    modified = (await stat(path)).mtimeMs;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (Date.now() - modified < STALE_AFTER_MS) {
    return;
  }
  log.warn(
    `removing ${path}, left ${Math.round((Date.now() - modified) / 60_000)} minutes ago by a git that didn't finish`,
  );
  await unlink(path).catch((error) => {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  });
}

// The files in `objects/pack` with git's temporary pack name that are older
// than `STALE_AFTER_MS`.
async function staleTemporaryPackFiles(gitDir: string): Promise<string[]> {
  let directory = join(gitDir, 'objects', 'pack');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  let stale: string[] = [];
  for (let name of names.filter((name) => name.startsWith('.tmp-'))) {
    try {
      let { mtimeMs } = await stat(join(directory, name));
      if (Date.now() - mtimeMs >= STALE_AFTER_MS) {
        stale.push(name);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return stale;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
