## Matrix LLM selection: revert submode defaults & simplify behavior

### Background

We recently introduced a distinction between “system default” and “user-selected” LLMs at the room level and persisted this in Matrix state:

- `APP_BOXEL_ACTIVE_LLM` state event content gained a `selectionSource: 'system' | 'user'` field.
- `RoomResource` derives a `hasUserSelectedLLM` property from the latest `APP_BOXEL_ACTIVE_LLM` event.
- All callers that set the active LLM now pass an explicit `selectionSource` value:
  - `'user'` from the LLM dropdown and `use-ai-assistant` command.
  - `'system'` from defaulting logic.
- `MatrixService` submode default logic was refactored so that:
  - Changing submode (Code ↔ Interact) applies a submode-specific default model **only if** the room has never had a user-selected LLM.
  - Once a user selection is recorded, subsequent submode switches and AI panel re-entries no longer overwrite the active LLM; the room keeps using the user’s chosen model across reloads/clients.

### New direction

We want to simplify this behavior by:

1. **Reverting submode-specific default logic**
   - Remove the “submode default” behavior in `MatrixService` so that switching between Code/Interact does **not** trigger model selection logic.
   - Eliminate the concept of a default LLM per submode; submode changes should leave the active LLM untouched.

2. **Establishing a single room-level default LLM**
   - Determine the room’s default LLM **once**, when the room is first initialized / joined, and use that as the active model until the user explicitly changes it.
   - Persist this active LLM through the existing Matrix state machinery (`APP_BOXEL_ACTIVE_LLM` event), so that:
     - Reloads and cross-client sessions see the same initial default model.
     - Subsequent user selections override the initial default and are also persisted.

3. **Sourcing the default from the system card**
   - Stop using hard-coded default LLM constants for submodes or globally.
   - Instead, fetch the default model from the system card configuration, and use that value when computing the room’s initial active LLM.
   - Ensure this logic lives in a place that:
     - Is available to `MatrixService` / room initialization code.
     - Does not violate the “base realm imports” constraint (host-side code should use runtime `loader.import` for `https://cardstack.com/base/*` modules).

4. **Removing selection source tracking**
   - Remove the `selectionSource` field from `APP_BOXEL_ACTIVE_LLM` event content.
   - Treat the active LLM as an opaque “current choice”:
     - Initially set from the system-card-derived default when the room is created.
     - Later updated only when the user explicitly selects a different model (LLM dropdown, `use-ai-assistant` command, etc.).
   - Submode changes **must not** emit new events or overwrite the active LLM.

### Proposed implementation steps

- **MatrixService / room init**
  - Identify the code path where a room is first created/entered and the AI panel is initialized.
  - Insert logic to:
    - Check for an existing `APP_BOXEL_ACTIVE_LLM` event; if present, respect it and do nothing.
    - If absent, read the system card default LLM and set it as the active LLM with `selectionSource: 'system'`.

- **Remove submode defaulting**
  - Delete or simplify the logic that:
    - Picks different defaults per submode (Code/Interact).
    - Re-applies a default model on submode changes.
  - Ensure submode changes only affect UI state, not the active LLM selection.

- **Clean up default LLM constants**
  - Locate any default LLM constants that encode submode-specific defaults (e.g. “code default model” vs “chat default model”).
  - Remove them, and route all default-selection behavior through the system-card-backed function used at room initialization.

- **RoomResource and callers**
  - Remove the `RoomResource.hasUserSelectedLLM` property and any logic that depends on it.
  - Simplify all callers so they:
    - No longer pass or reason about `selectionSource`.
    - Only update the active LLM when the user explicitly chooses a model (no updates on submode changes).

### Decisions / edge cases

- **Beginning of the room**
  - Defined as the time the room is created (e.g. via the command that creates a new session/room).
  - At creation time, we:
    - Compute the room’s default LLM using the system card.
    - Persist this as the initial `APP_BOXEL_ACTIVE_LLM` event.
  - Subsequent joins or AI panel openings do **not** recompute or overwrite the default.

- **System card default LLM changes later**
  - Existing rooms with a recorded `APP_BOXEL_ACTIVE_LLM` keep their current model (no migration).
  - New rooms created after the system card changes use the new default model.

- **`selectionSource` and `hasUserSelectedLLM`**
  - We will remove both:
    - `selectionSource` is no longer needed on Matrix state events.
    - `RoomResource.hasUserSelectedLLM` is no longer needed for control flow.
  - The presence of an `APP_BOXEL_ACTIVE_LLM` event is sufficient to know that the room already has an active model (regardless of how it was chosen).
