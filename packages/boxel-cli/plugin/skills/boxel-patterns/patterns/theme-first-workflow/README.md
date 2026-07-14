---
validated: source-proven
---

# theme-first-workflow — Choose or make a theme BEFORE building the card

**What this gives you:** A repeatable starting sequence for any new card or app — pick (or build) a Theme card first, link it through `cardInfo.theme`, then write the card definition with the theme tokens baked in from line one. The result: cards that ship looking right, not "let me retrofit colors later".

**When to use:** Whenever a user asks for a new card, a card family, or an app — before you write the first line of `.gts`. This is meant to run as **step 0** of `/boxel-create-card`, `/boxel-design-card`, or any "build me a …" intent.

**The insight:** Boxel's theme system is built around `cardInfo.theme` — a `linksTo(Theme)` field on every CardDef. The Theme card holds:

- theme variables - either as a raw `cssVariables` string on minimal themes or as structured `rootVariables`, `darkModeVariables`, `typography`, palette, and mark fields that compute `cssVariables`.
- `cssImports` — Google Fonts and other `<link>` URLs.

When a card has `cardInfo.theme` set, the CardContainer injects those CSS variables and imports the fonts. Your templates then reference `var(--background)`, `var(--foreground)`, `var(--primary)`, `var(--font-sans)` etc. and "just work".

`BrandGuide` is the richest theme shape. Use it when the theme needs logo/mark usage, brand colors, brand voice, or other identity material. When you are developing Boxel built-in features, base cards, or Boxel-branded catalog output, the style source is the built-in Boxel Brand Guide at `https://cardstack.com/base/Theme/boxel-brand-guide`.

If you skip this step and build the card with hard-coded colors, you've wasted that effort — you'll be ripping them out when the user picks a theme.

**Recipe shape:**

### Step 0 — Decide the theme

Three options, in order of preference:

1. **Reuse an existing Theme.** Most realms already have a couple. Browse `<realm>/Theme/*.json` or search via `/boxel-search-cards` filtered on the Theme class. Pick by `styleName` / `visualDNA` fields.
2. **Copy and edit.** Take an existing Theme, `copy-card` it, modify the `cssVariables` and `cssImports`. Catalog Themes have a "Copy and Edit" menu item built in.
3. **Author a new Theme.** Choose the narrowest base that preserves the design intent:
   - `https://cardstack.com/base/brand-guide` for a full brand system with logo/mark usage, functional palette, color palette, typography, voice, and detailed style guidance.
   - `https://cardstack.com/base/detailed-style-reference` for a full style system without logo/mark material.
   - `https://cardstack.com/base/style-reference` for a compact visual DNA reference with inspirations and wallpapers.
   - `https://cardstack.com/base/structured-theme` for a token-only theme.

### Step 1 — Link the theme on every instance

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

The relationship key is **`cardInfo.theme`** with a literal dot — not nested `cardInfo: { theme: ... }`. The literal dot is what the realm parses to install the Theme. For CardDefs that use the default `cardTheme` (pass-through to `cardInfo.theme`), this is how a theme installs — no per-instance link, no theme.

