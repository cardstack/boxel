---
name: boxel-develop-theme
description: Create, convert, audit, or patch a Boxel Theme, Style Reference, Detailed Style Reference, or Brand Guide.
boxel:
  kind: skill
---

# /boxel-develop-theme

## Use When

- The user asks to create or improve a Theme, Structured Theme, Style Reference, Detailed Style Reference, or Brand Guide.
- The input is a Google `DESIGN.md`, brand guide, style guide, design-system notes, token file, logo pack, or existing Theme JSON.
- The request is about Boxel built-in feature styling and needs the Boxel Brand Guide.
- The output should govern future card design, not just polish one card template.

## Inputs

- Realm URL or local realm path.
- Existing Theme/BrandGuide JSON path, `DESIGN.md` path, brand/style brief, or source URL.
- Desired artifact type if known: `StructuredTheme`, `StyleReference`, `DetailedStyleReference`, or `BrandGuide`.
- Whether consuming card instances should be linked or updated.

## Read

1. `skills/boxel-theme-development/SKILL.md` — THE workflow (classify → choose card type → gather → map → build → validate). This command follows it end to end.
2. `skills/boxel-theme-development/references/shadcn-boxel-token-mapping.md` before assigning semantic token values.
3. `skills/boxel-theme-development/references/design-md-adapter.md` if DESIGN.md, brand-guide prose, or token conversion is involved.
4. `skills/boxel/references/theme-design-system.md`.
5. `skills/boxel-patterns/patterns/theme-first-workflow/README.md` — how consumers link themes.
6. `skills/boxel-design/SKILL.md` when visual direction must be invented or improved.
7. `skills/boxel-ui-guidelines/references/use-boxel-design-tokens-for-theming.md` when checking downstream template token usage.
8. `skills/source-code-editing/SKILL.md` before `.gts` edits.

## Procedure

1. **Classify the job and identify the source of truth** (SKILL.md step 1): create / convert / audit / patch. Boxel built-in feature work uses the Boxel Brand Guide; existing theme patches preserve the current subclass unless there's a clear reason to upgrade.
2. **Choose the narrowest correct card type** (SKILL.md step 2): token-only → `StructuredTheme`; visual DNA/inspirations → `StyleReference`; full style-system prose → `DetailedStyleReference`; logo/mark/brand governance → `BrandGuide`.
3. **Map source material** per SKILL.md step 4, routing through `design-md-adapter.md` (DESIGN.md/brand prose) and `shadcn-boxel-token-mapping.md` (semantic pairs, spacing normalization) as applicable.
4. **Build or patch the card** per SKILL.md step 5 (preserve structured fields, `cardInfo`, no self-theme relationship, fonts in `cssImports`).
5. **Link consumers if requested** per `theme-first-workflow` — `relationships["cardInfo.theme"]` on instances, or a computed `cardTheme` on the CardDef when inheritance is the cleaner model.
6. **Validate** per SKILL.md step 6, including the `.gts` lint gate from `boxel/references/lint-workflow.md` when card code changed, and preview the theme plus at least one consuming card.

## Done Criteria

- [ ] All items in the Done Criteria of `boxel-theme-development/SKILL.md` pass.
- [ ] Consuming instances or CardDefs have a clear theme linkage strategy.
- [ ] Relevant lint/preview checks were run, or the reason they could not run is stated.
