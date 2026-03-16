### Theme-First Principle

- Always link a Theme before generating code or styling. (See 3.1 Theme Linking Rules)
- All CSS in card templates must use theme variables (no hardcoded colors/spacing/fonts). (See 3.2 Canonical Theme Variables)
- Theme linkage lives at `relationships.cardInfo.theme` on the card instance.

### 3.1 Theme Linking Rules
- Set this as the Default Theme for all new, non-ThemeCard instances:

```
"relationships": {
  "cardInfo.theme": {
    "links": {
      "self": "https://app.boxel.ai/catalog/Theme/cardstack"
    }
  }
}
```
- You must also set the remaining cardInfo properties in the card data attributes. Example:
```
"attributes": {
  "cardInfo": {
    "notes": null,
    "title": "[card title here]",
    "description": "[brief card description here]",
    "thumbnailURL": "[card thumbnail url here]"
  },
}
```
- IMPORTANT: Never set `cardInfo.theme` on ThemeCards (cards adopting from `https://cardstack.com/base/theme/default` or its subclasses) to avoid cycles.

#### ThemeCard Types

A ThemeCard is an instance of a card definition that inherits from `https://cardstack.com/base/theme/default` or from one of its subclasses.

- Base: `https://cardstack.com/base/theme/default`
- Subclasses:
  - `https://cardstack.com/base/structured-theme/default`
  - `https://cardstack.com/base/detailed-style-reference/default`
  - `https://cardstack.com/base/style-reference/default`
  - `https://cardstack.com/base/brand-guide/default`

### 3.2 Canonical Theme Variables
Use the variables directly (do not wrap with `hsl(var(...))`). Pair backgrounds with their foregrounds for contrast.

Our design system is compatible with shadcn css variables.

- Background Colors:
```
--background
--card
--popover
--primary
--secondary
--muted
--accent
--destructive
--input
--sidebar
--sidebar-primary
--sidebar-accent
```

- Foreground Colors:
```
--foreground
--card-foreground
--popover-foreground
--primary-foreground
--secondary-foreground
--muted-foreground
--accent-foreground
--destructive-foreground
--sidebar-foreground
--sidebar-primary-foreground
--sidebar-accent-foreground
```
- Border Colors:
```
--border
--sidebar-border
```
- Css Outline Colors:
```
--ring
--sidebar-ring
```
- Chart Colors:
```
--chart-1
--chart-2
--chart-3
--chart-4
--chart-5
```

- Fonts: (`font-family`)
```
--font-sans
--font-serif
--font-mono
```
- Radius: (`border-radius`)
```
--radius
--boxel-border-radius-xxs
--boxel-border-radius-xs
--boxel-border-radius-sm
--boxel-border-radius
--boxel-border-radius-lg
--boxel-border-radius-xl
--boxel-border-radius-xxl
```
- Spacing:
```
--spacing
--boxel-sp-6xs
--boxel-sp-5xs
--boxel-sp-4xs
--boxel-sp-3xs
--boxel-sp-2xs
--boxel-sp-xs
--boxel-sp-sm
--boxel-sp
--boxel-sp-lg
--boxel-sp-xl
--boxel-sp-2xl
--boxel-sp-3xl
--boxel-sp-4xl
--boxel-sp-5xl
--boxel-sp-6xl
```
- Letter-spacing:
```
--tracking-normal
--boxel-lsp-xxl
--boxel-lsp-xl
--boxel-lsp-lg
--boxel-lsp
--boxel-lsp-sm
--boxel-lsp-xs
--boxel-lsp-xxs
```
- Shadows: (`box-shadow`)
```
--shadow-2xs
--shadow-xs
--shadow-sm
--shadow
--shadow-md
--shadow-lg
--shadow-xl
--shadow-2xl
--boxel-box-shadow
--boxel-box-shadow-hover
--boxel-deep-box-shadow
```

- Font Sizes: (`font-size`)
```
--boxel-font-size-2xl
--boxel-font-size-xl
--boxel-font-size-lg
--boxel-font-size-md
--boxel-font-size
--boxel-font-size-sm
--boxel-font-size-xs
--boxel-heading-font-size
--boxel-section-heading-font-size
--boxel-subheading-font-size
--boxel-body-font-size
--boxel-caption-font-size
```

#### CSS Usage Examples:

✅ Correct:
```
background-color: var(--card);
color: var(--card-foreground);
border-color: var(--border);
font-family: var(--font-serif);
border-radius: var(--radius);
padding: var(--spacing);
margin-top: calc(var(--spacing) * 2);
box-shadow: var(--shadow-lg);
```
❌ Incorrect:
```
background-color: hsl(var(--background));   /* Do not wrap in hsl() */
```

### CSS Safety (All Formats)
- Always use `<style scoped>`; only `/* */` comments (never `//`).
- No global selectors (`:root`, `body`, `html`). Define variables at component root.
- Conservative z-index (< 10). No fixed overlays beyond card bounds.
- Prefer inline SVG; always avoid `url(#id)` in SVG.

### Format Responsibilities (Theming-Aware)
- Isolated: comfortable reading; scrollable surface; theme tokens for padding/typography.
- Embedded: parent may clamp height; child respects theme tokens.
- Fitted: no borders (parent draws chrome); internal layout uses theme spacing/typography.
- Spacing for collections: `.container > .containsMany-field { gap: var(--boxel-sp, 1rem); }`

### Minimal Themed Template
```gts
<template>
  <article class="card">
    <h2 class="title"><@fields.title /></h2>
   {{#if @model.description}}
      <p class="body"><@fields.description /></p>
   {{/if}}
  </article>
  <style scoped>
     .card {
        --my-card-background: var(--card, var(--boxel-light));
        --my-card-foreground: var(--card-foreground, var(--boxel-dark));
        --my-card-border: var(--border, var(--boxel-400));
        --my-card-shadow: var(--shadow, var(--boxel-box-shadow));

        background-color: var(--my-card-background);
        color: var(--my-card-foreground);
        padding: var(--boxel-sp);
        border: 1px solid var(--my-card-border);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--my-card-shadow);
      }
      .title {
        font-size: var(--boxel-font-size-lg);
        letter-spacing: var(--boxel-lsp-xs);
        margin-bottom: var(--boxel-sp-sm);
      }
      .body {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
  </style>
</template>
```