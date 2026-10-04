---
validated: source-proven
---

# theme-first-workflow — Decide the theme strategy BEFORE building the card

**What this gives you:** A repeatable starting sequence for any new card or app — decide whether Boxel's defaults are sufficient or a specific Theme is wanted, then write the card definition with theme tokens baked in from line one. Link a Theme through `cardInfo.theme` only in the specific-Theme case. The result: cards that ship looking right without unnecessary Theme relationships or hard-coded styling.

**When to use:** Whenever a user asks for a new card, a card family, or an app — before you write the first line of `.gts`. This is meant to run as **step 0** of creating a card, designing one, or any "build me a …" intent.

**The insight:** `boxel-ui`'s `theme.css` supplies defaults for the complete token contract, so cards render with Boxel defaults without a Theme relationship. When a card needs a specific visual identity, Boxel can override those defaults through `cardInfo.theme` — a `linksTo(Theme)` field on every CardDef. The Theme card holds:
- theme variables — structured `rootVariables`, `darkModeVariables`, `typography`, and (for `BrandGuide`) palette/mark fields that compute `cssVariables`. Avoid the bare `Theme` card’s free-form `cssVariables` string, which bypasses the token contract.
- `cssImports` — `<link>` stylesheet URLs, computed from the font stacks (see `boxel-ui-guidelines/references/font-loading-theme-card-owns-imports.md`).

When a card has `cardInfo.theme` set, the CardContainer injects that Theme's CSS variable overrides and imports its fonts. Without one, the same `var(--background)`, `var(--foreground)`, `var(--primary)`, `var(--font-sans)` references resolve to the defaults from `theme.css`.

`BrandGuide` is the richest theme shape. Use it when the theme needs logo/mark usage, brand colors, brand voice, or other identity material. When you are developing Boxel built-in features, base cards, or Boxel-branded catalog output, the style source is the built-in Boxel Brand Guide at `@cardstack/base/Theme/boxel-brand-guide`.

If you skip this step and build the card with hard-coded colors, you've wasted that effort — you'll be ripping them out when the user picks a theme.

**Recipe shape:**

### Step 0 — Decide the theme strategy

Use Boxel defaults when the card does not need a distinct visual or brand identity; do not create or link a Theme in that case. When a specific Theme is wanted, choose among these options in order of preference:

1. **Reuse an existing Theme.** Most realms already have a couple. Browse `<realm>/Theme/*.json` or search with `npx boxel search` filtered on the Theme class. Pick by `styleName` / `visualDNA` fields.
2. **Copy and edit.** Take an existing structured Theme (`StyleReference`, `DetailedStyleReference`, `BrandGuide` — anything descending from `StructuredTheme`), `copy-card` it, and edit its structured fields (`rootVariables`, `darkModeVariables`, `typography`, and on a `BrandGuide` the palette and mark fields). On those cards `cssVariables` and `cssImports` are computed from the structured fields, so never edit them directly. Catalog Themes have a "Copy and Edit" menu item built in.
3. **Author a new Theme.** Choose the narrowest base that preserves the design intent:
   - `@cardstack/base/brand-guide` for a full brand system with logo/mark usage, functional palette, color palette, typography, voice, and detailed style guidance. It is also the only shipped structured theme shape with fields for custom CSS variables outside the token contract, which come at a cost spelled out under "Not part of the contract" in `boxel-ui-guidelines/references/theme-token-contract.md`.
   - `@cardstack/base/detailed-style-reference` for a full style system without logo/mark material.
   - `@cardstack/base/style-reference` for a compact visual DNA reference with inspirations and wallpapers.
   - `@cardstack/base/structured-theme` for a token-only theme. This is the floor: never adopt from or subclass the bare `Theme` (ThemeCard Types in `boxel/references/theme-design-system.md`).

### Step 1 — Link a specific Theme where it applies

Every card instance that should adopt the theme gets a `cardInfo.theme` relationship in its JSON:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "cardInfo": {
        "notes": null,
        "name": "Card title",
        "summary": "Short card summary",
        "cardThumbnailURL": null
      }
    },
    "relationships": {
      "cardInfo.theme": {
        "links": { "self": "../Theme/modern-magazine" }
      }
    }
  }
}
```

**Per-instance install — both halves recommended:**

1. `attributes.cardInfo` should be present as an object with `name`, `summary`, `cardThumbnailURL`, `notes` keys (null is fine for unset values). Without it the user can't later edit the theme through the UI.
2. `relationships["cardInfo.theme"].links.self` points to the Theme card.

The relationship key is **`cardInfo.theme`** with a literal dot — not nested `cardInfo: { theme: ... }`. The literal dot is what the realm parses to install the specific Theme. For CardDefs that use the default `cardTheme` pass-through, no per-instance link means no Theme card installs, but `theme.css` still supplies Boxel's default token values.

**Alternative — computed `cardTheme` on the CardDef:** If the card has a natural source for its theme (a linked parent card, a query for the realm's default theme, etc.), override `cardTheme` directly and skip the per-instance link. `cardInfo.theme` then becomes optional — set it only on instances that should override the computed default.

```gts
// Task inherits Project's theme by default; cardInfo.theme overrides
@field cardTheme = linksTo(() => Theme, {
  computeVia: function (this: Task) {
    return this.cardInfo?.theme ?? this.project?.cardTheme ?? null;
  },
});
```

Use whichever fits the schema. If Boxel's default styling is sufficient, omit both approaches. If a specific Theme is wanted and there is no justified computed source, set `cardInfo.theme` on the instances that should use it.

**For nested app folders, prefer an absolute Theme URL** in `cardInfo.theme.links.self`. Relative paths can resolve ambiguously when the consumer is deeper than expected. Absolute URLs (`https://realms-staging.stack.cards/ctse/<realm>/Theme/<slug>`) always resolve to the same target. Use a relative path only after you've verified it works in the live app for that specific folder depth.

