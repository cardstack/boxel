## Matrix LLM selection simplification – implementation plan

### 1. MatrixService room initialization
- Find room initialization / AI panel init path in `packages/host/app/services/matrix-service.ts`.
- Identify where `APP_BOXEL_ACTIVE_LLM` is currently written/read.
- Add helper to:
  - Read latest `APP_BOXEL_ACTIVE_LLM` state; if present, use as active LLM and return.
  - If absent, obtain default LLM from system card (see section 2) and emit initial `APP_BOXEL_ACTIVE_LLM` event with that model.

### 2. System-card-backed default LLM
- Locate the system card that defines the default LLM configuration.
- Add a host-side helper (reachable from `MatrixService`) that:
  - Uses runtime `loader.import` to read `https://cardstack.com/base/*` configuration.
  - Derives and returns the default LLM identifier for a room.
- Ensure no host code uses static ESM imports for base realm modules.

### 3. Remove submode-specific defaults
- In `MatrixService`, remove logic that:
  - Chooses different defaults for Code vs Interact submodes.
  - Reapplies a default when the submode changes or AI panel is reopened.
- Confirm submode changes only affect UI state and never emit `APP_BOXEL_ACTIVE_LLM` events.

### 4. Clean up default LLM constants
- Search for hard-coded default LLM constants (especially submode-specific ones).
- Replace their usage so that:
  - Initial selection uses the system-card-backed default via the helper from step 2.
  - Non-initial flows either use the existing active LLM from state or the user’s explicit choice.
- Delete obsolete constants and unused helpers.

### 5. Remove selection source tracking
- Remove `selectionSource` from `APP_BOXEL_ACTIVE_LLM` event content types and builders.
- Update all callers so they no longer pass or inspect `selectionSource`.
- Ensure events are only written when:
  - Initial default is set for a room (step 1).
  - A user explicitly selects a new model (dropdown, `use-ai-assistant` command, etc.).

### 6. RoomResource and callers
- Remove `RoomResource.hasUserSelectedLLM` and any control flow that depends on it.
- Simplify callers to rely solely on presence and content of `APP_BOXEL_ACTIVE_LLM`:
  - If present, use its model as the active LLM.
  - Do not special-case “system vs user” selections.

### 7. Edge cases and behavior validation
- Verify behavior when:
  - Creating a new room (initial default persists to state).
  - Joining an existing room from a fresh client (active LLM is read from state).
  - Toggling submodes (no LLM changes or new events).
  - User changes the LLM, then reloads or joins from another client (chosen model persists).
- Confirm that changing the system card default only affects rooms created after the change.

### 8. Tests and linting
- Add/adjust tests in relevant host/realm packages to cover:
  - Initial default selection from system card.
  - Persistence across reloads and clients.
  - No LLM changes on submode toggles.
  - Removal of `selectionSource` and `hasUserSelectedLLM` behavior.
- Run `pnpm lint` in modified packages and the relevant test suites before committing.

