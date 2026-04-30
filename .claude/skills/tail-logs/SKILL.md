---
name: tail-logs
description: Tail Loki logs from local / staging / production for any boxel ECS task family — realm-server, worker, prerender, prerender-manager, synapse. Use when you need to debug an incident, follow live activity, or correlate request IDs across services. Wraps `packages/observability/scripts/tail-logs.sh` so the LogQL + auth + URL plumbing is hidden.
allowed-tools: Read, Bash
---

# tail-logs

Tail Loki logs from a laptop. The script handles auth (SSM bearer token), URL resolution (SSM public URL), the `/loki` URL gotcha, and LogQL selector construction. You provide environment + service.

## When to invoke

- Debugging an incident in staging or production
- Following live realm-server / worker activity while reproducing a bug locally
- Correlating a request id, job id, or realm name across services
- Cross-checking that something just shipped a log line you expect

If the user is asking what *changed* (deploy diffs, code history) rather than what *happened*, this is the wrong tool — go to git/PR APIs instead.

## How to invoke

```bash
packages/observability/scripts/tail-logs.sh --env <local|staging|production> --service <name> [flags]
```

Common flag patterns:

```bash
# What happened to realm-server in the last 15 min on staging?
./scripts/tail-logs.sh --env staging --service realm-server --since 15m --no-follow

# Live tail with an error filter
./scripts/tail-logs.sh --env staging --service worker --regex '(?i)error|exception|fatal'

# Drill to a specific job
./scripts/tail-logs.sh --env staging --service worker --filter 'job_id=42' --since 1h --no-follow

# Production requires --confirm (intentional friction)
./scripts/tail-logs.sh --env production --service synapse --since 30m --no-follow --confirm
```

| Flag | Default | Notes |
|------|---------|-------|
| `--env` | (required) | `local`, `staging`, `production` |
| `--service` | (required) | `realm-server`, `worker`, `prerender`, `prerender-manager`, `synapse` (or any local container name) |
| `--realm` | unset | Filter to a single realm. Only set on tasks where realm is meaningful. |
| `--worker-id` | unset | Per-Fargate-task id; only available on workers. |
| `--filter` | unset | LogQL line-filter (`\|=` literal substring). Mutually exclusive with `--regex`. |
| `--regex` | unset | LogQL line-regex (`\|~`). |
| `--since` | `15m` | `30s`, `15m`, `1h`, `2d` — anything matching `^\d+[smhd]$`. |
| `--limit` | `200` | Max lines per batch. |
| `--no-follow` | follow on | One-shot mode for diagnostics. **Always use `--no-follow` from a skill** — follow mode is interactive. |
| `--json` | text | Raw Loki response per batch. Use when you need to parse beyond the formatted line. |
| `--confirm` | n/a | Required for `--env production`. |

## Auth requirements

For staging / production: AWS credentials must be active for the env's account, with `ssm:GetParameter` on `/<env>/loki/*`. Locally: no auth, just `docker compose up -d` from `packages/observability/`.

## Output shape

Default text format is `<rfc3339>  [<labels>]  <line>`:

```
2026-04-28T22:06:11Z  [env=staging,service=realm-server,realm=catalog]  realm: indexing batch complete duration_ms=412
```

Labels are sorted alphabetically inside the brackets. With `--json`, you get the raw Loki HTTP response — useful for `jq '.data.result[]'`-style structured analysis.

## Patterns by task family

| You want to... | Suggested invocation |
|---|---|
| Find the last 100 errors in any staging service | `--env staging --service <each one> --regex '(?i)error\|exception\|fatal' --since 1h --limit 100 --no-follow` (run per service; LogQL doesn't take an OR over labels in one query) |
| Watch a slow indexer batch | `--env staging --service realm-server --regex 'duration_ms=[0-9]{4,}'` |
| See what one Fargate worker is doing | `--env staging --service worker --worker-id <id> --since 30m --no-follow` |
| Tail synapse | `--env staging --service synapse --since 15m --no-follow` |

## Limits and caveats

- The hosted Loki has a 7-day default `reject_old_samples_max_age`. Queries beyond that window will return zero results even if S3 still has the chunks.
- Production retention is 180 days (S3 lifecycle); local has no retention enforcement and `reject_old_samples=false`.
- The dual-ship to CloudWatch is still on through the Phase 7 migration bake — for very long forensics windows or AWS-internal debug, query CloudWatch via `aws logs tail` instead of this skill.
- `--filter` uses literal substring match; `--regex` uses Loki's RE2 dialect. Anchors (`^`, `$`) work; lookarounds don't.

## See also

- `packages/observability/README.md` — full label schema, LogQL cookbook, Loki vs CloudWatch decision table
- The script itself — `packages/observability/scripts/tail-logs.sh`
