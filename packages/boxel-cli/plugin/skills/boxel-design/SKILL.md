---
name: boxel-design
description: Use when designing or styling a Boxel card — choosing colors, typography, theme variables, layout, or visual treatment. Activates for any visual decisions on a card.
boxel:
  kind: skill
---

# boxel-design

Visual decisions for Boxel cards.

## The actual process lives in `boxel/references/design-playbook.md`

[`skills/boxel/references/design-playbook.md`](../boxel/references/design-playbook.md) is the canonical four-stage design workflow:

1. **Stage 1 — Mockup pass** with no variables. Verbatim Pentagram-art-director / internal-taste-maker brief. Hardcoded `#hex`, real fonts, real px sizes. Write the design first; theme tokens come later.
2. **Stage 2 — Extract theme** from the mockup (rule of two — tokenize if a value appears twice+). The Theme card's `cssVariables` ARE the design's palette.
3. **Stage 3 — Tokenize isolated** with `var(--*)` references. Pixel-identical to stage 1.
4. **Stage 4 — Derive embedded + fitted** from the established visual identity. Fitted MUST feature the card's media if any.

Read it in full before any user-facing card design. This skill (`boxel-design`) used to host a menu-driven discovery process; that was removed because curated style menus cap intrinsic LLM design taste at the menu authors' ceiling. Stage 1's "internal taste-maker held in mind" is the antidote — trust the model's taste, push past defaults.

## Brand and Style Source

Choose the governing style source before stage 1:

- **Boxel built-in feature work:** use the built-in Boxel Brand Guide as the style guide (`https://cardstack.com/base/Theme/boxel-brand-guide`). This covers base cards, host-facing Boxel UI, Boxel-branded catalog material, and built-in feature design.
- **User/custom realm work:** derive or choose the Theme/StyleReference/BrandGuide from the user's domain and content. Do not default to Boxel branding unless the user asks for Boxel-branded output.
- **Logo, mark, or official brand material needed:** use a `BrandGuide`; its `markUsage`, `brandColorPalette`, `functionalPalette`, typography, voice, and quality standards are the source. Do not invent logo URLs or store them as miscellaneous string fields.

## Pair with

- **`boxel-ui-guidelines`** — turns design intent into working markup (template-level rules, `@fields` vs `@model`, delegated-render control, format-choice).
- **`boxel-theme-development`** — turns design-system source material into a Theme, Style Reference, Detailed Style Reference, or Brand Guide artifact.
- **`boxel`** — once the design is decided and you're implementing the card. Also hosts the playbook itself.
- **`source-code-editing`** — when applying the resulting styles to existing files.

## Don't use for

- Template syntax decisions (`@fields` vs `@model`, container queries) — that's `boxel-ui-guidelines`.
- Schema or query work — that's `boxel`.

## References this skill still owns

- [`references/critical-rules.md`](references/critical-rules.md) — anti-LLM-cliché checklist ("Rounded Rectangle Syndrome", "Center-All Disease", "Card Grid Autopilot", etc.) + image-URL field-routing rule + design-excellence mindset. Read alongside design-playbook stage 1 to sharpen the internal taste-maker.
- [`references/asset-selection-guidelines.md`](references/asset-selection-guidelines.md) — concrete image-handling guidance: priority order for asset integration, format choices, fit semantics. Useful regardless of process.

The previous five files (`style-reference.md`, `design-controls.md`, `design-discovery-process.md`, `the-design-challenge-standard.md`, `base-theme-variables.md`) were removed — superseded by the design-playbook's stages 1–2.
