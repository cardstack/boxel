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

1. `skills/boxel-theme-development/SKILL.md`.
2. `skills/boxel-theme-development/references/shadcn-boxel-token-mapping.md` before assigning semantic token values.
3. `skills/boxel-theme-development/references/design-md-adapter.md` if DESIGN.md, brand-guide prose, or token conversion is involved.
4. `skills/boxel/references/theme-design-system.md`.
5. `skills/boxel-patterns/patterns/theme-first-workflow/README.md`.
6. `skills/boxel-design/SKILL.md` when visual direction must be invented or improved.
7. `skills/boxel-ui-guidelines/references/use-boxel-design-tokens-for-theming.md` when checking downstream template token usage.
8. `skills/source-code-editing/SKILL.md` before `.gts` edits.

## Procedure

1. **Identify the source of truth.**
   - Boxel built-in feature: use `https://cardstack.com/base/Theme/boxel-brand-guide`.
   - User/custom realm: use the user's brand/design source.
   - Existing theme patch: preserve the current theme subclass unless there is a clear reason to upgrade.

2. **Choose the artifact type.**
   - Token-only -> `StructuredTheme`.
   - Visual DNA and inspirations -> `StyleReference`.
   - Full style system prose -> `DetailedStyleReference`.
   - Logo/mark/brand governance -> `BrandGuide`.

3. **Map source material.**
   - For DESIGN.md: map YAML tokens and markdown sections through `design-md-adapter.md`.
   - For generic brand guides: extract exact tokens, then prose rules; do not leave critical values only in prose.
   - For logos/marks: use `markUsage`; do not inline data URLs or image bytes.
   - For shadcn-style tokens: keep surface/foreground pairs intact, keep `--primary` out of ordinary text roles, and normalize Boxel `spacing` through the `--spacing * 4` runtime rule.

4. **Write or patch the card.**
   - Preserve structured fields: `rootVariables`, `darkModeVariables`, `typography`, `brandColorPalette`, `functionalPalette`, and `markUsage`.
   - Include `attributes.cardInfo`.
   - Omit `relationships["cardInfo.theme"]` on Theme cards.
   - Keep font imports in `cssImports`.

5. **Link consumers if requested.**
   - Non-Theme instances can link through `relationships["cardInfo.theme"]`.
   - CardDefs can compute `cardTheme` from a parent/default when that is the cleaner model.
   - Prefer absolute Theme URLs for nested folders until relative paths are verified.

6. **Validate.**
   - If a DESIGN.md file is involved and the CLI is available, run `npx @google/design.md lint DESIGN.md`.
   - If `.gts` files changed, run `npx boxel file lint` before push and `npx boxel lint` after push.
   - Preview the Theme/BrandGuide and at least one consuming card.
   - Check buttons, inputs, dropdowns, tooltips, pills, and card containers for token-pair contrast and spacing scale.

## Done Criteria

- [ ] The chosen Theme subclass matches the source material.
- [ ] Exact token values are captured in structured fields, not prose only.
- [ ] Style/brand rationale is captured in `visualDNA` or DetailedStyleReference markdown fields.
- [ ] Logo/mark material, if any, is captured in `markUsage`.
- [ ] Theme JSON has `attributes.cardInfo` and no self-theme relationship.
- [ ] Consuming instances or CardDefs have a clear theme linkage strategy.
- [ ] Shadcn/Boxel semantic pairs are complete; `--primary` is not used as ordinary text; `spacing` is normalized for Boxel.
- [ ] Relevant lint/preview checks were run, or the reason they could not run is stated.
