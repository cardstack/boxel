# Synapse v1.163.0 upgrade plan

## Goal

Run Synapse v1.163.0, which includes the upstream fix for retrying a failed
event save (element-hq/synapse#20148, first in v1.161.0). On v1.126.0 a
retried save re-inserts its `state_groups_persisting` rows, fails on the
primary key, and blocks every new event in that room until the process
restarts.

## Target

`v1.163.0`, the newest stable release. Docker Hub `matrixdotorg/synapse:v1.163.0`
for local and CI runs, and GHCR `ghcr.io/element-hq/synapse:v1.163.0` for ECS.

## Changes

### boxel

- Pin `matrixdotorg/synapse:v1.163.0` everywhere v1.126.0 was pinned:
  `packages/matrix/support/synapse/index.ts`,
  `packages/matrix/scripts/test-oidc-mapping-provider.sh`,
  `.github/actions/warm-test-images/action.yml`,
  `.github/workflows/mirror-test-images.yml`,
  `.devcontainer/claude-web-setup.sh`.
- Add `default_room_version: "10"` to the `dev`, `test` and
  `test-without-registration-token` homeserver templates.
- Lift `rc_room_creation` and `rc_profile` in the same three templates (see
  Rate limits below).

### infra (cardstack/infra)

- `configs/matrix/base/files/config.yaml`: `default_room_version: "10"`.
  Both environments share this file. On v1.126.0 the setting matches the
  built-in default, so it changes nothing there.
- `configs/matrix/staging/main.tf`: `synapse_image =
"ghcr.io/element-hq/synapse:v1.163.0"`.
- Production moves in a separate change once staging has run on v1.163.0.

## Why room version 10 is pinned

From v1.162.0, Synapse creates new rooms as room version 12. In v12, a room
creator has unbounded power and must not appear in
`power_level_content_override.users`. The host's room creation
(`create-ai-assistant-room.ts`, `ai-assistant-panel-service.ts`) sends the
creator there, so `createRoom` returns 400. Room IDs in v12 also have no
`:server` suffix. Pinning 10, the version v1.126.0 creates, keeps new rooms
the same as today's. Existing rooms are not affected either way.

## Upgrade notes review (v1.127 through v1.163)

- **Postgres:** v1.143 and later require Postgres 14 or newer. Staging and
  production run 15. Local dev and test use SQLite.
- **Schema:** `SCHEMA_VERSION` goes from 89 to 94, and `SCHEMA_COMPAT_VERSION`
  stays 84, so v1.126.0 can still start on the migrated schema.
  `state/94/01` adds `inserted_ts` to `state_groups_persisting` with a stable
  default, which Postgres applies without rewriting the table. No delta
  rewrites `events`, `event_json` or `state_groups_state` at startup. The
  heaviest work is background updates after startup, which build indexes on
  `device_lists_changes_in_room` (`device_lists_changes_in_room_inserted_ts_idx`
  and `device_lists_changes_in_room_unconverted_idx`). Synapse serves
  normally while they run, but the second build needed about 25 GB of free
  disk at its peak on staging. RDS storage autoscaling does not react fast
  enough to cover it, so the database needs that much free storage before the
  upgrade.
- **Config:** no key our templates or the deployed config use was removed or
  renamed.
- **Login, SSO and UIA:** every admin and client endpoint we call still
  exists. The OIDC mapping provider interface is unchanged.
  `test-oidc-mapping-provider.sh` passes in the v1.163.0 image.
- **Sliding sync and experimental flags:** the templates set
  `experimental_features.msc3575_enabled` (on by default) and
  `msc3874_enabled`, and both still exist in v1.163.0. The host's and
  ai-bot's sliding sync on `org.matrix.simplified_msc3575` is covered by the
  matrix Playwright suite, which passes against v1.163.0, and by the AI
  assistant smoke tests run after each environment's upgrade.
- **Rate limits:** several limits apply to requests that weren't limited on
  v1.126.0. The templates and the deployed config lift the two our traffic
  hits:
  - `rc_room_creation` (v1.136; burst 10, then about one a minute per user).
    The realm server's Matrix user creates a room for each user's first
    sign-in.
  - `rc_profile` (v1.162; burst 500, then 1/s per client IP for
    unauthenticated lookups). The realm server and workers look up profiles
    without an access token, and `fetchMatrixProfile` reads a 429 as "no
    such user".
  - `rc_user_directory` and `rc_reports` keep their defaults, since Boxel
    calls neither endpoint.

## Rollout

1. Merge the boxel change. CI's matrix suite runs on the v1.163.0 image, and
   the merge refreshes the GHCR mirror.
2. Merge and apply the infra change for staging. The ECS service's rolling
   deploy runs the old and new task side by side against one database, so
   scale the service to 0 before applying the new image and back to 1 after,
   the same procedure production uses. Record:
   - how long the new task takes from start to its first healthy `/health`
     (the migration time);
   - how long the rows in `background_updates` take to drain.
3. Let staging run, watching the logs for `UniqueViolation`,
   `state_groups_persisting` and background-update errors.
4. Upgrade production, scaling to 0 before applying the new image as on
   staging.

## Testing

- `packages/matrix/scripts/test-oidc-mapping-provider.sh` in v1.163.0: 11
  tests pass.
- A throwaway v1.163.0 container from the `test` template boots healthy. A
  `createRoom` shaped like the host's (creator at 100, AI bot at 50) returns a
  room version 10 room. The same request with `room_version: "12"` returns
  400 `Creator user … must not appear in content.users`. With the `test`
  template's limits, one user creates 15 rooms and makes 20 unauthenticated
  profile lookups without a 429.
- `pnpm test:shard-assignment` and `pnpm lint` in `packages/matrix`.
- The full matrix Playwright suite runs in CI.
