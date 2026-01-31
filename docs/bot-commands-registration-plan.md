# Plan: Register commands for specific bot registrations

## Goals
- Define how bot-specific commands are registered in `bot_commands`.
- Specify the `filter` JSON shape and how it targets events for a command.
- Add minimal tests to validate registration and filter behavior.

## Assumptions
- `bot_commands.command` stores a URL derived from `internalKeyFor(codeRef)`.
- `filter` is used to match event payloads before a command runs.
- The command input can be expressed in JSON and is loaded per command.

## Open questions
- What are the authoritative event types and payload shape to filter on?
- Where should `commandInput` live: inside `filter` or as a sibling column?
- Should `filter` be validated (schema) at write time or only at execution time?

## Proposed `filter` JSON shape (draft)
- `event`: string or array of strings
- `commandInput`: JSON object passed to the command
- Optional: `conditions`: list of `{ path, op, value }` predicates

Example:
```json
{
  "event": ["card.created", "card.updated"],
  "conditions": [
    { "path": "card.type", "op": "eq", "value": "invoice" }
  ],
  "commandInput": {
    "notifyChannel": "#finance"
  }
}
```

## Steps
1. Locate existing bot registration + command execution flow and confirm where `internalKeyFor(codeRef)` is generated.
2. Define a JSON schema (or type) for `filter` and document it.
3. Add validation on insert/update of `bot_commands` (or at execution time if preferred).
4. Wire filter evaluation into command dispatch so only matching events invoke the command.
5. Update or add tests in realm-server to cover:
   - storing `bot_commands` with filter
   - matching vs non-matching events
   - `commandInput` loaded per command

## Target files (likely)
- `packages/realm-server/...` command registration and dispatch code
- `packages/realm-server/tests/server-endpoints/bot-registration-test.ts`
- `packages/postgres/migrations/...` (if schema changes needed)
- `packages/runtime-common/...` (shared filter types/helpers if needed)

## Testing notes
- Prefer a focused realm-server test module (e.g., extend `bot-registration-test.ts`).
- If schema changes are required, add a migration via `pnpm create <name>`.
