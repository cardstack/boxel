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
  `packages/matrix/tests/synapse-container-networking.spec.ts`,
  `packages/matrix/scripts/test-oidc-mapping-provider.sh`,
  `.github/actions/warm-test-images/action.yml`,
  `.github/workflows/mirror-test-images.yml`,
  `.devcontainer/claude-web-setup.sh`.
- Add `default_room_version: "10"` to the `dev`, `test` and
  `test-without-registration-token` homeserver templates.

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
  heaviest work is background updates after startup, chiefly
  `mark_unreferenced_state_groups_for_deletion_bg_update` over
  `state_groups`.
- **Config:** no key our templates or the deployed config use was removed or
  renamed.
- **Login, SSO and UIA:** every admin and client endpoint we call still
  exists. The OIDC mapping provider interface is unchanged.
  `test-oidc-mapping-provider.sh` passes in the v1.163.0 image.
- **Rate limits:** v1.162 adds `rc_profile` (1/s, burst 500) on profile
  lookups. Watch for 429s on `_matrix/client/v3/profile/*`.

## Rollout

1. Merge the boxel change. CI's matrix suite runs on the v1.163.0 image, and
   the merge refreshes the GHCR mirror.
2. Merge and apply the infra change for staging. Record:
   - how long the new task takes from start to its first healthy `/health`
     (the migration time);
   - how long the rows in `background_updates` take to drain.
3. Let staging run, watching the logs for `UniqueViolation`,
   `state_groups_persisting` and background-update errors.
4. Upgrade production. The ECS service's rolling deploy runs the old and new
   task side by side against one database, so scale to 0 before applying the
   new image.

## Testing

- `packages/matrix/scripts/test-oidc-mapping-provider.sh` in v1.163.0: 11
  tests pass.
- A throwaway v1.163.0 container from the `test` template boots healthy. A
  `createRoom` shaped like the host's (creator at 100, AI bot at 50) returns a
  room version 10 room. The same request with `room_version: "12"` returns
  400 `Creator user … must not appear in content.users`.
- `pnpm test:shard-assignment` and `pnpm lint` in `packages/matrix`.
- The full matrix Playwright suite runs in CI.
