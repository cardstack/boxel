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

Icons and SVGs must not use hardcoded hex fills — use theme color tokens via CSS:

```gts
// Avoid — hardcoded hex fills
<svg viewBox='0 0 200 120'>
  <ellipse fill='#fed7aa' /><circle fill='#ef4444' />
</svg>

// Correct — styled with theme token
<ChefHat width='12' height='12' class='chef-hat-icon' />
```

```css
.chef-hat-icon {
  color: var(--muted-foreground);
}
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
