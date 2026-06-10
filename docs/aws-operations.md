# Boxel AWS operations

Operational runbooks for boxel services on AWS. Each section is a self-contained procedure: pre-requisites, the steps to run, what to verify after, and how to roll back.

These procedures assume you already have AWS access set up — the `aws-access` claude skill walks new teammates through the one-time setup. Most procedures here need an AWS profile with `ssm:PutParameter` / `ecs:UpdateService` etc. on the target prefix; the read-only `claude-staging` / `claude-prod` profiles from that skill are _not_ sufficient.

Conventions used throughout:

- `<env>` is `staging` or `production`.
- `<profile>` is your AWS profile with write access (typically `cardstack` for staging, `cardstack-prod` for prod).
- Commands are shown for a single environment; mirror them for the other.

---

## Activate the dynamic-pool prerender server

Sets the boxel prerender server's `PagePool` envelope (`MIN` / `MAX` / `HIGH_PRIORITY_MAX`). Use this when first activating dynamic-pool behaviour on a deployed environment, or when re-tuning the envelope after a workload shift.

### Pre-requisites

Without **all** of these, the procedure is a no-op at runtime — the SSM parameters get set but the running prerender server image ignores them:

1. **Dynamic-pool code is deployed.** The deployed prerender server image must include the constructor block in `packages/realm-server/prerender/page-pool.ts` that reads `parsePositiveInt(process.env.PRERENDER_PAGE_POOL_MIN)` etc. Check by `grep`-ing the file in the running image, or by confirming that the image was built from a commit on or after CS-10976's PR 8 / PR 9 / PR 11 merge.
2. **SSM parameter pass-through is in the deployed Terraform.** The infra-side SSM secret pass-through (CS-10976 infra PR 7) must be applied — that's what creates the parameters this procedure overwrites. They're seeded with `value = "0"` so the running code falls back to legacy fixed-pool until you set real values.
3. **ECS task is sized for the envelope.** The recommended `HIGH_PRIORITY_MAX = 8` requires ~8.7 GB peak memory + 25 % safety margin → 16 GB allocated. CS-10976 infra PR 10 resizes to 2 vCPU / 16 GB; without it, `HIGH_PRIORITY_MAX = 8` would OOM. Use the fallback values below if the resize hasn't shipped.
4. **AWS profile with write access.** `ssm:PutParameter` on `/<env>/boxel/*` and `ecs:UpdateService` on `boxel-prerender-server-<env>`.

### Recommended values

Derived from staging telemetry on 2026-04-30. The methodology lives in the `prerender-sizing` claude skill — re-run it against fresh data when the workload shifts.

```sh
ENV=staging                     # or production
PROFILE=cardstack-${ENV}        # or cardstack-prod, your write-capable profile

aws --profile $PROFILE ssm put-parameter \
  --name "/${ENV}/boxel/PRERENDER_PAGE_POOL_MIN" --value 2 --overwrite

aws --profile $PROFILE ssm put-parameter \
  --name "/${ENV}/boxel/PRERENDER_PAGE_POOL_MAX" --value 6 --overwrite

aws --profile $PROFILE ssm put-parameter \
  --name "/${ENV}/boxel/PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX" --value 8 --overwrite

aws --profile $PROFILE ssm put-parameter \
  --name "/${ENV}/boxel/PRERENDER_HIGH_PRIORITY_THRESHOLD" --value 5 --overwrite

aws --profile $PROFILE ssm put-parameter \
  --name "/${ENV}/boxel/PRERENDER_POOL_IDLE_CONTRACTION_MS" --value 60000 --overwrite

aws --profile $PROFILE ssm put-parameter \
  --name "/${ENV}/boxel/PRERENDER_SHARED_CONTEXT_CAP" --value 12 --overwrite
```

### Force a deploy so the new task instances pick up the values

ECS does **not** auto-restart task definitions on SSM-value changes. After the parameters are set, force a new deployment of the prerender service so new task instances boot with the updated env vars:

```sh
aws --profile $PROFILE ecs update-service \
  --cluster $ENV \
  --service boxel-prerender-server-$ENV \
  --force-new-deployment
```

This rolls the running tasks one at a time; expect a 1–2 minute window where some tasks are old, others new. The manager-side `affinityVacancy` heartbeat handles the mixed state.

### Validation gate

Before promoting to prod, run a synthetic saturating workload on staging:

- Concurrent catalog full reindex (priority 0)
- Simulated user-driven incremental reindex on a different realm (priority 10)
- Both for ~5 minutes

**Pass criteria:**

- High-priority p95 `tabQueueMs` < 1 s during the burst.
- Memory peak < 80 % of allocated.
- CPU peak < 80 % of allocated, sustained over a 1-minute window (brief overshoots OK).
- Zero 145-second render-timeouts (`SELECT count(*) FROM boxel_index WHERE (diagnostics->>'totalElapsedMs')::int >= 145000`).

**Adjustment paths:**

- CPU peak > 80 % sustained → drop `MAX` by 1, retest.
- Memory peak > 80 % → drop `HIGH_PRIORITY_MAX` by 1, retest.
- Tab-queue wait spike at high priority → investigate manager-side routing; the priority-aware `scoreCandidate` should be picking the right server.

### Fallback values (if PR 10's resize isn't deployed)

If the ECS task is still 4 vCPU / 8 GB, the recommended values would OOM at `HP_MAX = 8` (memory model: 8 × 836 MB + 2 GB ≈ 8.7 GB → 109 % of 8 GB). Use these instead — modest improvement over today's behaviour, no infra change required:

| Knob                                    | 16 GB task (recommended) | 8 GB task (fallback) |
| --------------------------------------- | -----------------------: | -------------------: |
| `PRERENDER_PAGE_POOL_MIN`               |                        2 |                    2 |
| `PRERENDER_PAGE_POOL_MAX`               |                        6 |                    4 |
| `PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX` |                        8 |                    5 |
| `PRERENDER_HIGH_PRIORITY_THRESHOLD`     |                        5 |                    5 |
| `PRERENDER_POOL_IDLE_CONTRACTION_MS`    |                    60000 |                60000 |
| `PRERENDER_SHARED_CONTEXT_CAP`          |                       12 |                    8 |

### Rollback

Restore the previous envelope values via SSM, then force-redeploy. Capture the pre-change values before applying new ones so rollback is a single `put-parameter` per knob — there is no longer a "fall back to a different env var" escape hatch, so the rollback target must be a known-good envelope.

```sh
# Example: restoring a previous envelope. Substitute the values you
# captured before applying.
aws --profile $PROFILE ssm put-parameter \
  --name "/${ENV}/boxel/PRERENDER_PAGE_POOL_MIN" --value <prev-min> --overwrite
aws --profile $PROFILE ssm put-parameter \
  --name "/${ENV}/boxel/PRERENDER_PAGE_POOL_MAX" --value <prev-max> --overwrite
# … repeat for PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX,
# PRERENDER_HIGH_PRIORITY_THRESHOLD,
# PRERENDER_POOL_IDLE_CONTRACTION_MS,
# PRERENDER_SHARED_CONTEXT_CAP as needed.

aws --profile $PROFILE ecs update-service \
  --cluster $ENV --service boxel-prerender-server-$ENV \
  --force-new-deployment
```
