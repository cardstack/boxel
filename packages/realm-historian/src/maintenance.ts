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
// On one host, a reader never misses an object during a pass: repack
// removes a loose copy only once its pack is in place, prune removes only
// objects HEAD doesn't reach, and a reader that finds an object missing
// looks for its packs again before it gives up. A reader on another host of
// the shared file system can go on seeing a cached listing of the pack
// directory, or a pack that a `-a` repack removed, for as long as its client
// caches them. Whether reads there stay whole through a pass is measured on
// the deployed file system, not assumed here.
//
// `maintenanceKinds` schedules the work as background work on each realm
// (`background.ts`):
//
// * `maintain` runs a pass once a realm has committed nothing for `quietMs`
//   after committing a revision, and when the task loads the realm, so a
//   repo a crash left unmaintained gets its pass. It also comes due every
//   `everyMs`, so a realm that commits more often than `quietMs` all day
//   still gets a pass, in a moment between its revisions. Its check skips a
//   realm whose `info/refs` already names HEAD. A pass that leaves loose objects
//   younger than the prune expiry runs again once they have passed it, so a
//   realm that goes quiet after a burst doesn't keep its captures. The pass
//   records when in the repo (`realm-historian-prune-after`), so the rerun
//   survives a restart and a handover of the realm to another task.
// * `commit-graph` writes the commit-graph after every `COMMIT_GRAPH_EVERY`
//   revisions, so a busy realm's path-filtered reads stay fast between
//   passes.
//
// Each pass logs one line of `key=value` fields (`passLogLine`): the realm,
// what made it due, how it ended, each step's duration, and the object
// counts before and after.

import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { logger } from '@cardstack/runtime-common';
import { MAIN_REF, readMain, repoPath, runGit } from './repo-format.ts';
import type { BackgroundKind } from './background.ts';

const log = logger('realm-historian:maintenance');

// How old an object HEAD doesn't reach must be before prune removes it.
export const DEFAULT_PRUNE_EXPIRY_MS = 60 * 60_000;

// How many revisions a busy realm records before its commit-graph is
// written again, outside a pass.
export const COMMIT_GRAPH_EVERY = 100;

// The pack count at which a pass repacks everything into one pack.
export const DEFAULT_CONSOLIDATE_AT_PACKS = 32;

// How long a realm commits nothing, after committing a revision, before a
// pass runs on it.
export const DEFAULT_MAINTAIN_AFTER_QUIET_MS = 5 * 60_000;

// How long after its last pass a realm that never goes quiet gets another.
export const DEFAULT_MAINTAIN_EVERY_MS = 60 * 60_000;

// Git holds the commit-graph's lock for the length of one write, and a
// pack's temporary name for the length of one repack. A lock or a temporary
// pack older than this was left by a git that was killed, or that outlived
// the git that ran it. A lock left behind would fail every later write.
const STALE_AFTER_MS = 60 * 60_000;

// The file in a repo's directory recording when the captures its last pass
// kept pass the prune expiry. Git reads no file of this name, and a clone
// doesn't copy it.
const PRUNE_AFTER_FILE = 'realm-historian-prune-after';

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

export interface MaintenanceKindsOptions {
  historyRoot: string;
  pruneExpiryMs?: number;
  consolidateAtPacks?: number;
  quietMs?: number;
  everyMs?: number;
  commitGraphEvery?: number;
}

// What made a pass due: HEAD has moved since the last complete pass, or the
// last pass left loose objects the prune expiry kept.
export type PassTrigger = 'head-moved' | 'prune-rerun';

export type PassOutcome = 'done' | 'failed' | 'aborted';

// The background work that maintains each realm's repo.
export function maintenanceKinds({
  historyRoot,
  pruneExpiryMs = DEFAULT_PRUNE_EXPIRY_MS,
  consolidateAtPacks = DEFAULT_CONSOLIDATE_AT_PACKS,
  quietMs = DEFAULT_MAINTAIN_AFTER_QUIET_MS,
  everyMs = DEFAULT_MAINTAIN_EVERY_MS,
  commitGraphEvery = COMMIT_GRAPH_EVERY,
}: MaintenanceKindsOptions): BackgroundKind[] {
  return [
    {
      name: 'maintain',
      atStart: true,
      afterCommits: 1,
      quietMs,
      everyMs,
      isDue: (realm) => needsMaintenance(repoPath(historyRoot, realm.id)),
      run: async (realm, { gitDir, head, signal }) => {
        let trigger: PassTrigger =
          head !== undefined && head === (await maintainedHead(gitDir))
            ? 'prune-rerun'
            : 'head-moved';
        let result: MaintenanceResult;
        try {
          result = await maintainRepo(gitDir, {
            signal,
            pruneExpiryMs,
            consolidateAtPacks,
          });
        } catch (error) {
          log.warn(
            passLogLine({
              realm: realm.url,
              head,
              trigger,
              outcome: signal.aborted ? 'aborted' : 'failed',
              error,
            }),
          );
          throw error;
        }
        log.info(
          passLogLine({
            realm: realm.url,
            head,
            trigger,
            outcome: 'done',
            result,
          }),
        );
        return result.after.looseObjects > 0
          ? { againAfterMs: pruneExpiryMs }
          : undefined;
      },
    },
    {
      name: 'commit-graph',
      afterCommits: commitGraphEvery,
      run: async (realm, { gitDir, head, signal }) => {
        let started = performance.now();
        await writeCommitGraph(gitDir, { signal });
        log.info(
          logfmt('commit-graph written', {
            realm: realm.url,
            head,
            totalMs: performance.now() - started,
          }),
        );
      },
    },
  ];
}

