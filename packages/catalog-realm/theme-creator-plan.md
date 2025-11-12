# ThemeCreatorCard Plan

## Overview
- Entry-point card for designers to craft prompts, select realms/code refs, and generate new `style-reference`, `theme`, and `brand-guide` cards via AI.
- Surfaces both inspirational search results and newly generated drafts so iteration happens without leaving the card.
- Provides hooks to regenerate prompts, edit selected outputs in ThemeEditorCard, and publish ready drafts through CatalogPublisherCard.

## CardDef Model
```ts
export class ThemeCreatorCard extends CardDef {
  @field prompt = contains(MarkdownField);
  @field realm = contains(RealmField);
  @field codeRef = contains(CodeRefField); // constrained to 3 generator modules
  @field numberOfVariants = contains(NumberField); // maps to command `count`
}
```
# General User Actions
- Author/update prompts, realms, and code refs, then run generation with single or multiple variants.
- Browse existing catalog cards for inspiration, copy snippets, and insert references into the prompt.
- Review, view, edit, or delete newly generated drafts; maintain clean history with multi-select delete.
- Preview the latest generation with JSON tabs and status feedback.
- Hand off selected drafts to ThemeEditor for prompt-based tweaks or to CatalogPublisher for publishing.

## UI Layout

### Visuals
1. **Prompt Controls** – markdown prompt, realm dropdown, codeRef select, number-of-variants input, inspiration chips, `Generate`/`Regenerate` buttons with inline guidance text. All fields render via standard Fields API / FieldContainer components; no custom actions tied directly to the inputs.
2. **Existing Cards Inspector** – `PaginatedCards` showing search results with filters (realm, tags, designer, updated date) and quick actions to copy snippets.
3. **Newly Generated Cards** – second `PaginatedCards` scoped to latest runs, each card row offering view/edit/tweak controls plus multi-select checkboxes, `Delete Selected`/`Delete All` operations, and an inline progress indicator that reflects generation status per row (e.g., pending/running/success/error when multiple generations are in-flight).
4. **Generation Preview Pane** – latest generated card render, structured-theme/style-reference/theme JSON tabs, status banner, and history metadata.
5. **Publish Panel** – embedded CatalogPublisherCard summarizing the currently selected draft with publish readiness indicators.

### Button Actions
- `Generate` / `Regenerate` – trigger AI generation (disabled until prompt + realm + codeRef + valid variant count; shows loading state tied to command).
- `Delete Selected` / `Delete All` – remove generated drafts from history; confirm before bulk delete.
- `View Card` – opens side-stack preview using ThemeEditor or generic viewer (enabled whenever a card row is selected).
- `Edit Card` – launches ThemeEditorCard with a tweak prompt dialog; disabled if a patch is running for that card.
- `Publish to Catalog` – exposed via embedded CatalogPublisherCard once a valid draft is selected; disabled during publish or when no draft exists.

## Queries
- **Existing Cards Query** – powers the first `PaginatedCards`, filtering by realm/tags/designer/updated date; supports pagination + reset when filters change.
- **Newly Generated Cards Query** – scoped to cards created in the current session/realm; supports pagination, selection state, and refresh after regeneration or deletion.
- Both queries reuse the existing search API and should respect caching/invalidation when realms or prompts change.

## Commands
- `GenerateExampleCardsCommand` – produces structured-theme/style-reference/theme payloads for new drafts (parameterized with numberOfVariants/count and selected codeRef).
- `PublishToCatalogCommand` / `ListingCreateCommand` – run via embedded CatalogPublisherCard when publishing.
- Search API command set – used under the hood by `PaginatedCards` to fetch both existing and newly generated cards.

## Components
- FieldContainer-based prompt/realm/codeRef/number inputs.
- Two `PaginatedCards` instances (existing + newly generated lists) with custom actions per row.
- `CardPreviewPanel` that renders the selected card (and JSON tabs) by calling `getCard` under the hood.
- NotificationBubble / WorkflowProgress for state + status messaging.
- Embedded CatalogPublisherCard.

## Card API
### Actions Used
- `getCard` (via `CardPreviewPanel`) to fetch selected cards for the preview pane / `View Card` interactions.
- Workflow/command invocation helpers to run `GenerateExampleCardsCommand` and capture results.

### Menu Action
- No additional context-menu actions beyond the explicit buttons described above.

## How Is This Shared With Users?
- Primarily accessible inside code-mode or advanced tooling flows rather than broadly exposed in the catalog; designers open it via internal dashboards or command palette.

## Who Uses It?
- Brand/visual designers and art directors responsible for crafting new themes and style references.
- Secondary users: design reviewers who inspect generated drafts before approving publication.

## TODO / Commit-Sized Tasks
- [x] Build Visual 1 (Prompt Controls): field wiring, FieldContainer layout, generate/regenerate buttons, inline guidance.
- [x] Configure `codeRef` field dropdown with the three generator modules + helper copy (lives alongside Visual 1 form).
- [ ] Build Visual 2 (Existing Cards Inspector): reuse/port `PaginatedCards`, wire filters, copy + view/edit actions.
- [ ] Build Visual 3 (Newly Generated Cards): `PaginatedCards` with view/edit/tweak buttons, multi-select + delete-all UX, and per-row progress indicators for in-flight generations.
- [ ] Build Visual 4 (Generation Preview Pane): `CardPreviewPanel`, JSON tabs, status banner, history metadata.
- [ ] Build Visual 5 (Publish Panel): embed CatalogPublisherCard with readiness indicators + publish actions.
- [ ] Implement command integration: connect `GenerateExampleCardsCommand` invocation + result handling.
- [ ] Extend/modify components: add multi-select delete support to `PaginatedCards` and create `CardPreviewPanel`.
- [ ] Wire button actions + state handling (view/edit/delete/regenerate/publish) across the card.
