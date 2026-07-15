---
name: boxel-theme-development
description: Develop Boxel Theme, StructuredTheme, StyleReference, DetailedStyleReference, and BrandGuide cards. Use when creating, converting, auditing, or patching theme/style/brand-guide artifacts; importing or exporting Google DESIGN.md design-system briefs; choosing Boxel Brand Guide vs custom brand styling; or working with logo/mark usage, functional palettes, typography, and theme tokens.
boxel:
  kind: skill
---

# Boxel Theme Development

Use this for the theme artifact itself. Use `boxel-design` when the task is primarily styling a card template, and pair both skills when a card design drives a new theme.

## Read First

1. `boxel/references/theme-design-system.md` for the Boxel theme hierarchy, Brand Guide fields, token names, and Boxel Brand Guide rule.
2. `references/shadcn-boxel-token-mapping.md` before assigning semantic color, spacing, radius, or component-facing token values.
3. `references/design-md-adapter.md` when the input or output is a Google `DESIGN.md` file, a brand brief, or a generic design-system document.
4. `boxel-design/SKILL.md` when inventing visual direction, voice, typography, or brand mood.
5. `boxel-ui-guidelines/references/use-boxel-design-tokens-for-theming.md` when checking how templates will consume the theme.
6. `source-code-editing/SKILL.md` before editing any `.gts`; `boxel/references/lint-workflow.md` before declaring `.gts` work done.

## Workflow

1. **Classify the job.**
   - Create: build a new Theme/StyleReference/BrandGuide instance.
   - Convert: map `DESIGN.md`, a brand guide, an existing site, or another token system into Boxel fields.
   - Audit: compare an existing theme card against Boxel fields, DESIGN.md rules, accessibility, and downstream template needs.
   - Patch: preserve the existing theme class and structured fields while improving values and prose.

2. **Choose the narrowest correct card type.**
   - `StructuredTheme`: token-only theme with structured root/dark variables and typography.
   - `StyleReference`: visual DNA, inspirations, and wallpaper imagery matter.
   - `DetailedStyleReference`: a complete design system needs documented palette, type, layout, motion, components, voice, and quality rules.
   - `BrandGuide`: logo/mark usage, official brand colors, functional palette, typography, or brand governance matters.
   - Boxel built-in feature work: use `https://cardstack.com/base/Theme/boxel-brand-guide` as the source of truth.

3. **Gather source material.**
   - Existing Theme/BrandGuide JSON, if present.
   - Any `DESIGN.md`, style guide, brand guide, logo pack, font URLs, screenshots, or reference sites.
   - Current realm conventions: where Theme cards live, how instances link `cardInfo.theme`, and whether a parent card computes `cardTheme`.

4. **Map values before writing.**
   - Tokens are exact implementation values.
   - Prose explains why and when to use them.
   - Put logo and mark material in `markUsage`; never invent miscellaneous string fields for brand assets.
   - Put brand colors in `brandColorPalette` and role colors in `functionalPalette`.
   - Put semantic UI values in `rootVariables` and `darkModeVariables`.
   - Treat shadcn-style tokens as paired surface/foreground contracts: `--primary` is an action fill or indicator, not ordinary text.
   - Normalize `rootVariables.spacing` for Boxel's runtime `--spacing * 4` mapping. Use `0.25rem` for a 16px `--boxel-sp` base unless there is a deliberate reason to diverge.
   - Put design rationale in `visualDNA` and the DetailedStyleReference markdown fields.

5. **Build or patch the Theme card.**
   - Preserve rich theme structure. Do not flatten `BrandGuide` or `StyleReference` into raw `cssVariables`.
   - Include `attributes.cardInfo` for name, summary, thumbnail, and notes.
   - Omit `relationships["cardInfo.theme"]` on Theme cards themselves.
   - Keep `cssImports` as font/link URLs; do not inline `@import` in templates.
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
