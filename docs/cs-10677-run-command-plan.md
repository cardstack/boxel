# CS-10677: Add `boxel run-command`

## Goal
Add a top-level `boxel run-command` CLI command (and programmatic API) that executes host commands on the realm server via `/_run-command`.

## Files
- **CREATE** `packages/boxel-cli/src/commands/run-command.ts`
- **CREATE** `packages/boxel-cli/tests/commands/run-command.test.ts`
- **MODIFY** `packages/boxel-cli/src/index.ts`

## Design
- Top-level command: `boxel run-command <specifier> --realm <url> [--input '{}'] [--json]`
- Uses `authedRealmServerFetch` (server-level JWT)
- JSON:API request/response matching `realm-operations.ts`
- Exports programmatic `runCommand()` function

## Test Plan
Unit tests mocking `authedRealmServerFetch` covering success, error, HTTP failures, no profile, request shape validation.
