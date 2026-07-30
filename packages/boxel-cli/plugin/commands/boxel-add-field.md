---
name: boxel-add-field
description: Add or change schema fields, computed fields, or relationships on an existing CardDef/FieldDef.
boxel:
  kind: skill
---

# /boxel-add-field

## Use When

- A card already exists and the user wants to add, rename, retype, or remove a field.
- They want a computed field, a `linksTo`/`linksToMany`, or a `contains`/`containsMany`.

## Inputs

- Path to the `.gts` file.
- Field name + type + relationship intent.
- Whether existing instances need to be migrated.

## Read

1. `skills/boxel/SKILL.md`
2. `skills/boxel/references/lint-workflow.md`
3. `skills/source-code-editing/SKILL.md`
4. If the field is file-typed: `skills/boxel-file-def/SKILL.md`.
5. If the field is enum-ish: `skills/boxel/references/enumerations.md`.

## Procedure

1. Read the current file to confirm its shape.
2. Identify whether the target type extends CardDef (use `linksTo`) or FieldDef (use `contains`).
3. SEARCH/REPLACE to add the `@field foo = …` declaration.
4. If templates reference the old shape, update them in the same edit.
5. If schema changed, run `/boxel-migrate-schema` to update affected instances.

## Done Criteria (self-verify)

- [ ] The new field uses `linksTo`/`linksToMany` if it points at a CardDef, `contains`/`containsMany` if FieldDef.
- [ ] Computed fields wrap field access in try/catch when crossing card boundaries.
- [ ] No self-referencing computed fields.
- [ ] Changed `.gts` files passed installed npm `boxel` lint (`npx boxel file lint ... --file <local-file>` before push and `npx boxel lint <path> --realm <url>` after push).

## Failure Recovery

- "Cannot find module" after adding an import → check the path; relative paths must use `./` or `../`.
- Instances now invalid → propose `/boxel-migrate-schema` next.
