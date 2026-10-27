# Realm history recovery runbook

A realm that records history treats its history (the deckd repository at
`<realm>/.realm-history/`) as the truth, and its directory on disk as a copy of
HEAD. Recovery keeps the two in agreement. This runbook covers what to do when
it can't, and when it reports a realm changed outside its history.

## What recovery does

Recovery runs when a realm is mounted, before its boot index, and from an hourly
cron in worker-manager (`REALM_HISTORY_RECOVERY_CRON_SCHEDULE`), which asks
every realm that records to check itself. It also runs when a write finds disk
behind HEAD at one of its paths. Each run:

1. **Settles writes whose answer was lost.** Each write is journaled `pending`
   in `realm_history_revisions` before deckd is asked to record it. A row still
   pending after five minutes has its outcome asked of deckd. Asking fences the
   operation ID: once deckd reports it absent, it can never commit later, and a
   retry under that ID gets a 409 `operation-fenced`.
2. **Completes revisions a crash cut short.** For a revision recorded but not
   all on disk, or never indexed, recovery writes what HEAD holds at its paths
   under those paths' write locks, then announces and indexes them.
3. **Compares disk with HEAD.** A file that differs from HEAD is recorded as a
   system revision:
   - _Unrecorded changes (recording was disabled)_ (`kind = gap`,
     trailer `Boxel-Gap: recording-disabled`), when the realm last ran without
     recording;
   - _Unattributed external changes_ (`kind = drift`) otherwise. An edit that a
     write overwrites before recovery sees it is lost.

Each run logs one `boxel:operations` line with `kind: "realm-recovery"`. That
line carries the outcome (`clean`, `recovered`, `read-only` or `leased`), what
the run did, and how long the disk scan took.

## Alerts

Both alerts are in `packages/observability/provisioning/alerting/realm-history-group.json`.

### Realm Changed Outside Its History

Something edited the realm directory directly: a shell on the host, an rsync, or
a tool writing into EFS. Nothing is lost, because the change is now a revision.
Find the line:

```
{service="realm-server"} |= "realm-recovery" | json | line_format "{{ if .log }}{{ .log }}{{ else }}{{ __line__ }}{{ end }}" | json | driftPaths > 0
```

It names the realm and the revision (`driftRevisions`). Find out who made the
edit, and have them make it through the realm (or `boxel realm push`) from now
on.

Until the "every write path" work lands, `/_atomic`, source `DELETE`, create-realm
and publish also write without recording, so on a recording realm their changes
show up here too.

### Realm Read-Only After Failed Recovery

Recovery couldn't finish, so the realm now refuses writes. Reads still work. A
write gets:

```
HTTP/1.1 423 Locked
X-Boxel-Realm-Read-Only: recovery-failed
{"errors":[{"status":"423","code":"realm-read-only", ...}]}
```

`_readiness-check` answers 200 with the same `X-Boxel-Realm-Read-Only` header.
The realm stays read-only until an operator clears it. Neither a restart nor the
schedule clears it.

## Clearing a read-only realm

1. **Read the reason.** The `realm-recovery` line's `error` field holds it, and
   so does the database:

   ```sql
   SELECT read_only_at, read_only_reason, read_only_detail
   FROM realm_history_state WHERE realm_url = '<realm url>';
   ```

2. **Fix the cause.**
   - _deckd unreachable or timing out_ (`fetch failed`, `ECONNREFUSED`,
     `lock-timeout`): check the deckd sidecar's health (`GET /health`) and its
     restarts. Recovery needs deckd for every step.
   - _`history-unsettled`_: deckd found jj's HEAD and its recorded HEAD
     disagreeing for more than a few seconds. It usually settles; retry.
   - _A corrupt repository_ (`internal` errors from `/head`, `/tree` or
     `/read`): restore `<realm>/.realm-history/` from backup. Don't delete it.
     Deleting it discards the realm's history, and the next recovery would then
     take in the whole realm as one gap revision.
   - _Disk full or a filesystem error_: free space, then retry.
   - _A gap or drift too large for one revision_ (`payload-too-large`): one
     revision carries at most 40 MiB. Until recovery splits by size, record the
     change in smaller pieces through the realm, then retry.
3. **Clear the seal**, with the Grafana operator secret. The clear re-runs
   recovery first:

   ```sh
   curl -X POST -H "Authorization: Bearer $GRAFANA_SECRET" \
     "https://<realm-server>/_grafana-clear-realm-read-only?realm=<realm path or url>"
   ```

   - It answers 200 with `"readOnly": false` once recovery succeeds and writes
     are back.
   - It answers 409 with `"readOnly": true` and the new reason if recovery fails
     again.

4. **Only if you've repaired the realm by hand** and recovery still can't run,
   add `&force=true`. That lifts the seal without recovering. Whatever disk then
   holds that history doesn't is recorded as drift the next time recovery runs.

## Configuration

| Variable                               | Where                        | Purpose                                                    |
| -------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `REALM_HISTORY_DECKD_URL`              | realm-server, worker-manager | deckd's address. The cron only runs where it is set        |
| `REALM_HISTORY_REALMS`                 | realm-server                 | Realms that record: a comma-separated list of URLs, or `*` |
| `REALM_HISTORY_RECOVERY_CRON_SCHEDULE` | worker-manager               | When the scheduled sweep runs (default `20 * * * *`)       |
