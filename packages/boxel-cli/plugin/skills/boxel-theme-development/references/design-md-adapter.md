# DESIGN.md to Boxel Theme Adapter

Google's DESIGN.md format is useful because it separates exact machine-readable tokens from human-readable design rationale. In Boxel terms, that maps to structured theme fields plus style/brand prose.

Sources for this reference:

- Google Labs DESIGN.md repository: `https://github.com/google-labs-code/design.md`
- Google DESIGN.md spec: `https://github.com/google-labs-code/design.md/blob/main/docs/spec.md`
- Google announcement: `https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/`

## What DESIGN.md Contributes

- A single Markdown file represents a design system.
- Optional YAML front matter contains machine-readable tokens.
- Markdown body sections contain rationale and usage guidance.
- Tokens are the normative values; prose explains application.
- The current public format is alpha and may change.

Canonical section order:

1. `Overview` or `Brand & Style`
2. `Colors`
3. `Typography`
4. `Layout` or `Layout & Spacing`
5. `Elevation & Depth` or `Elevation`
6. `Shapes`
7. `Components`
8. `Do's and Don'ts`

Core token groups:

- `colors`: hex sRGB color tokens.
- `typography`: `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, optional feature/variation settings.
- `rounded`: named radius values.
- `spacing`: spacing scale values.
- `components`: component-level properties such as `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, and `width`.

Consumer behavior to preserve:

- Unknown sections should be preserved.
- Unknown valid color and typography token names are allowed.
- Unknown component properties are warnings, not fatal.
- Duplicate canonical section headings are invalid.

Useful CLI commands when available:

```sh
npx @google/design.md lint DESIGN.md
npx @google/design.md diff DESIGN.md DESIGN-v2.md
npx @google/design.md export --format dtcg DESIGN.md
npx @google/design.md export --format css-tailwind DESIGN.md
npx @google/design.md spec --rules
```

Do not install or download the CLI without approval when network access is restricted.

## Boxel Mapping

| DESIGN.md input | Boxel target |
|---|---|
| `name` | `cardInfo.name`; `styleName` if present |
| `description` | `cardInfo.summary`; `visualDNA` short opening |
| `version` | `version` on `StructuredTheme` subclasses |
| `Overview` / `Brand & Style` | `visualDNA`; `historicalContext`; `designMindset` |
| `colors` tokens | `rootVariables`, `darkModeVariables`, `brandColorPalette`, and `functionalPalette` |
| `Typography` tokens | `typography.heading`, `sectionHeading`, `subheading`, `body`, `caption` |
| `Layout` / `spacing` | `rootVariables.spacing`; `compositionRules`; `technicalSpecs` |
| `Elevation & Depth` | shadow variables; `materialVocabulary`; `qualityStandards` |
| `Shapes` / `rounded` | `rootVariables.radius`; `geometricLanguage` |
| `Components` | `componentVocabulary`; component-oriented notes in `technicalSpecs` |
| `Do's and Don'ts` | `qualityStandards`; `designMindset` |
| Logos, marks, clearspace, min size | `markUsage` on `BrandGuide` |
| Inspiration links or imagery | `inspirations`; `wallpaperImages` |

## Choosing a Boxel Theme Class

- Use `StructuredTheme` for DESIGN.md files that only have tokens and minimal prose.
- Use `StyleReference` when the document has a meaningful overview, inspirations, or visual DNA but no formal component/voice/quality sections.
- Use `DetailedStyleReference` when the document has enough rationale to populate the canonical DESIGN.md sections plus Boxel's richer guidance fields.
- Use `BrandGuide` when there is logo material, mark rules, official brand color governance, or a need to publish reusable brand identity.

## Token Translation Rules

- Before assigning semantic tokens, apply `references/shadcn-boxel-token-mapping.md`; Boxel UI consumes these as component contracts, not raw brand swatches.
- Prefer semantic Boxel variables for UI consumption: `--background`, `--foreground`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent`, `--accent-foreground`, `--muted`, `--muted-foreground`, `--border`, `--ring`, `--font-sans`, `--radius`, `--spacing`.
- Map `colors.primary` to `functionalPalette.primary` and usually `rootVariables.primary`, but only as a high-emphasis action surface or indicator. Do not map it to ordinary text.
- Map `colors.secondary` to `functionalPalette.secondary` and usually `rootVariables.secondary`.
- Map an interaction or highlight color to `functionalPalette.accent` and `rootVariables.accent`.
- Map light/dark brand anchors to `functionalPalette.light` and `functionalPalette.dark` when available.
- Put named brand swatches, including non-semantic campaign colors, in `brandColorPalette`; they will become custom `--<dasherized-name>` variables.
- Generate or specify foreground pairs for semantic surfaces. Do not leave `--primary-foreground`, `--secondary-foreground`, or `--accent-foreground` to chance.
- Map typography levels into the five Boxel slots by role:
  - display/headline/hero -> `heading`
  - section title -> `sectionHeading`
  - small title/kicker -> `subheading`
  - body/copy -> `body`
  - caption/label/meta -> `caption`
- DESIGN.md `spacing.base` or `spacing.sm/md` should be normalized to Boxel `rootVariables.spacing`, remembering that Boxel multiplies `--spacing` by 4 to produce `--boxel-sp`. A DESIGN.md base of `1rem` usually becomes Boxel `spacing: 0.25rem`, not `1rem`.
- DESIGN.md `rounded.md` or the default component radius should become `rootVariables.radius`.

## Brand Guide Additions Beyond DESIGN.md

The public DESIGN.md schema does not fully model logo systems. For Boxel BrandGuide work, add or preserve:

- `markUsage.primaryMark1` and `primaryMark2` for primary mark on light/dark backgrounds.
- `markUsage.secondaryMark1` and `secondaryMark2` for alternate or compact marks.
- `markUsage.primaryMarkGreyscale1/2` and `secondaryMarkGreyscale1/2` when greyscale variants exist.
- `markUsage.socialMediaProfileIcon` for app/profile/favicon-like use.
- `primaryMarkMinHeight`, `secondaryMarkMinHeight`, and clearance ratios.

Never inline media bytes or data URLs. Store logo files as realm files or durable HTTP(S) URLs accepted by the BrandLogo fields.

## Audit Checklist

- [ ] YAML token names referenced in `components` resolve.
- [ ] Colors are valid implementation values before they are put in Boxel fields.
- [ ] Markdown sections appear in DESIGN.md order if exporting.
- [ ] Unknown sections are preserved in an appropriate DetailedStyleReference field or notes.
- [ ] Semantic color pairs have readable contrast.
- [ ] `colors.primary` has not become ordinary text; text uses `--foreground`, `--muted-foreground`, or a paired `--*-foreground`.
- [ ] Spacing was normalized for Boxel's `--spacing * 4` runtime rule.
- [ ] Boxel templates can be written using semantic tokens; brand-specific tokens are reserved for identity moments.
- [ ] Theme card itself has `attributes.cardInfo` but no `relationships["cardInfo.theme"]`.