// One pass as a line of `key=value` fields: sizes in bytes, durations in
// whole milliseconds, and `before`/`after` the object counts either side of
// the pass.
export function passLogLine({
  realm,
  head,
  trigger,
  outcome,
  result,
  error,
}: {
  realm: string;
  head: string | undefined;
  trigger: PassTrigger;
  outcome: PassOutcome;
  result?: MaintenanceResult;
  error?: unknown;
}): string {
  let fields: Record<string, string | number | boolean | undefined> = {
    realm,
    head,
    trigger,
    outcome,
  };
  if (result) {
    let { before, after, durations } = result;
    Object.assign(fields, {
      totalMs: durations.total,
      repackMs: durations.repack,
      commitGraphMs: durations.commitGraph,
      pruneMs: durations.prune,
      updateServerInfoMs: durations.updateServerInfo,
      looseBefore: before.looseObjects,
      looseAfter: after.looseObjects,
      looseBytesBefore: before.looseBytes,
      looseBytesAfter: after.looseBytes,
      packsBefore: before.packs,
      packsAfter: after.packs,
      packBytesBefore: before.packBytes,
      packBytesAfter: after.packBytes,
      consolidated: result.consolidated,
      pruned: result.pruned,
    });
  }
  if (error !== undefined) {
    fields.error = error instanceof Error ? error.message : String(error);
  }
  return logfmt('maintenance pass', fields);
}

function logfmt(
  message: string,
  fields: Record<string, string | number | boolean | undefined>,
): string {
  let pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      let text =
        typeof value === 'number' ? String(Math.round(value)) : String(value);
      return `${key}=${/^[^\s="]+$/.test(text) ? text : JSON.stringify(text)}`;
    });
  return [message, ...pairs].join(' ');
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
    await ifPresent(unlink(join(gitDir, 'objects', 'pack', name)), undefined);
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

  // Loose objects left after the prune are captures younger than the
  // expiry. The time they pass it is recorded in the repo, so the pass that
  // removes them runs whichever task records the realm then, across a
  // restart. It is written before `info/refs`, which marks the pass done.
  let after = await countObjects(gitDir, signal);
  let pruneAfter = join(gitDir, PRUNE_AFTER_FILE);
  if (after.looseObjects > 0) {
    await writeFile(pruneAfter, `${Date.now() + pruneExpiryMs}\n`);
  } else {
    await ifPresent(unlink(pruneAfter), undefined);
  }

  step = performance.now();
  await runGit(gitDir, ['update-server-info'], { signal });
  let updateServerInfo = performance.now() - step;

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

// Whether the repo needs a pass: HEAD has moved since the last complete
// pass, or the last pass kept captures younger than the prune expiry. A
// pass run before they pass it removes nothing, and asks to run again when
// they do, so a task that finds the record when it loads the realm runs
// the rerun at the right time without knowing when the record was made.
export async function needsMaintenance(gitDir: string): Promise<boolean> {
  if ((await pruneRerunAt(gitDir)) !== undefined) {
    return true;
  }
  return !(await isMaintained(gitDir));
}

// When the captures the last pass kept pass the prune expiry, in
// milliseconds since the epoch, or undefined when it kept none. A record
// that can't be read counts as due now.
export async function pruneRerunAt(
  gitDir: string,
): Promise<number | undefined> {
  let text = await ifPresent(
    readFile(join(gitDir, PRUNE_AFTER_FILE), 'utf8'),
    undefined,
  );
  if (text === undefined) {
    return undefined;
  }
  let at = Number(text.trim());
  return Number.isFinite(at) ? at : 0;
}

// Whether the last complete pass saw the repo's current HEAD: true for a
// repo with no revision, or no repo at all, which have nothing to maintain.
export async function isMaintained(gitDir: string): Promise<boolean> {
  if ((await ifPresent(stat(gitDir), undefined)) === undefined) {
    return true;
  }
  let head = await readMain(gitDir);
  return head === undefined || head === (await maintainedHead(gitDir));
}

// The HEAD `info/refs` names: what HEAD was when a pass last completed.
export async function maintainedHead(
  gitDir: string,
): Promise<string | undefined> {
  let refs = await ifPresent(
    readFile(join(gitDir, 'info', 'refs'), 'utf8'),
    '',
  );
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
  let modified = (await ifPresent(stat(path), undefined))?.mtimeMs;
  if (modified === undefined || Date.now() - modified < STALE_AFTER_MS) {
    return;
  }
  log.warn(
    `removing ${path}, left ${Math.round((Date.now() - modified) / 60_000)} minutes ago by a git that didn't finish`,
  );
  await ifPresent(unlink(path), undefined);
}

// The files in `objects/pack` with git's temporary pack name that are older
// than `STALE_AFTER_MS`.
async function staleTemporaryPackFiles(gitDir: string): Promise<string[]> {
  let directory = join(gitDir, 'objects', 'pack');
  let names = await ifPresent(readdir(directory), [] as string[]);
  let stale: string[] = [];
  for (let name of names.filter((name) => name.startsWith('.tmp-'))) {
    let modified = (await ifPresent(stat(join(directory, name)), undefined))
      ?.mtimeMs;
    if (modified !== undefined && Date.now() - modified >= STALE_AFTER_MS) {
      stale.push(name);
    }
  }
  return stale;
}

// What `operation` resolves to, or `missing` when the file or directory it
// reads or removes isn't there. Any other failure is thrown.
async function ifPresent<T, M>(
  operation: Promise<T>,
  missing: M,
): Promise<T | M> {
  try {
    return await operation;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return missing;
    }
    throw error;
  }
}
