### Theme-First Principle

- Decide whether the card needs a specific Theme or Brand Guide before generating code or styling. (See 3.1 Theme Linking Rules)
- No theme link is needed for default styling: `boxel-ui`'s `theme.css` supplies every token's default, so an instance with no `cardInfo.theme` renders with the Boxel defaults.
- A linked Theme is layered over those defaults, not substituted for them: `theme.css` re-declares the token contract at every themed card boundary (`[data-boxel-theme-scope]`), so a Theme only overrides the tokens it defines and the rest reset to the light or dark defaults instead of inheriting from the surrounding chrome or an outer theme. Two things do pass through the boundary: the `--theme-*` typography knobs, which are deliberately left unset there, and the `--boxel-*` palette variables the defaults are written in. An ancestor that redefines a palette variable therefore changes what the reset tokens compute to inside the nested card; only a `BrandGuide` custom variable, a bare `Theme`, or host CSS can do that.
- All CSS in production card templates must use theme variables (no hardcoded colors/spacing/fonts). (See 3.2 Canonical Theme Variables)
- Theme linkage usually lives at `relationships.cardInfo.theme` on the card instance. CardDefs can also compute `cardTheme` from a parent object, realm default, or business rule.
- Brand Guides are Theme cards plus identity assets: palette, typography, style rules, and logo/mark material.
- When developing Boxel built-in features, base cards, host-facing UI, or Boxel-branded catalog material, use the Boxel Brand Guide as the style source of truth.

### 3.1 Theme Linking Rules
Pick the source first:

- **Default styling:** link nothing; `theme.css` provides the defaults.
- **Boxel built-in feature work:** use `@cardstack/base/Theme/boxel-brand-guide` as the style reference. This is the Boxel style guide and brand material source.
- **User/custom realm work:** choose or create a theme that fits the requested domain. Do not force Boxel styling onto an unrelated app unless the user asks for Boxel-branded output.
- **Logo, mark, brand color, or brand material needed:** use a `BrandGuide`, not a plain `StructuredTheme`.

For an instance that should use a specific Theme, link it under `relationships`:

```json
"relationships": {
  "cardInfo.theme": {
    "links": {
      "self": "<theme-card-url>"
    }
  }
}
```
`<theme-card-url>` is the theme card's URL: absolute (`https://<realm>/<path-to-theme>`), relative to the instance file's own location, or `@cardstack/base/Theme/<slug>` for the shipped base-realm themes. The theme can live at any path; a `Theme/` folder is only a convention.
- Set the remaining cardInfo properties in the card data attributes. Example:
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
- IMPORTANT: Never set `cardInfo.theme` on ThemeCards (cards adopting from `@cardstack/base/theme` or its subclasses) to avoid cycles.

#### ThemeCard Types

A ThemeCard is an instance of a card definition that inherits from `@cardstack/base/theme` or from one of its subclasses.

| Type | Module | Description |
|------|-----|-------------|
| Base Theme | `@cardstack/base/theme` | DO NOT USE. Root base class. Do not instantiate or subclass it: its free-form `cssVariables` string bypasses the token contract, so themes built on it get no defaults, no validation, and no editor support. |
| Structured Theme | `@cardstack/base/structured-theme` | Structured token theme. Adds `typography`, `rootVariables`, `darkModeVariables`, `customCssImports`, `version`, and computed `cssVariables` and `cssImports`. Use for pure token systems with no brand assets. |
| Style Reference | `@cardstack/base/style-reference` | Extends `StructuredTheme`. Adds `styleName`, `inspirations`, `visualDNA`, and `wallpaperImages`. Use when the visual language matters. |
| Detailed Style Reference | `@cardstack/base/detailed-style-reference` | Extends `StyleReference`. Adds long-form guidance for context, palette, typography, geometry, material, composition, motion, components, voice, technical specs, scenarios, quality standards, and design mindset. Use for a complete design system without logo/mark assets. |
| Brand Guide | `@cardstack/base/brand-guide` | Extends `DetailedStyleReference`. Adds `brandColorPalette`, `functionalPalette`, `typography`, `markUsage` for logo/mark material, and `customCssVariables` for tokens outside the contract. Use whenever brand assets or brand governance matter. |

