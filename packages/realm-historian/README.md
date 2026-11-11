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

`GET /health` on the port answers 200 while the main loop has made progress
within the last 30 s, whether the task holds a lease or is waiting for one, and
503 once the loop has stalled. A recorder reports progress within a long event,
so one large event doesn't read as a stall. The process exits rather than run
degraded: a lost lease, a query failure or an unhandled error logs the reason
and exits non-zero, and SIGTERM finishes the step in progress, releases the
lease and exits 0.

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
