# CatalogPublisherCard Plan

## Overview
- Lightweight card that links to any card instance (ThemeCreator output, ThemeEditor result, or external card) and publishes it to the catalog via listing creation.
- Decouples publishing from generation/editing so designers can ship whenever a card is ready.

## CardDef Snapshot
```ts
export class CatalogPublisherCard extends CardDef {
  @field card = linksTo(() => CardDef); // card to publish
}
```

## UI Layout & Flow
1. **Card Selector** – shows current linked card with option to swap/select another card.
2. **Publish Action** – single `Publish to Catalog` button; disabled when no card selected or a publish task is running.
3. **Status Messaging** – inline NotificationBubble indicating idle/loading/success/error; on success, display the resulting listing link.
4. **Guidance Text** – optional copy reminding designers about realm/catalog alignment and naming collisions.

## Safeguards & Behavior
- Validate that a card is linked and ready (e.g., saved to the correct realm) before enabling publish.
- Confirm target realm/catalog path; detect conflicts and prompt for confirmation/rename.
- After success, refresh catalog listings (or emit an event ThemeCreator/Editor can react to) and clear stale errors.

## Commands & Dependencies
- `PublishToCatalogCommand` / `ListingCreateCommand` for listing creation.
- Notification components shared with other cards for status reporting.

## Integration Points
- Embedded within ThemeCreator’s publish section so designers can publish immediately after generation.
- Accessible from ThemeEditor via the `Publish Card` shortcut (passes the currently edited card reference).

## TODO / Commit-Sized Tasks
- [ ] Implement CatalogPublisherCard schema + template (card selector, publish button, status messaging).
- [ ] Wire command invocation + state tracking; handle disable/enable logic and conflict prompts.
- [ ] Integrate with ThemeCreator (embed) and ThemeEditor (shortcut) ensuring card references are passed correctly.
- [ ] Add tests covering success/error paths and lint touched packages.
