## CSS Safety Essentials

**Always scoped:**
```gts
<template>
  <div class="my-card">...</div>
  <style scoped>  /* MANDATORY */
    .my-card { }
  </style>
</template>
```

**CSS comments (NEVER use //):**
```css
/* ✅ CORRECT: Block comments */
.card { color: blue; }

// ❌ WRONG: Single-line breaks parsing
```

**Never use global selectors:**
```css
/* ❌ WRONG */
:root { --color: blue; }
body { margin: 0; }

/* ✅ CORRECT */
.my-component {
  --color: blue;
}
```

**Formatters for display:**
```hbs
{{formatCurrency @model.price currency="USD"}}
{{formatDateTime @model.date size="medium"}}
{{formatNumber @model.count size="tiny"}}
```

## Design Philosophy and Competitive Styling

Design and implement your stylesheet to fit the domain you are generating. Research the top 2 products/services in that area and design your card as if you are the 3rd competitor looking to one-up the market in terms of look and feel, functionality, and user-friendliness.

Approach: Study the leading players' design patterns, then create something that feels more modern, intuitive, and polished. Focus on micro-interactions, thoughtful spacing, superior visual hierarchy, and removing friction from user workflows.

Key Areas to Compete On:
- Visual polish: better typography, spacing, and color schemes
- Interaction design: smoother animations, better feedback, clearer affordances
- Information architecture: more logical organization, better progressive disclosure
- Accessibility: superior contrast, keyboard navigation, screen reader support
- Performance: faster loading, responsive design

Typography Guidance (detailed): Choose modern, readable fonts that match your domain. For body text, consider Inter, Roboto, Open Sans, Source Sans Pro, DM Sans, Work Sans, Manrope, or Plus Jakarta Sans. For headings, Poppins, Montserrat, Space Grotesk, Raleway, Archivo Black, Oswald, Anton, Playfair Display, Lora, or Merriweather. Balance readability with character; ensure sufficient contrast and legible sizes across formats.

## Design Token Foundation

Dense professional layouts with thoughtful scaling:

- Typography scale: start at 0.875rem base; headings 1rem–1.375rem; labels 0.75rem
- Spacing scale: 0.25rem increments; inline 0.25–0.5rem; sections 0.75–1rem; major 1.5–2rem
- Colors: define background, foreground, muted, muted-foreground, primary, primary-foreground, secondary, secondary-foreground, accent, accent-foreground, card, card-foreground, sidebar, sidebar-foreground, and border tokens
- Radius: match the aesthetic (sharp for technical, soft for friendly)
- Shadows: subtle elevation for interactive elements; keep z-index conservative (<10)

Implementation tip: Define CSS variables at component root and use fallbacks.

```css
.component {
  --card-padding: var(--boxel-sp, 1rem);
  --card-radius: var(--boxel-border-radius-sm, 0.5rem);
  --card-shadow: var(--boxel-box-shadow, 0 2px 4px rgba(0,0,0,0.1));
  padding: var(--card-padding);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}
```

## Typography Guidance (Detailed)

- Base size: 14px (0.875rem) for dense UIs; increase in larger formats
- Hierarchy cascade: each level 80–87% of the previous; adjust weight 100–200 units per level
- Line-height: 1.2–1.5 depending on density; tighter for tiles, looser for isolated
- Clamping: use `clamp()` for responsive sizes across fitted/embedded/isolated
- Accessibility: aim for WCAG AA contrast; avoid ultra-light weights below 16px
- Numbers: tabular-nums for data tables and metrics when available

Example:
```css
.title { font-size: clamp(1rem, 2.5vw, 1.25rem); font-weight: 700; }
.subtle { font-size: 0.75rem; opacity: 0.8; }
```

## Format Dimensions Comparison

| Format   | Width            | Height           | Parent Sets | Key Behavior |
|----------|------------------|------------------|-------------|-------------|
| Isolated | Max-width, center| Natural + scroll | No          | Full detail, scrollable content |
| Embedded | Fills container  | Natural          | Width only  | Truncation/expand controls handled by parent |
| Fitted   | Fills exactly    | Fills exactly    | Both        | Must adapt to fixed grid slots |
| Atom     | Inline           | Inline           | No          | Minimal inline representation |
| Edit     | Fills container  | Natural form     | Width only  | Form layout, grows with fields |

Notes:
- Fitted requires internal subformats (badge, strip, tile, card) via container queries
- Embedded should be height-flexible; parents may clamp and offer "view more"
- Isolated should ensure comfortable reading with scrollable mat and generous padding