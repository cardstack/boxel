# Card Plan Template

Use this template when authoring a new card specification. Replace the guidance text under each heading with concrete details for the card you are planning.

## Overview
- Summarize the card's purpose, target persona(s), and the primary outcome it enables.
- Call out any notable constraints (e.g., must run in side stack, requires host services).

## CardDef Model
- Pseudocode or actual CardDef snippet outlining fields, relationships, and default values.
- Note shared fields/modules reused from other cards.

## UI Layout
### Visuals
- Describe the major sections, layouts, or diagrams that explain how content is arranged.
- Mention responsive considerations or side-stack vs. main-pane placement.

### Button Actions
- List each button/action surface, its label, and when it becomes enabled/disabled.
- Include loading/error/success states or confirmation flows.

## General UI User Actions
- Enumerate the main user tasks (e.g., "Create variant", "Preview card", "Publish") and the expected experience for each.
- Note any keyboard shortcuts, drag/drop, or contextual menus.

## Queries
- Detail the data queries/resources the card issues (search APIs, loaders, pagination parameters).
- Mention caching or invalidation behaviors.

## Commands
- List the commands invoked (e.g., `GenerateExampleCardsCommand`, `PatchCardCommand`).
- Describe why each command is used and any required input/output handling.

## Components
- Identify reusable components leveraged (e.g., `PaginatedCards`, `NotificationBubble`).
- Include any new components to be built for this card and their responsibilities.

## Card API
### Actions Used
- Document Card API helpers invoked (e.g., `getCard`, `save`, custom actions) and how they integrate with the card.

### Menu Action
- State whether the card exposes menu actions (contextual menus, kebab actions) and what they do.

## How Is This Shared With Users?
- Explain how end users discover/launch this card (catalog entry, embedded tab, side-stack button) and any sharing links or permissions.

## Who Uses It?
- Define the personas or roles (designer, developer, reviewer) who interact with the card and their goals.
- Note cross-team dependencies or sign-offs needed.