**Never assign `cardInfo.theme` on a Theme card itself.** A Theme is its own ancestor in the visual chain; pointing it at another Theme creates a circular installation and the realm logs an error. Theme instances should have `attributes.cardInfo` for naming/description, but the `cardInfo.theme` relationship key should be omitted entirely. Do not emit a placeholder `{ "links": { "self": null } }` relationship on Theme cards; it is noisy, teaches the wrong shape, and should fail local self-checks.

### Step 2 — Write templates using theme tokens

In `<style scoped>` blocks, reference theme CSS variables exclusively:

```css
.card-shell {
  padding: 1rem;
}
.primary-action {
  background-color: var(--primary);
  color: var(--primary-foreground);
}
```

No hard-coded `#7b61ff`, no `font-family: 'Inter'`. Tokens only. `theme.css` provides their defaults, and a linked or computed Theme can override them.

### Step 3 — Verify via preview

After writing the card and a sample instance, preview it in the live app (see `skills/boxel-environment/SKILL.md`). Confirm that an unthemed instance uses the Boxel defaults, or, when a specific Theme was selected, that the Theme is applied; a missing or incorrect `cardInfo.theme` link is a common cause when the selected Theme does not appear.

**Standard theme tokens to expect (from catalog Themes):**

| Token | What it controls |
|---|---|
| `--background`, `--foreground` | Page-level surface + text |
| `--card`, `--card-foreground` | Card body surface + text |
| `--primary`, `--primary-foreground` | Primary action / brand |
| `--secondary`, `--secondary-foreground` | Secondary action |
| `--accent`, `--accent-foreground` | Highlight surface and the text on it |
| `--primary-ink`, `--accent-ink`, `--success-ink`, … | A hue used *as* text or icon color on a neutral surface (links, status words) |
| `--muted`, `--muted-foreground` | Subdued backgrounds + secondary text |
| `--border` | Dividers, outlines |
| `--radius` | Default border-radius |
| `--font-sans`, `--font-serif`, `--font-mono` | Font stacks |

**Gotchas:**
- **The relationship key is `cardInfo.theme` (with the dot).** Writing `"theme"` at the top level of `relationships` doesn't work — the realm won't recognize it.
- **`cardInfo.theme` is an override of `cardTheme`.** The host reads `cardTheme`. By default it's a pass-through (`cardTheme = cardInfo.theme`); when the CardDef overrides `cardTheme` with custom `computeVia`, the per-instance `cardInfo.theme` link still wins when set. If neither is set, no Theme card installs and `theme.css` supplies the defaults.
- **For default-pass-through CardDefs, a per-instance link is required only to install a specific Theme.** Without it, `cardTheme` resolves to null and the card uses Boxel's default token values. Include `attributes.cardInfo` when practical so the user can edit through the UI later.
- **Absolute URLs for nested app folders.** Relative paths like `../Theme/foo` can ambiguously resolve from a nested folder; prefer the fully qualified realm URL until you've verified the relative form.
- **Never set `cardInfo.theme` on a Theme card itself.** Theme → Theme is circular; the realm rejects it. Omit the relationship entirely on Theme instances.
- **`cardInfo.theme` is a `linksTo`, not a `contains`.** Always `"self": null` for empty, never `[]` (which is for linksToMany only).
- **Without a resolved `cardTheme`, CSS variables fall back to Boxel defaults** (the `--boxel-*` chain). Your card won't crash, but it won't look distinctive.
- **Do not flatten rich themes.** `StructuredTheme`, `StyleReference`, `DetailedStyleReference`, and `BrandGuide` carry structured fields that compute `cssVariables`. Preserve those fields when editing; never write `cssVariables` directly.
- **Brand assets live on Brand Guide, not arbitrary strings.** Which field holds what is in the Brand Guide Pattern section of `boxel/references/theme-design-system.md`.
- **Boxel built-in feature work uses the Boxel Brand Guide.** For base cards, host-facing UI, and Boxel-branded catalog material, start from `@cardstack/base/Theme/boxel-brand-guide` and its style rules.

**Source:** `boxel-catalog/blog-app/Theme/{modern-magazine,warm-editorial,neon-brutalist}.json` (production Themes), `packages/base/theme.gts`, `packages/base/structured-theme.gts`, `packages/base/style-reference.gts`, `packages/base/detailed-style-reference.gts`, `packages/base/brand-guide.gts`, `packages/base/brand-logo.gts`, `packages/base/brand-functional-palette.gts`, `packages/base/structured-theme-variables.gts`, and `packages/base/Theme/boxel-brand-guide.json`.

**See also:** `boxel-design` skill (visual design language + discovery), `boxel-ui-guidelines` (token usage in templates), `cardinfo-override-title` (the companion override pattern for cardTitle).
