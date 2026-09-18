## Template Patterns

### Isolated / embedded templates

Do NOT use `CardContainer` as the root — the runtime (`field-component.gts`) already wraps every card format in `CardContainer`. Adding a second `CardContainer` is a redundant double-wrap.

The themed `CardContainer` already applies the theme's background/foreground pair and the full `body` typography role (family, size, weight, line-height, letter-spacing) on its root, and via `@layer reset` gives `h1`/`h2`/`h3` the `heading`/`sectionHeading`/`subheading` roles, `small` the `caption` role, and zero margins to headings and `p`. Do NOT repeat any of that on your template root or on those elements; declare only where the design deviates. The exact list is in `skills/boxel-ui-guidelines/references/theme-token-contract.md` under "What CardContainer already applies".

**The isolated root fills and scrolls the container.** Give it `height: 100%; overflow-y: auto`. `min-height: 100%` is not equivalent: the host container has a fixed height and clips, so a taller root gets cut off instead of scrolling.

**Font size defaults are appropriate for isolated templates.** Embedded and fitted templates render in much smaller spaces — override font sizes where needed, but always prioritize legibility. Depending on the font, you can go as small as 0.5rem, but ideally no smaller.

```gts
static isolated = class Isolated extends Component<typeof this> {
  <template>
    <article class='my-card'>
      <CardHeader @title={{@model.cardTitle}} />
      <div class='content'>
        <@fields.someField />
      </div>
    </article>
    <style scoped>
      .my-card {
        padding: var(--boxel-sp);
      }
      .content {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
};
```

### Fitted templates

Fitted cards are rendered at many different container sizes — from small badges to large tiles. The template must look good at any size, not just one target size. Design for fluid resizing:

- **Do not** use `box-shadow: inset` left-border accents (e.g. `inset 3px 0 0 <color>`) on the fitted card wrapper — this styling is not desired
- Prioritize the most essential information (see common fields that all cards have such as `cardTitle`, `cardDescription` and `cardThumbnailURL`) — the card may be tiny, so show only what fits
- For image columns/panels, use `cqh` (container query height) units so sizing scales with the card: `width: 40cqh; min-width: 3.75rem; max-width: 12.5rem`
- Use `text-overflow: ellipsis` with `white-space: nowrap` for single-line labels, or clamp multi-line text with `-webkit-line-clamp`
- Override inherited font sizes to fit the smaller space — but keep text legible. Depending on the font, you can go as small as 0.5rem, but ideally no smaller

#### The `FittedCard` component — a good option for most cases

`FittedCard` from `@cardstack/boxel-ui/components` handles all responsive container-query breakpoints, image column sizing, text clamping, and overflow — you only supply named content blocks. Reach for it when the design fits its slot model; hand-roll a fitted template (next section) when it does not.

```gts
import { FittedCard, Pill } from '@cardstack/boxel-ui/components';
import type { FittedCardLayout, FittedCardTitleTag } from '@cardstack/boxel-ui/components';
import BookOpen from '@cardstack/boxel-icons/book-open';
import Calendar from '@cardstack/boxel-icons/calendar';

static fitted = class Fitted extends Component<typeof this> {
  <template>
    <FittedCard
      @imageUrl={{@model.cardThumbnailURL}}
      @imageAlt={{@model.cardTitle}}
      class='my-fitted'
    >
      <:placeholder><BookOpen width='24' height='24' /></:placeholder>
      <:badgeLeft><Pill>New</Pill></:badgeLeft>
      <:badgeRight><Pill>4.8 ★</Pill></:badgeRight>
      <:eyebrow>{{@model.category}}</:eyebrow>
      <:title><@fields.cardTitle /></:title>
      <:subtitle><@fields.cardDescription /></:subtitle>
      <:meta><Calendar width='14' height='14' /><@fields.date /></:meta>
      <:footer><strong>{{@model.author.name}}</strong></:footer>
    </FittedCard>
    <style scoped>
      .my-fitted {
        --fc-content-gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
};
```

#### Named blocks

| Block         | Description                                                                                                                              | Required |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `title`       | Primary heading                                                                                                                          | Yes      |
| `placeholder` | Icon/content in the image column when `@imageUrl` is absent. Yielding empty content removes the column entirely.                         | No       |
| `image`       | Custom image block (alternative to `@imageUrl`)                                                                                          | No       |
| `background`  | Absolutely-positioned background graphics layer                                                                                          | No       |
| `badgeLeft`   | Absolutely-positioned group at top-left (over the image when present)                                                                    | No       |
| `badgeRight`  | Absolutely-positioned group at top-right                                                                                                 | No       |
| `badgeRow`    | Inline flex row of badges/pills above the header inside the text column; controlled by `--fc-badge-row-justify` and `--fc-badge-row-gap` | No       |
| `badge`       | Alias for `badgeLeft` (legacy — prefer `badgeLeft`)                                                                                      | No       |
| `eyebrow`     | Tiny uppercase overline above the title                                                                                                  | No       |
| `subtitle`    | Secondary line below the title                                                                                                           | No       |
| `meta`        | Additional content between header and footer                                                                                             | No       |
| `footer`      | Bottom row: date, location, price, stats, etc.                                                                                           | No       |

