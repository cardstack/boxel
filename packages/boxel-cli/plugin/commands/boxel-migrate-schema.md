---
name: boxel-migrate-schema
description: Find existing card instances after a schema change and update them in batches.
boxel:
  kind: skill
---

# /boxel-migrate-schema

## Use When

- A CardDef field was added, removed, or renamed.
- The user wants existing instances brought up to the new shape.

## Inputs

- The CardDef whose schema changed.
- The migration: which fields to add/remove/rename, what defaults to use.

## Read

1. `skills/boxel/SKILL.md`
2. `skills/boxel-environment/SKILL.md` (focus: `references/workflows-and-orchestration.md`)
3. `skills/source-code-editing/SKILL.md`

## Procedure

1. Search for affected instances via `SearchCardsByQueryCommand_847d` (filter on the changed CardDef).
2. Count them. If ≤10, fix all. If >10, ask the user: "Found N. Fix first 10?".
3. For each instance, SEARCH/REPLACE the JSON. Add missing fields with defaults, rename keys, remove stale fields.
4. After the batch, re-search to verify count drops; ask "Next 10 of K remaining?" until done.
5. After all instances are updated, run `/boxel-preview-card` on a sample to verify rendering.

## Done Criteria (self-verify)

- [ ] Every searched instance is either updated or explicitly skipped.
- [ ] No instance still uses the removed/renamed field shape.
- [ ] Sampled instances render without error in preview.
- [ ] User confirmed at each batch boundary (no silent runaway).

## Failure Recovery

- Indexing hasn't caught up → trigger `invalidate-realm-identifiers_xxxx` for the affected files.
- "Card has no canonical URL" → check `id` field on the JSON is set; it may have been lost.
