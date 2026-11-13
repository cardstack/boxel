# realm-historian

The service that records realm revision history. The realm server appends one
change event per write to the change journal (`realm_change_events`), and
realm-historian reads the journal and turns those events into git revisions,
one repo per realm, after the fact. Nothing on the write path waits on it.

The package is erasable TypeScript that Node runs unbuilt (ADR 018): the
service starts with `node main.ts`, and the tests run with `node tests/index.ts`.

## Running

```
node main.ts --historyRoot=<dir> --realmsRoot=<dir> --port=<port>
```

The database comes from the `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and
`PGDATABASE` environment variables, as for the worker. `--shardCount` and
`--taskCount` divide the realms between the tasks of one service (one shard and
one task by default). `--leaseRenewMs` and `--leaseExpiryMs` set the lease's
renewal interval and expiry (10 s and 30 s by default).
`--backgroundConcurrency` sets how many background jobs run at once (2 by
default).

`GET /health` on the port answers 200 while the main loop has made progress
within the last 30 s, whether the task holds a lease or is waiting for one, and
503 once the loop has stalled. A recorder reports progress within a long event,
so one large event doesn't read as a stall. The process exits rather than run
degraded: a lost lease, a query failure or an unhandled error logs the reason
and exits non-zero, and SIGTERM finishes the step in progress, releases the
lease and exits 0.

## Recording

Each realm the task records gets a recorder (`src/recorder.ts`) when its
first event arrives. The recorder:

- reads each changed path from the realm directory as soon as it handles the
  event, and checks the bytes against the event's fingerprint;
- groups events into revisions with `src/grouper.ts`;
- commits each revision to `<historyRoot>/<realm id>.git`. In the same
  transaction it checks the lease and moves the realm's cursor, HEAD and path
  state in `realm_history_state` and `realm_history_path_state`.

Before every commit the recorder checks that HEAD hasn't moved, so no event
is recorded twice after a crash, a lease handover or two overlapping tasks.

When a newer write replaced a path before the recorder read it, the earlier
write is still recorded, with `(content not kept)`. When nothing in the
journal explains the bytes on disk, they are recorded as `Unattributed
changes` once the maximum age has passed.

At most 16 recorders do I/O at once. A recorder that has had nothing to
record for 5 minutes is dropped.

A file history can't hold is left out with a warning, and the rest of the
write is recorded. That is a path with a segment git reads as `.git`, a
segment named `.realm-history-size-only` (the name size-only entries
reserve), or a path with a line break. Symlinks are not followed.

A realm whose repo or files fail is marked `stalled`, and the other realms
carry on. Setting its `status` back to `ok` takes effect when a task next
starts or takes over the realm's shard, which reads the realm's events again
from its cursor. A `scan` or `delete-realm` event records no revision: the
recorder moves its cursor past it.

## Background work

Work on a realm other than recording its events, such as a reconcile pass or
maintenance, is a kind of background work scheduled by `src/background.ts`.
Each kind says when it comes due on a realm:

- as soon as the realm is loaded (`atStart`);
- a fixed time after it last ran (`everyMs`);
- once a number of revisions have been committed since then (`afterCommits`),
  optionally only after none for a while (`quietMs`);
- or when asked (`request`), now or after a delay, or because a run asked to
  run again (`againAfterMs`).

Only the realms of the shards the task holds are scheduled. At most
`--backgroundConcurrency` jobs run at once across the task, and one at a time
on each realm. A kind's `isDue` check, if it has one, runs first, so a realm
that needs nothing doesn't get a recorder.

Each job runs in its realm's recorder queue, so it never runs between a commit
and its cursor update. It runs only when the realm has no events in hand. A job
asked for while the realm has events captured, being handled or queued is
skipped at once, and one that reaches the front of the queue with events queued
behind it is skipped then. A skipped job is tried again a moment later. A job
holds no recording permit.

A job's signal fires when its recorder stops, and when the realm's events fill
the queue behind it, since a full queue holds up every realm the task records.
Either way the job counts as not having run, whether it then returns or throws:
cut short by events, it is skipped and tried again a moment later, from the
beginning. So a kind must end promptly once its signal fires, and must be safe
to start again. Stopping the recorder waits for the job. A realm with work due
and no recorder gets one, which is dropped once idle again. A job that fails is
logged and tried again after its kind's retry delay. The realm records on,
unless the kind stalls the realm on failure.

## Maintenance

The recorder writes every object loose, and captures every write, including
intermediate states that no revision keeps. `src/maintenance.ts` keeps each
repo small and fast to read, as two kinds of background work:

- `maintain` runs a pass once a realm has committed nothing for 5 minutes
  after committing a revision. It also runs when the task loads the realm,
  so a repo a crash left unmaintained gets its pass, and an hour after its
  last pass, so a realm that never goes quiet gets one between revisions. It
  skips a realm whose `info/refs` already names HEAD.
- `commit-graph` writes the commit-graph after every 100 revisions, so a busy
  realm's path-filtered reads stay fast between passes.

A pass runs four steps:

1. `git repack -d` packs the loose objects HEAD reaches. Once a repo has 32
   packs, the pass uses `git repack -a -d` instead and merges them into one.
2. `git commit-graph write --reachable --split --changed-paths` keeps a
   commit-graph with changed-path Bloom filters, so a path-filtered `git log`
   doesn't read a tree per commit. It also runs on its own after every 100
   revisions.
3. `git prune --expire=1.hour.ago` removes captured objects no revision uses.
   The hour protects objects another task is writing during a lease handover.
   A pass that leaves younger ones runs again an hour later.
4. `git update-server-info` writes `info/refs` and `objects/info/packs`, so a
   repo can be cloned read-only over git's dumb HTTP protocol from a static
   file server. `info/refs` also names the HEAD the last complete pass saw.

`git repack --geometric` isn't used: it packs loose objects whether or not
anything reaches them, and prune never removes an object once it is packed.
A pack left under a temporary name, as a killed repack leaves one, is
replaced by the next pass once it is an hour old.

On one host, a reader never misses an object during a pass: repack removes
a loose copy only once its pack is in place, and prune removes only objects
HEAD doesn't reach. A reader on another host of the shared file system can
go on seeing a cached listing of the pack directory, or a pack that a `-a`
repack removed, for as long as its client caches them. Whether reads there
stay whole through a pass is measured on the deployed file system.

Each pass logs one line of `key=value` fields: the realm, its HEAD, what made
the pass due (`head-moved` or `prune-rerun`), how it ended (`done`, `failed`
or `aborted`), each step's duration, the loose and packed object counts and
sizes before and after, whether the packs were put into one, and the objects
pruned.

The commit-graph's Bloom filters serve `git log` with one path filter from
git 2.27, and with several path filters only from git 2.51.
`src/git-capabilities.ts` probes the git on PATH for both, and the service
logs the answer at startup. The reader runs one `git log` per path filter
unless it is told the git it runs can use several.

## Reading

The realm server reads history itself, through `GitRealmHistoryReader` from
`src/reader.ts` (`@cardstack/realm-historian/src/reader`). It runs read-only
git commands against the repo, and never calls realm-historian:

- `readHistory` lists revisions newest first with `git log` over path
  filters, with their changes and, by default, their diffs. A diff larger
  than 64 KB is left out, as are the diffs past the listing's 1 MB budget,
  and binary files get ids and sizes only. A superseded write's revision,
  which changed nothing under the filters, is listed after the oldest
  revision whose `Boxel-Includes-Superseded` names it.
- `readAtRevision` returns a file's content (base64 when it is binary, and
  always for a `range`) or a directory's listing. A file above 5 MB answers
  `too-large`, and a size-only entry answers `content-not-kept`.
- `readTreeAtRevision` lists every file under a path, with size-only entries
  flagged.

A reader runs at most 8 git processes at once across every read, and kills
each after 30 s. The cap is per reader, so a realm-server task builds one
reader and gives it to every realm it serves. Git uses the commit-graph's Bloom filters for several path filters
only from 2.51 on, and `bloomWithSeveralPaths` says whether the git in use
does. With it off, the default, the reader runs one `git log` per filter and
merges the results in history order, which is correct on any git.

## Scripts

`scripts/scan.ts` appends a `scan` event for each realm a deploy wrote to
directly, so the deploy's changes are recorded as one revision attributed to
the deploy. The realm server's start scripts run it after their rsync steps,
through `packages/realm-server/scripts/scan-deployed-realms.sh`:

```
node scripts/scan.ts --realm=<directory>[:<bot username>] ... \
  [--matrixServerName=<name>] [--source=<repository>] [--commit=<sha>]
```

Each `--realm` names a bootstrap realm by the directory its realm server
mounts. The event is by the realm's Matrix bot, or by `boxel-system` for a
realm named without one, and carries the repository and commit deployed. A
realm whose recording is off gets no event.

## Tests

`pnpm test` needs a Postgres reachable through the `PG*` variables, with the
right to create databases: each test module migrates its own database and
drops it afterwards. Locally, the development `boxel-pg` container serves:

```
PGPORT=5435 pnpm test
```
