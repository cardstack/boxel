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
and its cursor update. It runs only when the realm has nothing captured.
A job that reaches the front of the queue with events queued behind it is
skipped and tried again a moment later. A job holds no recording permit.
Stopping the recorder aborts the job's signal and waits for it. A realm with
work due and no recorder gets one, which is dropped once idle again. A job that
fails is logged and tried again after its kind's retry delay. The realm records
on, unless the kind stalls the realm on failure.

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