**Alternative — computed `cardTheme` on the CardDef:** If the card has a natural source for its theme (a linked parent card, a query for the realm's default theme, etc.), override `cardTheme` directly and skip the per-instance link. `cardInfo.theme` then becomes optional — set it only on instances that should override the computed default.

```gts
// Task inherits Project's theme by default; cardInfo.theme overrides
@field cardTheme = linksTo(() => Theme, {
  computeVia: function (this: Task) {
    return this.cardInfo?.theme ?? this.project?.cardTheme ?? null;
  },
});
```

Use whichever fits the schema. If you can't justify a custom computed `cardTheme`, default to per-instance `cardInfo.theme` everywhere.

**For nested app folders, prefer an absolute Theme URL** in `cardInfo.theme.links.self`. Relative paths can resolve ambiguously when the consumer is deeper than expected. Absolute URLs (`https://realms-staging.stack.cards/ctse/<realm>/Theme/<slug>`) always resolve to the same target. Use a relative path only after you've verified it works in the live app for that specific folder depth.

**Never assign `cardInfo.theme` on a Theme card itself.** A Theme is its own ancestor in the visual chain; pointing it at another Theme creates a circular installation and the realm logs an error. Theme instances should have `attributes.cardInfo` for naming/description, but the `cardInfo.theme` relationship key should be omitted entirely. Do not emit a placeholder `{ "links": { "self": null } }` relationship on Theme cards; it is noisy, teaches the wrong shape, and should fail local self-checks.

### Step 2 — Write templates using theme tokens

In `<style scoped>` blocks, reference theme CSS variables exclusively:

```css
.card-shell {
  background: var(--background);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font-sans);
}

.primary-action {
  background: var(--primary);
  color: var(--primary-foreground);
}
```

No hard-coded `#7b61ff`, no `font-family: 'Inter'`. Tokens only. The Theme card provides the values.

### Step 3 — Verify via preview

After writing the card and a sample instance, `/boxel-preview-card` to confirm the theme is applied. If the card looks unstyled, the most common cause is missing `cardInfo.theme` link on the instance.

**Standard theme tokens to expect (from catalog Themes):**

| Token                                        | What it controls                     |
| -------------------------------------------- | ------------------------------------ |
| `--background`, `--foreground`               | Page-level surface + text            |
| `--card`, `--card-foreground`                | Card body surface + text             |
| `--primary`, `--primary-foreground`          | Primary action / brand               |
| `--secondary`, `--secondary-foreground`      | Secondary action                     |
| `--accent`, `--accent-foreground`            | Highlights, links                    |
| `--muted`, `--muted-foreground`              | Subdued backgrounds + secondary text |
| `--border`                                   | Dividers, outlines                   |
| `--radius`                                   | Default border-radius                |
| `--font-sans`, `--font-serif`, `--font-mono` | Font stacks                          |

**Gotchas:**

- **The relationship key is `cardInfo.theme` (with the dot).** Writing `"theme"` at the top level of `relationships` doesn't work — the realm won't recognize it.
- **`cardInfo.theme` is an override of `cardTheme`.** The host reads `cardTheme`. By default it's a pass-through (`cardTheme = cardInfo.theme`); when the CardDef overrides `cardTheme` with custom `computeVia`, the per-instance `cardInfo.theme` link still wins when set. If neither is set, no theme installs.
- **For default-pass-through CardDefs, the per-instance link is required to install a theme.** Without it, `cardTheme` resolves to null. Include `attributes.cardInfo` too so the user can edit through the UI later.
- **Absolute URLs for nested app folders.** Relative paths like `../Theme/foo` can ambiguously resolve from a nested folder; prefer the fully qualified realm URL until you've verified the relative form.
- **Never set `cardInfo.theme` on a Theme card itself.** Theme → Theme is circular; the realm rejects it. Omit the relationship entirely on Theme instances.
- **`cardInfo.theme` is a `linksTo`, not a `contains`.** Always `"self": null` for empty, never `[]` (which is for linksToMany only).
- **Without a resolved `cardTheme`, CSS variables fall back to Boxel defaults** (the `--boxel-*` chain). Your card won't crash, but it won't look distinctive.
- **Do not flatten rich themes unnecessarily.** Minimal Themes can store raw `cssVariables`, but `StructuredTheme`, `StyleReference`, `DetailedStyleReference`, and `BrandGuide` carry structured fields that compute `cssVariables`. Preserve those fields when editing.
- **Brand assets live on Brand Guide, not arbitrary strings.** Logo and mark material belongs in `markUsage`; brand colors belong in `brandColorPalette` and `functionalPalette`; templates consume the generated `--brand-*` variables and semantic theme variables.
- **Boxel built-in feature work uses the Boxel Brand Guide.** For base cards, host-facing UI, and Boxel-branded catalog material, start from `https://cardstack.com/base/Theme/boxel-brand-guide` and its style rules.

**Source:** `boxel-catalog/blog-app/Theme/{modern-magazine,warm-editorial,neon-brutalist}.json` (production Themes), `packages/base/theme.gts`, `packages/base/structured-theme.gts`, `packages/base/style-reference.gts`, `packages/base/detailed-style-reference.gts`, `packages/base/brand-guide.gts`, `packages/base/brand-logo.gts`, `packages/base/brand-functional-palette.gts`, `packages/base/structured-theme-variables.gts`, and `packages/base/Theme/boxel-brand-guide.json`.

**See also:** `boxel-design` skill (visual design language + discovery), `boxel-ui-guidelines` (token usage in templates), `cardinfo-override-title` (the companion override pattern for cardTitle).
