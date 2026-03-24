### Theme-First Principle

- Always link a Theme before generating code or styling. (See 3.1 Theme Linking Rules)
- All CSS in card templates must use theme variables (no hardcoded colors/spacing/fonts). (See 3.2 Canonical Theme Variables)
- Theme linkage lives at `relationships.cardInfo.theme` on the card instance.

### 3.1 Theme Linking Rules
- Set this as the Default Theme for all new, non-ThemeCard instances:

```json
"relationships": {
  "cardInfo.theme": {
    "links": {
      "self": "https://cardstack.com/base/Theme/cardstack-brand-guide"
    }
  }
}
```
- You must also set the remaining cardInfo properties in the card data attributes. Example:
```json
"attributes": {
  "cardInfo": {
    "notes": null,
    "name": "[card title here]",
    "summary": "[brief card description here]",
    "cardThumbnailURL": "[card thumbnail url here]"
  },
}
```
- IMPORTANT: Never set `cardInfo.theme` on ThemeCards (cards adopting from `https://cardstack.com/base/theme/default` or its subclasses) to avoid cycles.

#### ThemeCard Types

A ThemeCard is an instance of a card definition that inherits from `https://cardstack.com/base/theme/default` or from one of its subclasses.

| Type | URL | Description |
|------|-----|-------------|
| Base Theme | `https://cardstack.com/base/theme/default` | Root base class |
| Structured Theme | `https://cardstack.com/base/structured-theme/default` | MINIMUM template — includes all theme variables (except Brand variables) |
| Style Reference | `https://cardstack.com/base/style-reference/default` | Extends `StructuredTheme` — adds fields for inspiration images, terms, and style description |
| Detailed Style Reference | `https://cardstack.com/base/detailed-style-reference/default` | **PREFERRED** — extends `StyleReference` with detailed design system description |
| Brand Guide | `https://cardstack.com/base/brand-guide/default` | Extends `DetailedStyleReference` — adds brand-specific variables for colors and typography |

> **When creating a Theme card:** Prefer `DetailedStyleReference`. At minimum, fill in `rootVariables` and `typography`. Add font URLs to `cssImports` as a string array — no `@import` needed (the system handles imports).

### 3.2 Canonical Theme Variables
Use the variables directly (do not wrap with `hsl(var(...))`). Pair backgrounds with their foregrounds for contrast.

Our design system is compatible with shadcn css variables.

- Background Colors:
```css
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
```css
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
```css
--border
--sidebar-border
```
- Css Outline Colors:
```css
--ring
--sidebar-ring
```
- Chart Colors:
```css
--chart-1
--chart-2
--chart-3
--chart-4
--chart-5
```

- Fonts: (`font-family`)
```css
--font-sans
--font-serif
--font-mono
```
- Radius: (`border-radius`)
```css
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
```css
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
```css
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
```css
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
```css
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
```css
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
```css
background-color: hsl(var(--background));   /* DO NOT wrap in hsl() */
```

### CSS Safety (All Formats)
- Always use `<style scoped>`; only `/* */` comments (never `//`).
- No global selectors (`:root`, `body`, `html`). Define variables at component root.
- Conservative z-index (< 10). No fixed overlays beyond card bounds.
- Prefer inline SVG; always avoid `url(#id)` in SVG.

### Format Responsibilities (Theming-Aware)
- Isolated: comfortable reading; scrollable surface; theme tokens for padding/typography.
- Embedded: parent may clamp height; child respects theme tokens.
- Fitted: no borders or border-radius (parent draws chrome); internal layout uses theme spacing/typography.
- Spacing for collections: `.container > .containsMany-field { gap: var(--boxel-sp); }`