> **When creating a Theme card:** Start from `StructuredTheme` at minimum, never the bare `Theme`. If the design needs custom variables outside the token contract, use `BrandGuide`; it is the only shipped structured theme shape with dedicated fields for them. Prefer `BrandGuide` if the output has a brand, logo, marks, or other brand material. Prefer `DetailedStyleReference` for a rich visual system without logo material. Use `StructuredTheme` only for a minimal token-only theme. At minimum, fill in `rootVariables` and `typography`. `cssImports` is derived from the font stacks, never hand-written; see `boxel-ui-guidelines/references/font-loading-theme-card-owns-imports.md`.

#### Brand Guide Pattern

`BrandGuide` is the current fullest theme shape in the Boxel monorepo. Its computed `cssVariables` are generated from these inputs:

- `rootVariables` and `darkModeVariables` from `StructuredTheme`.
- `typography`, including the default sans font family.
- `functionalPalette`, which maps brand intent to semantic theme tokens.
- `brandColorPalette`, whose color names become custom variables using dasherized names.
- `markUsage`, which provides primary/secondary marks, greyscale marks, a social profile icon, minimum heights, and clearance ratios.

Core Brand Guide variables:

```css
--brand-primary
--brand-secondary
--brand-accent
--brand-light
--brand-dark
--brand-primary-mark
--brand-secondary-mark
--brand-primary-mark-greyscale
--brand-secondary-mark-greyscale
--brand-social-media-profile-icon
--brand-primary-mark-min-height
--brand-primary-mark-clearance-ratio
--brand-secondary-mark-min-height
--brand-secondary-mark-clearance-ratio
```

Brand Guide fallback mapping:

- `--background` falls back to `--brand-light` in light mode and `--brand-dark` in dark mode.
- `--foreground` falls back to `--brand-dark` in light mode and `--brand-light` in dark mode.
- `--primary`, `--secondary`, and `--accent` fall back to `--brand-primary`, `--brand-secondary`, and `--brand-accent`.
- `--primary-foreground`, `--secondary-foreground`, and `--accent-foreground` are generated for contrast when absent.
- `--font-sans` comes from root variables or the Brand Guide typography body font.

The built-in Boxel Brand Guide lives at `@cardstack/base/Theme/boxel-brand-guide` in shipped base content. It defines the Boxel "box element" design language: high-density UI, visible 1px frames, 8px grid discipline, color as status instead of decoration, Boxel Teal for action/selection, Cardstack Lime for rare success/highlight, and precise builder-language voice.

Current Boxel Brand Guide palette variables include `--boxel-teal`, `--boxel-cyan`, `--boxel-slate`, `--boxel-light`, `--boxel-black`, `--boxel-dove`, `--cardstack-red`, `--cardstack-lime`, `--cardstack-magenta`, `--cardstack-purple`, and `--cardstack-dark-blue`. Treat these as brand identity variables; ordinary UI should still prefer semantic roles like `--primary`, `--accent`, `--background`, and `--foreground`.

Token semantics matter: `--primary` and the other semantic fills are surfaces, not text colors ("Colors" in the token contract, linked below). Boxel Teal is the usual casualty: a fine action fill or selection indicator that fails as text on light backgrounds. For how each Boxel UI component consumes a token, see `boxel-theme-development/references/shadcn-boxel-token-mapping.md`.

#### Host Theme Commands

The Boxel host has theme-oriented commands that understand the hierarchy:

- `GenerateThemeExampleCommand` can generate examples for `structured-theme`, `style-reference`, and `brand-guide`, with specialized guidance for tokens, visual DNA, and brand material.
- `PatchThemeCommand` can ask the AI assistant to suggest and apply improvements to an existing Theme card.

Use these command patterns when making or improving theme cards through the app instead of treating every Theme as a raw CSS string.

