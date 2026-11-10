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

## Tests

`pnpm test` needs a Postgres reachable through the `PG*` variables, with the
right to create databases: each test module migrates its own database and
drops it afterwards. Locally, the development `boxel-pg` container serves:

```
PGPORT=5435 pnpm test
```
