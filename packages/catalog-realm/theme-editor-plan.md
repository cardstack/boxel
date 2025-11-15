# ThemeEditorCard Plan

## Overview
- Side-stack card launched from ThemeCreator via `Edit Card` actions to apply natural-language tweaks to generated cards.
- Keeps edits localized, auditable, and ready for immediate publishing.
- Secondary goal: allow reviewers to inspect and adjust specific cards without rerunning the entire generation workflow.

## CardDef Model
```ts
export class ThemeEditorCard extends CardDef {
  @field card = linksTo(() => CardDef); // selected card under edit
  @field prompt = contains(MarkdownField); // tweak instructions
}
```
- Additional metadata (patch history, status) can be stored via linked records or per-run state in the host app.

## UI Layout
### Visuals
1. **Header Summary** – card title, realm, quick link to open full card preview in side stack.
2. **Prompt Panel** – markdown textarea with helper text outlining acceptable tweaks, optional variant selector dropdown if multiple variants exist.
3. **Patch Controls** – cluster of action buttons (`Apply Patch`, `Undo Patch`, `Publish Card`, `Close`) with status badges.
4. **Patch History List** – vertical list of prior prompts/results with success/error icons and timestamps.
5. **Status Banner** – NotificationBubble showing idle/loading/error/success state for the latest patch command.

### Button Actions
- `Apply Patch` – sends the prompt to `PatchCardCommand`/`PatchFieldsCommand`; disabled when prompt empty or a patch is running.
- `Undo Patch` – reverts to the previous successful state; disabled when no history exists.
- `Publish Card` – forwards the linked card to CatalogPublisher; disabled while patching/publishing or when errors persist.
- `Close` – dismisses ThemeEditor and returns focus to ThemeCreator.
- Optional `View Card` button in the header for quick preview.

## General UI User Actions
- Inspect card metadata/preview to confirm current state.
- Enter or adjust prompt instructions describing desired tweaks.
- Run patches iteratively, reviewing history entries and statuses after each attempt.
- Publish directly once satisfied, or close the editor to return to ThemeCreator.

## Queries
- Fetch the selected card details (via `getCard` or equivalent loader) when ThemeEditor opens.
- Retrieve patch history entries stored in ThemeCreator (or associated records) so designers can review prior prompts.

## Commands
- `PatchCardCommand` / `PatchFieldsCommand` – core patch execution (one command may be chosen depending on implementation).
- `PublishToCatalogCommand` / `ListingCreateCommand` – invoked when `Publish Card` is pressed (delegating to CatalogPublisher logic).

## Components
- FieldContainer-based prompt textarea.
- NotificationBubble/WorkflowProgress for status feedback.
- Patch history list component (reusable table/list with status icons).
- Integration hook to open CatalogPublisherCard (or inline publishing UI) when publish action is triggered.

## Card API
### Actions Used
- `getCard` to load the selected card and display its preview metadata.
- `save` or equivalent to persist patch results/history when needed.
- Command invocation helpers for patching and publishing.

### Menu Action
- No additional menu actions; all controls are explicitly rendered in the layout.

## How Is This Shared With Users?
- Accessible via `Edit Card` buttons inside ThemeCreator (existing or newly generated lists) or via direct links when reviewing a card.
- Can be opened in the side stack, preserving the ThemeCreator context underneath.

## Who Uses It?
- Designers/editors refining generated cards.
- Reviewers conducting targeted adjustments before approving publication.

## TODO / Commit-Sized Tasks
- [ ] Implement ThemeEditorCard schema + template (prompt panel, history list, status banner) in side-stack UI.
- [ ] Wire patch commands, tracked states (`isPatching`, `patchHistory`, `lastPatchError`), and history persistence; add tests for success/error flows.
- [ ] Integrate `Publish Card` shortcut with CatalogPublisher, ensuring proper gating and messaging.
- [ ] Ensure edits propagate back to ThemeCreator views (refresh newly generated list, preview, and history entries).
