---
name: boxel-theme-development
description: Use when the deliverable is a theme ARTIFACT — creating, converting, auditing, or patching Theme, StructuredTheme, StyleReference, DetailedStyleReference, or BrandGuide cards; importing/exporting Google DESIGN.md design-system briefs; logo/mark usage and functional palettes. NOT for deciding a card's visual language (boxel-design) and NOT for applying tokens inside card templates (boxel-ui-guidelines).
boxel:
  kind: skill
---

# Boxel Theme Development

Use this for the theme artifact itself. Use `boxel-design` when the task is primarily styling a card template, and pair both skills when a card design drives a new theme.

## Read First

1. `boxel/references/theme-design-system.md` for the Boxel theme hierarchy, Brand Guide fields, the Boxel Brand Guide rule, and dark mode (§3.3: `data-theme`, `darkModeVariables`).
2. `boxel-ui-guidelines/references/theme-token-contract.md` for the full list of tokens a theme must satisfy — the only inventory; nothing else lists them.
3. `references/shadcn-boxel-token-mapping.md` before assigning semantic color, spacing, radius, or component-facing token values.
4. `references/design-md-adapter.md` when the input or output is a Google `DESIGN.md` file, a brand brief, or a generic design-system document.
5. `boxel-design/SKILL.md` when inventing visual direction, voice, typography, or brand mood.
6. `boxel-ui-guidelines/references/use-boxel-design-tokens-for-theming.md` when checking how templates will consume the theme.
7. `source-code-editing/SKILL.md` before editing any `.gts`; `boxel/references/lint-workflow.md` before declaring `.gts` work done.

## Workflow

1. **Classify the job.**
   - Create: build a new Theme/StyleReference/BrandGuide instance.
   - Convert: map `DESIGN.md`, a brand guide, an existing site, or another token system into Boxel fields.
   - Audit: compare an existing theme card against Boxel fields, DESIGN.md rules, accessibility, and downstream template needs.
   - Patch: preserve the existing theme class and structured fields while improving values and prose.

2. **Choose the narrowest correct card type** from the ThemeCard Types table in `boxel/references/theme-design-system.md` (`StructuredTheme` floor, `StyleReference`, `DetailedStyleReference`, `BrandGuide`). Boxel built-in feature work uses `@cardstack/base/Theme/boxel-brand-guide` as the source of truth.

3. **Gather source material.**
   - Existing Theme/BrandGuide JSON, if present.
   - Any `DESIGN.md`, style guide, brand guide, logo pack, font URLs, screenshots, or reference sites.
   - Current realm conventions: where Theme cards live, how instances link `cardInfo.theme`, and whether a parent card computes `cardTheme`.

4. **Map values before writing.**
   - Tokens are exact implementation values.
   - Prose explains why and when to use them.
   - Place brand material where the Brand Guide Pattern in `boxel/references/theme-design-system.md` says: marks in `markUsage`, brand colors in `brandColorPalette`, role colors in `functionalPalette`, semantic UI values in `rootVariables` and `darkModeVariables`. Never invent miscellaneous string fields for brand assets.
   - Treat each paired surface token as a surface/foreground pair ("Colors" in the token contract; the neutral surfaces such as `--canvas` and `--field` have no pair and must read under `--foreground`): `--primary` is a fill, not text, and `--muted` is a pale *surface* while `--muted-foreground` is quiet-but-readable *text*; defining both as dark grays yields dark-on-dark tables in long-form Markdown.
   - Normalize `rootVariables.spacing` for the runtime's `--spacing * 4` rule ("Spacing" in the token contract; conversion table in `references/shadcn-boxel-token-mapping.md`).
   - Put design rationale in `visualDNA` and the DetailedStyleReference markdown fields.

5. **Build or patch the Theme card.**
   - Preserve rich theme structure. Do not flatten `BrandGuide` or `StyleReference` into raw `cssVariables`, and never build on the bare `Theme` card: `StructuredTheme` is the minimum, `BrandGuide` when custom variables outside the contract are needed.
   - Include `attributes.cardInfo` for name, summary, thumbnail, and notes.
   - Omit `relationships["cardInfo.theme"]` on Theme cards themselves.
   - Do not write `cssImports`; it is derived from the font fields (`boxel-ui-guidelines/references/font-loading-theme-card-owns-imports.md`).
   - Never nest `@media` blocks inside `cssVariables` — the theme parser silently skips those declarations. Dark-mode values belong in `darkModeVariables`.
   - Use absolute URLs for cross-realm theme links unless a relative path has been verified.

6. **Validate.**
   - If a `DESIGN.md` file exists and the CLI is available, run `npx @google/design.md lint DESIGN.md`; request approval first if package download is required.
   - If editing `.gts`, run the Boxel lint gate from `boxel/references/lint-workflow.md`.
   - Preview the Theme/BrandGuide card and at least one consuming card instance.
   - Check contrast for semantic pairs (`--primary`/`--primary-foreground`, etc.) and ensure ordinary templates can use semantic tokens without reaching into raw brand colors.
   - Audit component-facing values against `references/shadcn-boxel-token-mapping.md`, especially primary-as-text and spacing-scale failures.

## Done Criteria

- [ ] The chosen card type matches the source material and intended reuse.
- [ ] Tokens and prose both exist when the theme is more than token-only.
- [ ] Brand assets live in `markUsage`; brand palette lives in `brandColorPalette` and `functionalPalette`.
- [ ] `rootVariables`, `darkModeVariables`, and `typography` are structured where the card type supports them.
- [ ] No Theme card links to another Theme through `cardInfo.theme`.
- [ ] Boxel built-in feature work uses the Boxel Brand Guide.
- [ ] If DESIGN.md was involved, token/prose mapping was checked against `references/design-md-adapter.md`.
- [ ] Shadcn/Boxel token pairing was checked: `--primary` is not ordinary text, foreground pairs exist, and spacing uses the Boxel normalized value.