Named blocks must be direct children of `<FittedCard>`. Glimmer rejects a `<:eyebrow>` wrapped in `{{#if}}`, so put the conditional inside the block: `<:eyebrow>{{#if @model.level}}<@fields.level />{{/if}}</:eyebrow>`. Every section is optional: to leave one out, don't write its block. When the conditional inside a block is false, the section's element still renders empty and the component's `:empty` rule collapses it. To hide a section you do provide — usually at a breakpoint — set its display switch to `none`: `--fc-image-display`, `--fc-subtitle-display`, `--fc-meta-display`, `--fc-footer-display`, `--fc-badge-left-display`, `--fc-badge-right-display`, `--fc-badge-row-display`. The title and eyebrow have no switch.

#### Args

| Arg             | Type                 | Description                                                                                                                                                                                                                                               |
| --------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@imageUrl`     | `string`             | Cover image URL; triggers the image column layout                                                                                                                                                                                                         |
| `@imageAlt`     | `string`             | Alt text for the cover image (defaults to `""`)                                                                                                                                                                                                           |
| `@imageLoading` | `'lazy' \| 'eager'`  | Image loading hint; omit to use the browser default                                                                                                                                                                                                    |
| `@titleTag`     | `FittedCardTitleTag` | HTML heading element for the title: `'h1'` (default), `'h2'`, `'h3'`, etc. Pass `'h2'` or `'h3'` when cards appear in a list to preserve heading hierarchy for screen readers.                                                                            |
| `@layout`       | `FittedCardLayout`   | Force a layout direction regardless of container size: `'vertical'` — image always stacks on top; `'horizontal'` — image always sits to the left; `'auto'` (default) — direction is chosen by container-query breakpoints based on aspect-ratio and size. |

`FittedCardLayout` and `FittedCardTitleTag` are exported named types from `@cardstack/boxel-ui/components`. When you need the allowed values as an array (e.g. for a dropdown), use the exported constants `FITTED_CARD_LAYOUT_OPTIONS` and `FITTED_CARD_TITLE_TAG_OPTIONS`.

#### CSS custom properties

Every visual metric has an `--fc-*` override, set on the `FittedCard` root; the breakpoints adjust most of them, so only set one to deviate. The ones that come up most:

```css
.my-fitted {
  --fc-content-gap: var(--boxel-sp-xs);       /* gap between header / meta / footer */
  --fc-content-padding: var(--boxel-sp-xs);   /* padding inside the text column */
  --fc-image-width: 40cqh;                    /* image column in horizontal layouts */
  --fc-image-object-fit: cover;
  --fc-title-line-clamp: 2;
  --fc-subtitle-line-clamp: 2;
  --fc-footer-justify: space-between;
  --fc-subtitle-display: none;                /* hides the subtitle; image, meta, footer, and badge slots have their own --fc-<section>-display */
}
```

The full list, with defaults, is in the component source: `packages/boxel-ui/src/components/fitted-card/index.gts` (and its `usage.gts`). Verify there before relying on a name not shown above.

#### Customising caller-owned content per breakpoint

`FittedCard` handles its own layout at every size. For caller-owned content that needs show/hide per breakpoint, add `@container fitted-card` rules in your own `<style scoped>`:

```css
@container fitted-card (width < 250px) {
  .my-detail-row {
    display: none;
  }
}
```

#### Hand-rolled fitted template

When the design calls for its own layout, own it yourself. Query the host's `fitted-card` container for breakpoints (see `use-container-queries-not-viewport-units.md`); never declare a container on the root.

```gts
static fitted = class Fitted extends Component<typeof this> {
  <template>
    <article class='my-fitted'>
      <header class='content-header'>
        <h1 class='title boxel-ellipsize'><@fields.cardTitle /></h1>
        <p class='subtitle'><@fields.cardDescription /></p>
      </header>
      <div class='content'>
        <p>Content here...</p>
      </div>
      <footer>
        <p>Footer content here...</p>
      </footer>
    </article>
    <style scoped>
      .my-fitted {
        display: grid;
        grid-template-rows: auto 1fr auto;
        padding: var(--boxel-sp-xs);
        background-color: var(--card);
        color: var(--card-foreground);
      }
      .content {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .title {
        font-weight: 500;
      }
      .subtitle {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
    </style>
  </template>
};
```

### All 16 fitted formats (from `fitted-formats.ts`)

The runtime defines 16 named formats. Sizes are exact spec values (width × height in px):

| Format | Width | Height |
|---|---|---|
| small-badge | 150 | 40 |
| medium-badge | 150 | 65 |
| large-badge | 150 | 105 |
| single-strip | 250 | 40 |
| double-strip | 250 | 65 |
| triple-strip | 250 | 105 |
| double-wide-strip | 400 | 65 |
| triple-wide-strip | 400 | 105 |
| small-tile | 150 | 170 |
| regular-tile | 250 | 170 |
| cardsgrid-tile | 170 | 250 |
| tall-tile | 150 | 275 |
| large-tile | 250 | 275 |
| compact-card | 400 | 170 |
| full-card | 400 | 275 |
| expanded-card | 400 | 445 |

### Form fields

Wrap inputs with `FieldContainer` for consistent label + input layout. Use component API to pass in relevant arguments instead of writing css.

```gts
<FieldContainer @label='Title' @tag='label' @vertical={{true}}>
  <BoxelInput @value={{@model.title}} />
</FieldContainer>
```

### Icons

**Always set explicit `width` and `height` attributes on an icon component** — never size an icon through CSS (`.glyph { width: 1.5rem }`) alone. The attributes give the SVG an intrinsic size, which is required for it to render at the right dimensions during prerender where the scoped CSS may not have applied yet; CSS-only sizing collapses or mis-sizes the glyph in those passes. Use CSS on the icon only for color. This is the one place plain numeric (px-equivalent) sizing is expected — the rem-over-px preference does not apply to icon `width`/`height` attributes.

Icons and SVGs must not use hardcoded hex fills — use theme color tokens via CSS. "Theme token" is not the whole rule, though: **icon color obeys the same pairing rules as text.** Legal values are `--muted-foreground`, `--foreground`, or the `--*-foreground` paired with the surface the icon sits on. An action/surface token (`--primary`, `--accent`, …) is not a foreground: it names a background, and the theme guarantees no contrast for it as ink. This is a common miss precisely because "don't hardcode hex, use a token" reads as satisfied by *any* token.

Best of all is often no color rule at all: an incidental mark that inherits `currentColor` tracks whatever surface it lands on for free.

```gts
// Avoid — hardcoded hex fills
<svg viewBox='0 0 200 120'>
  <ellipse fill='#fed7aa' /><circle fill='#ef4444' />
</svg>

// Avoid — no intrinsic size; relies on CSS that may not apply during prerender
<ChefHat class='chef-hat-icon' />

// Correct — explicit width/height attributes, CSS for color only
<ChefHat width='12' height='12' class='chef-hat-icon' />

// Also correct — no class; the glyph inherits currentColor from its context
<ChefHat width='12' height='12' aria-hidden='true' />
```

```css
/* Correct — a foreground token */
.chef-hat-icon {
  color: var(--muted-foreground);
}
```

### Semantic, accessible HTML

Choose elements by meaning; reserve `<div>` for pure geometry/layout machinery:

- Titles are headings (`<h1>`–`<h4>` at the level the surface calls for), never styled divs.
- Prose goes in `<p>`, not bare text in divs.
- Intro blocks (title + subtitle/description) are wrapped in `<header>`.
- Groups of controls get `role='toolbar'` plus an `aria-label` describing the group.
- Computed/live readouts (counters, results, status values) use `<output>`.
- Icon-only buttons carry an `aria-label`; purely decorative elements (glyphs, ornaments, background shapes) get `aria-hidden='true'`.

Attribute ordering: `data-test-*` attributes go **absolutely last** on an element — after all other attributes and after modifiers.

```gts
// Avoid — divs for everything, no accessible names
<div class='title'>{{@model.cardTitle}}</div>
<div class='controls'>
  <button {{on 'click' this.zoomIn}}><PlusIcon /></button>
</div>
<div class='count'>{{this.count}}</div>

// Correct — semantic elements, labels, data-test last
<header class='intro'>
  <h2><@fields.cardTitle /></h2>
  <p class='subtitle'><@fields.cardDescription /></p>
</header>
<div class='controls' role='toolbar' aria-label='Zoom controls'>
  <button
    type='button'
    aria-label='Zoom in'
    {{on 'click' this.zoomIn}}
    data-test-zoom-in
  >
    <PlusIcon width='16' height='16' aria-hidden='true' />
  </button>
</div>
<output class='count' data-test-count>{{this.count}}</output>
```

### Assume the same card renders more than once per page

The host renders cards without iframes, and the same card instance can be open in multiple workbench stacks side by side — producing duplicate `id`s and duplicate class trees in one document. Write all interaction, animation, scroll, and DOM-lookup code accordingly:

- **Scope every DOM query to the component's own subtree.** Start from the event target or an element captured via modifier and use `element.closest('.boxel-card-container')` (falling back to `ownerDocument`) as the query root — never `document.getElementById` / `document.querySelectorAll('.some-card-class')`, which hit the *first* match, so code in the second stack's copy silently operates on the first stack's DOM.
- Same rule for `querySelectorAll` in animation loops, `IntersectionObserver` targets, and anchor-scroll targets (native `#anchor` jumps are document-wide too).
- **JS query hooks are data attributes, not class names.** Classes are for styling only; give the element a dedicated data attribute and select on that. `data-test-*` attributes are reserved for tests — never use them as runtime hooks.
- Avoid global side effects for per-card behavior: no unscoped `<style>` injections, no `document`-level listeners keyed to one card's state.

```gts
// Avoid — document-wide lookup (hits the first stack's copy) on a styling class
const target = document.querySelector('.timeline-row[data-year="2024"]');

// Correct — scoped to this card's own container, data-attribute hook
scrollToYear = (event: Event) => {
  const root =
    (event.target as HTMLElement).closest('.boxel-card-container') ??
    (event.target as HTMLElement).ownerDocument;
  const target = root.querySelector('[data-timeline-year="2024"]');
  target?.scrollIntoView({ behavior: 'smooth' });
};
```

### Entrance animations — never put `opacity: 0` in base CSS

A card's isolated template is re-mounted every time the user flips formats (`isolated → edit → isolated`), every time the realm reindexes, every time the browser hot-reloads styles. If your entrance animation relies on resting `opacity: 0` plus `animation: … forwards` to fade in, ANY interruption of that animation leaves the element stuck invisible. The user sees a blank card and reports "the card disappears when I switch back from edit."

**The bug:**
```css
/* 🚫 Resting state is opacity: 0. The animation HAS to complete for the card to be visible. */
.section {
  opacity: 0;
  transform: translateY(20px);
  animation: rise 700ms cubic-bezier(0.2, 0.7, 0, 1) forwards;
}
@keyframes rise {
  to { opacity: 1; transform: translateY(0); }
}
```

**The fix:**
```css
/* ✅ Resting state is the natural visible one. The animation's `from` lives in the keyframe. */
.section {
  animation: rise 700ms cubic-bezier(0.2, 0.7, 0, 1) both;
  /* `both` = backwards (hold `from` during delay) + forwards (hold `to` after) */
}
@keyframes rise {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

The principle: **the resting CSS state must be the FINAL state** (visible, in-place), not the initial state. If the animation cancels, fails to fire, or is disabled by `prefers-reduced-motion`, the element falls back to its natural visible state. The `from` block + `animation-fill-mode: both` handles the "hide during delay → animate → stay visible" lifecycle without needing the base CSS to be invisible.

Same rule applies to `transform: scaleX(0)` "drawn rule" effects, staggered card reveals, "flip card" transitions — anywhere the animation's job is to move FROM hidden TO visible:

```css
/* 🚫 invisible at rest */
.draw {
  transform: scaleX(0);
  animation: draw 800ms forwards;
}

/* ✅ visible at rest, keyframe owns the from */
.draw {
  transform-origin: left center;
  animation: draw 800ms both;
}
@keyframes draw {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
```

Reduced-motion override works correctly either way (`animation: none` simply skips the keyframe), but only the fixed version produces a sensible result for users who never see the animation at all.

### Replay an entrance animation when tracked state changes

A Glimmer rerender updates existing DOM; it does not replay a CSS entrance animation. For a stepper, survey, carousel, or wizard that should animate each new tracked value, key a single-item `{{#each}}` by that value so Glimmer removes the old block and inserts a new one:

```gts
import { array } from '@ember/helper';
```

```hbs
{{#each (array this.activeStep) key='@identity' as |stepKey|}}
  <section class='step-entrance' data-step-key={{stepKey}}>
    {{! content for the active step }}
  </section>
{{/each}}
```

Use the block parameter in a `data-*` attribute so the key remains explicit. Keep persistent controls, progress, and navigation outside the keyed block: remounting intentionally resets focus and local DOM state inside it. Pair this with the visible resting-state rule above so reduced-motion and canceled animations remain usable.