Monorepo source files to check when this model changes: `packages/base/structured-theme.gts`, `packages/base/style-reference.gts`, `packages/base/detailed-style-reference.gts`, `packages/base/brand-guide.gts`, `packages/base/brand-logo.gts`, `packages/base/brand-functional-palette.gts`, `packages/base/structured-theme-variables.gts`, `packages/base/Theme/boxel-brand-guide.json`, `packages/boxel-ui/src/styles/theme.css` (the token contract and its default values), `packages/boxel-ui/src/helpers/theme-css.ts`, and `packages/host/app/tools/generate-theme-example.ts`.

### 3.2 Canonical Theme Variables
Use the variables directly (do not wrap with `hsl(var(...))`). Pair backgrounds with their foregrounds for contrast: a rule that sets a semantic background also sets the paired `--*-foreground` in the same rule, once at that surface's root — descendants inherit it. See the Color Pairing Rules in `boxel-ui-guidelines/references/use-boxel-design-tokens-for-theming.md` for the full rules and exceptions.

Our design system is compatible with shadcn css variables.

When assigning values, remember that Boxel UI treats shadcn-style tokens as paired surface/foreground contracts. `--spacing` is a quarter-unit the runtime multiplies by 4 (see "Spacing" in the token contract, linked below).

The complete token inventory — color roles and their paired foregrounds, status fills, neutral surfaces, hue-as-ink tokens, borders, charts, sidebar, fonts, typography roles (`heading`, `sectionHeading`, `subheading`, `body`, `caption`, `label`, `eyebrow`), spacing, radius, and shadows — is maintained in one file: `skills/boxel-ui-guidelines/references/theme-token-contract.md`. It also explains the boundary reset (a theme only sets what it changes; everything else falls back to `theme.css`) and what custom variables outside the contract (a `BrandGuide`'s fields, or an extended theme card definition) give up. Do not duplicate the list here.

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

### 3.3 Dark Mode

**How it applies.** Dark mode is opt-in and explicit; there is no automatic `prefers-color-scheme` switch in `theme.css`. Adding `data-theme="dark"` to `<html>` or to any element flips the semantic tokens (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, ink tokens, sidebar tokens, and the rest) to their dark defaults for that subtree and sets the inherited `--boxel-color-scheme: dark` signal. `data-theme="light"` forces light back on inside a dark subtree. Always use the `data-theme` attribute to switch schemes: it is the only form with a `light` counterpart, and the host's own toggles and the theme editors' observers key off it. Typography and spacing tokens do not change between schemes.

**How a Theme participates.** `StructuredTheme` and its descendants carry `darkModeVariables` next to `rootVariables`. The card runtime emits them under a style container query on `--boxel-color-scheme`, scoped to the card's own theme boundary, so a card's dark values follow the *nearest ancestor's* scheme. A Theme with no dark block keeps its light values in dark mode; any token it omits resets at the card boundary to the `theme.css` default for that scheme (scheme-neutral tokens such as `--success`, `--chart-*`, `--font-*`, `--radius` and `--shadow-*` have a single default). Never write `@media (prefers-color-scheme: dark)` inside a Theme's CSS; the theme parser skips it. Dark values belong in `darkModeVariables`.

**When to use it.**
- Author `darkModeVariables` on any Theme that may render inside a dark host surface or a site with a dark option. A light-only Theme in a dark subtree keeps its light values and looks out of place.
- Do not toggle the scheme from an ordinary card template. The host controls its own chrome, and cards render under whatever scheme surrounds them.
- Offer a visitor-facing light/dark toggle only at the page or site shell level (a `SiteShell`-style component), where it is legitimate app UI.

**How to use it in templates.**
- Write every color through a token and pair each background with its `-foreground`. That is all a card needs to be dark-mode safe; no scheme-specific selectors in `<style scoped>`.
- Scrims and veils use `--overlay` / `--hover`, or `color-mix()` with literal `black`/`white`, never `rgba()` on a themed color and never `--foreground` (it inverts in dark mode).
- A shell that owns a toggle stamps `data-theme={{if this.isDarkMode 'dark' 'light'}}` on a wrapper *above* the themed content, defaults to the visitor's `prefers-color-scheme`, persists the choice (e.g. `localStorage`), and never bakes a machine's preference into prerendered HTML.

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