### Sample Themed Template
```gts
  <template>
    <article class='my-card' aria-labelledby='mc-title'>
      <header class='mc-header'>
        <h1 class='mc-title' id='mc-title'><@fields.cardTitle /></h1>
        <p class='mc-summary'><@fields.cardDescription /></p>
      </header>

      <div class='mc-body'>
        <div class='mc-main'>
          <section aria-labelledby='mc-section-1'>
            <h2 class='mc-section-heading' id='mc-section-1'>Section 1 Title</h2>
            <p class='mc-prose'>Paragraph</p>
            <ul class='items-grid'>
              <li class='section-item'>
                <h3 class='item-title'>Item 1</h3>
                <p class='item-content'>Item 1 content</p>
              </li>
              <li class='section-item'>
                <h3 class='item-title'>Item 2</h3>
                <p class='item-content'>Item 2 content</p>
              </li>
              <li class='section-item'>
                <h3 class='item-title'>Item 3</h3>
                <p class='item-content'>Item 3 content</p>
              </li>
            </ul>
          </section>
          <section aria-labelledby='mc-section-2'>
            <h2 class='mc-section-heading' id='mc-section-2'>Section 2 Title</h2>
            <p class='mc-prose'>Paragraph</p>
          </section>
        </div>

        <aside class='mc-sidebar'>
          <section
            class='sidebar-section'
            aria-labelledby='sidebar-heading-1'
          >
            <h2 class='sidebar-heading' id='sidebar-heading-1'>Sidebar Title 1</h2>
            <ul class='sidebar-list'>
              <li class='sidebar-item'>
                <span>Sidebar item 1</span>
              </li>
              <li class='sidebar-item'>
                <span>Sidebar item 2</span>
              </li>
              <li class='sidebar-item'>
                <span>Sidebar item 3</span>
              </li>
            </ul>
          </section>

          <section
            class='sidebar-section'
            aria-labelledby='sidebar-heading-2'
          >
            <h2 class='sidebar-heading' id='sidebar-heading-2'>Sidebar Title 2</h2>
            <dl class='sidebar-dl'>
              <div class='sidebar-dl-row'>
                <dt>Sidebar item 1</dt>
                <dd>Content</dd>
              </div>
              <div class='sidebar-dl-row'>
                <dt>Sidebar item 2</dt>
                <dd>Content</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <footer class='mc-footer'>
        <p>Footer text</p>
        <nav aria-label='Footer links'>
          <ul class='footer-links'>
            <li><a href='#'>Link 1</a></li>
            <li><a href='#'>Link 2</a></li>
            <li><a href='#'>Link 3</a></li>
          </ul>
        </nav>
      </footer>
    </article>
    <style scoped>
      .my-card {
        container-type: inline-size;
        height: 100%;
        overflow-y: auto;
        padding: var(--boxel-sp-xl);
        background-color: var(--background);
        color: var(--foreground);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        box-sizing: border-box;
      }

      /* Header */
      .mc-header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        border-bottom: 1px solid var(--border);
        padding-bottom: var(--boxel-sp-lg);
      }
      .mc-title {
        font-size: var(--boxel-font-size-xl);
        font-weight: 700;
        letter-spacing: var(--boxel-lsp-xs);
        margin: 0;
      }
      .mc-summary {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
        margin: 0;
      }

      /* Body: main + sidebar */
      .mc-body {
        display: grid;
        grid-template-columns: 1fr 16rem;
        gap: var(--boxel-sp-lg);
        align-items: start;
      }

      /* Main column */
      .mc-main {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
      }
      .mc-main section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .mc-prose {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height);
        color: var(--foreground);
        margin: 0;
      }
      .mc-section-heading {
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
        margin: 0;
      }

      /* Items grid */
      .items-grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
        gap: var(--boxel-sp);
      }
      .section-item {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        background-color: var(--card);
        color: var(--card-foreground);
        padding: var(--boxel-sp);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--shadow);
      }
      .item-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        margin: 0;
      }
      .item-content {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        margin: 0;
        line-height: var(--boxel-line-height-sm);
      }

      /* Sidebar */
      .mc-sidebar {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        background-color: var(--sidebar);
        color: var(--sidebar-foreground);
        border: 1px solid var(--sidebar-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }
      .sidebar-section {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .sidebar-section + .sidebar-section {
        border-top: 1px solid var(--sidebar-border);
        padding-top: var(--boxel-sp);
      }
      .sidebar-heading {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-lg);
        margin: 0;
      }
      .sidebar-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }
      .sidebar-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        font-size: var(--boxel-font-size-sm);
      }

      /* Definition list */
      .sidebar-dl {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        margin: 0;
      }
      .sidebar-dl-row {
        display: flex;
        justify-content: space-between;
        font-size: var(--boxel-font-size-xs);
      }
      .sidebar-dl-row dt {
        color: var(--muted-foreground);
      }
      .sidebar-dl-row dd {
        margin: 0;
        font-weight: 500;
      }

      /* Footer */
      .mc-footer {
        border-top: 1px solid var(--border);
        padding-top: var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
      }
      .mc-footer p {
        font-size: inherit;
        margin: 0;
      }
      .footer-links {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        align-items: center;
        gap: 0;
      }
      .footer-links li + li::before {
        content: '·';
        margin-inline: var(--boxel-sp-xs);
      }
      .mc-footer a {
        color: var(--muted-foreground);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .mc-footer a:hover {
        color: var(--foreground);
      }

      /* Responsive: stack on narrow containers */
      @container (max-width: 600px) {
        .mc-body {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
```
