---
name: boxel-search-cards
description: Find cards in the live Boxel app or in a realm by type, title, or query filter.
boxel:
  kind: skill
---

# /boxel-search-cards

## Use When

- The user wants to locate cards ("find all Projects", "search for 'invoice' in the catalog realm").
- They need a list to act on next.

## Inputs

- Realm URL(s) or "all writable realms".
- The card type (CodeRef or class name).
- (Optional) a title substring or filter criteria.

## Read

1. `skills/boxel-environment/SKILL.md`
2. `skills/boxel-environment/references/searching-and-querying.md`
3. `skills/boxel/references/query-systems.md`

## Procedure

1. If the query is title-based and simple → `SearchCardsByTypeAndTitleCommand_a959`.
2. If the query needs filters (`eq`, `gt`, `range`, `on`-typed) → `SearchCardsByQueryCommand_847d`.
3. Build the `filter.on` reference — typically `{ module: <full URL>, name: <ClassName> }`.
4. Display results — use `show-card_566f` if the user wants to see one; just list otherwise.

## Done Criteria (self-verify)

- [ ] The query filter has an `on` property (required for Boxel queries).
- [ ] `module` is the full URL, not a relative path.
- [ ] The realm list is explicit (no implicit "current realm").
- [ ] Results count is reported back to the user.

## Failure Recovery

- "Error: field path not found" → use `chapters[0].title` notation, not `chapters.0.title` or `chapters.title[0]`.
- Zero results when expected → verify the `module` URL exactly matches the class's module (use `read-file-for-ai-assistant` on the `.gts` if unsure).
