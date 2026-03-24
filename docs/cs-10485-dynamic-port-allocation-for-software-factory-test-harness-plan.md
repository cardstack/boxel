# CS-10485 Dynamic Port Allocation For Software Factory Test Harness Plan

## Goal

Remove the software-factory harness's hardcoded runtime ports so isolated realm stacks can run in parallel and the harness no longer collides with `mise run dev-all`.

Success for this ticket means:

- isolated realm servers do not assume fixed ports for realm-server, compat proxy, or worker-manager
- the harness support stack starts Synapse on a non-conflicting dynamic port
- Playwright fixtures discover actual runtime ports from metadata instead of reconstructing them from constants
- `playwright.config.ts` is updated to `workers: 2` after we confirm the targeted Playwright suite runs cleanly at that worker count

## Current State

The current implementation still hardcodes the same ports in multiple places:

- [`packages/software-factory/src/harness.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/harness.ts)
  - `REALM_SERVER_PORT=4205`
  - `COMPAT_REALM_SERVER_PORT=4201`
  - `WORKER_MANAGER_PORT=4232`
  - published realm domains and base/skills URL mappings are built from those constants
- [`packages/software-factory/src/cli/serve-realm.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/cli/serve-realm.ts)
  - writes metadata for `realmURL` and auth only, not the allocated ports that fixtures need
- [`packages/software-factory/tests/fixtures.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/tests/fixtures.ts)
  - assumes fixed ports for shutdown waiting and Playwright request rewrites
- [`packages/software-factory/playwright.config.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/playwright.config.ts)
  - pins `workers: 1`
- [`packages/matrix/docker/synapse/index.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/matrix/docker/synapse/index.ts) and [`packages/matrix/helpers/environment-config.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/matrix/helpers/environment-config.ts)
  - the current non-environment path still uses fixed Synapse host port `8008` and fixed `getSynapseURL()` output of `http://localhost:8008`

## Assumptions To Validate While Implementing

- The realm-server and worker-manager CLIs tolerate `--port=0` and continue to emit their existing `ready` IPC message.
- The cleanest source of truth for actual bound ports may be a well-known runtime metadata file written after bind completes, instead of reconstructing ports indirectly.
- The compat port is only a compatibility surface for browser rewrites; nothing important should depend on `4201` specifically.
- The Synapse helper does not yet provide dynamic host-port behavior for the harness's current execution mode, so this needs a code change rather than just propagation.

## Implementation Plan

### 1. Make port allocation explicit in the harness

- Update [`packages/software-factory/src/harness.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/harness.ts) so the default realm-server, compat-proxy, and worker-manager ports are dynamic instead of fixed.
- Refactor `startIsolatedRealmStack()` to return the effective runtime ports in addition to the child processes.
- Add a single well-known runtime metadata contract for the spawned realm stack so the actual bound ports are published explicitly and consumed consistently.
- Make all internal URL construction use those effective ports instead of module-level constants:
  - published realm domains
  - base realm mappings
  - optional skills realm mappings
  - compat proxy target/listen ports

### 2. Propagate support-stack runtime data

- Update `startFactorySupportServices()` in [`packages/software-factory/src/harness.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/harness.ts) to avoid fixed Synapse ports and to preserve the actual `matrixURL` in support context.
- Extend the Synapse startup path so the harness can obtain a dynamic host port in normal local test mode, not only in `BOXEL_ENVIRONMENT` mode.
- If the support metadata contract needs more structure, extend [`packages/software-factory/src/runtime-metadata.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/runtime-metadata.ts) and the Playwright setup flow accordingly.

### 3. Expand serve-realm metadata

- Extend [`packages/software-factory/src/cli/serve-realm.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/cli/serve-realm.ts) so the metadata JSON includes the actual runtime ports and any derived origins/prefixes the tests need.
- Keep the metadata payload as the single source of truth for isolated test realms.

### 4. Switch tests to metadata-driven rewrites and cleanup

- Update [`packages/software-factory/tests/fixtures.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/tests/fixtures.ts) to read the real runtime ports from `serve-realm.ts` metadata.
- Remove the fixed-port assumptions from:
  - shutdown waiting
  - base realm redirect registration
  - optional skills redirect registration
- Preserve the shared-realm cache behavior per Playwright worker and test file.

### 5. Re-enable parallel Playwright workers

- Raise `workers` in [`packages/software-factory/playwright.config.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/playwright.config.ts) from `1` to `2` only after local confirmation that the targeted suite runs cleanly with two workers.
- Keep `fullyParallel: false` unless the updated test behavior proves broader parallelism is safe.

## Target Files

- [`packages/software-factory/src/harness.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/harness.ts)
- [`packages/software-factory/src/cli/serve-realm.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/cli/serve-realm.ts)
- [`packages/software-factory/src/runtime-metadata.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/src/runtime-metadata.ts) if support metadata needs a contract update
- [`packages/software-factory/tests/fixtures.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/tests/fixtures.ts)
- [`packages/software-factory/playwright.config.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/playwright.config.ts)
- Possibly [`packages/software-factory/playwright.global-setup.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory/playwright.global-setup.ts) if support metadata wiring needs an adjustment
- [`packages/matrix/docker/synapse/index.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/matrix/docker/synapse/index.ts)
- [`packages/matrix/helpers/environment-config.ts`](/home/hassan/codez/boxel-cs-10485-codex/packages/matrix/helpers/environment-config.ts) if `getSynapseURL()` needs to stop assuming `8008`

## Testing Notes

- Run `pnpm lint` in [`packages/software-factory`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory) before any commit.
- Run targeted Playwright coverage in [`packages/software-factory`](/home/hassan/codez/boxel-cs-10485-codex/packages/software-factory), starting with:
  - `pnpm test -- --grep "darkfactory|factory target realm|factory bootstrap"`
- Verify the targeted suite runs with `workers=2` without realm-stack or Synapse port collisions before keeping that config change.
- If local parallel execution is noisy or environment-dependent, capture the residual risk explicitly and leave full confirmation to CI.

## Open Questions

- What exact metadata shape should the realm stack publish so both the harness and Playwright fixtures can consume it without duplicating URL construction logic?
- Are there any remaining browser-side assumptions that still reference the compat origin directly instead of using runtime metadata?
