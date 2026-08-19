## Template Patterns

### Isolated / embedded templates

Do NOT use `CardContainer` as the root — the runtime (`field-component.gts`) already wraps every card format in `CardContainer`. Adding a second `CardContainer` is a redundant double-wrap.

The themed `CardContainer` already applies `font-family: var(--boxel-body-font-family)` (and matching `font-size`, `font-weight`, `line-height`) on its root element. Do NOT repeat this on your template's root element — it is already inherited by all children.

Via `@layer reset`, all heading and text elements inside a themed card automatically receive semantic typography — no need to declare font/size/weight on them unless overriding:

| Element | Token set applied |
|---|---|
| `h1` | `--boxel-heading-*` (font-family, size, weight, line-height) |
| `h2` | `--boxel-section-heading-*` |
| `h3` | `--boxel-subheading-*` |
| `p` | `--boxel-body-*` |
| `small` | `--boxel-caption-font-size`, `--boxel-caption-line-height` |

Also applied to the container root: `letter-spacing: var(--tracking-normal)` — do not redeclare it.

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

```gts
static fitted = class Fitted extends Component<typeof this> {
  <template>
    <article class='my-fitted'>
      <header class='content-header'>
        <h1 class='title boxel-ellipsize'><@fields.cardTitle /></h1>
        <p class='subtitle'><@fields.cardDescription /></p>
      </header>
     <div class='body-content'>
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

### Form fields

Wrap inputs with `FieldContainer` for consistent label + input layout. Use component API to pass in relevant arguments instead of writing css.

```gts
<FieldContainer @label='Title' @tag='label' @vertical={{true}}>
  <Input @value={{@model.title}} />
</FieldContainer>
```

### Icons

**Always set explicit `width` and `height` attributes on an icon component** — never size an icon through CSS (`.glyph { width: 1.5rem }`) alone. The attributes give the SVG an intrinsic size, which is required for it to render at the right dimensions during prerender where the scoped CSS may not have applied yet; CSS-only sizing collapses or mis-sizes the glyph in those passes. Use CSS on the icon only for color. This is the one place plain numeric (px-equivalent) sizing is expected — the rem-over-px preference does not apply to icon `width`/`height` attributes.

Icons and SVGs must not use hardcoded hex fills — use theme color tokens via CSS:

```gts
// Avoid — hardcoded hex fills
<svg viewBox='0 0 200 120'>
  <ellipse fill='#fed7aa' /><circle fill='#ef4444' />
</svg>

// Avoid — no intrinsic size; relies on CSS that may not apply during prerender
<ChefHat class='chef-hat-icon' />

// Correct — explicit width/height attributes, CSS for color only
<ChefHat width='12' height='12' class='chef-hat-icon' />
```

```css
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
