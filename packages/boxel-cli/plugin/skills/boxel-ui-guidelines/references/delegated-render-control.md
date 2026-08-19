# Delegated Render Control — Styling `<@fields.X />` From the Parent

When a parent card renders a linked or compound field via `<@fields.X @format='...' />`, the host wraps the child render in chrome you didn't write. Default chrome looks like "shadcn neutral card": rounded corners, soft border, white-ish background, `overflow: hidden`, padding for atoms. If your parent's design language disagrees (Row & Rail wants `--radius: 0` and editorial sharp corners), the chrome fights it.

This file documents EXACTLY what the host injects and EXACTLY how the parent overrides it. Source: `~/Projects/boxel/packages/base/field-component.gts` + `~/Projects/boxel/packages/boxel-ui/addon/src/components/card-container/index.gts`.

**Related but distinct concern — Host-mode click-through.** When you render a result list via `@context.searchResultsComponent` (or the older `PrerenderedCardSearch` surface) inside an app card that publishes to Host mode, the rendered tiles need an explicit anchor overlay to be clickable. The in-app `@context.cardComponentModifier` machinery only fires in Interact / Code mode. See [`app-card-home-with-search`](../../boxel-patterns/patterns/app-card-home-with-search/README.md) → "Host-mode click-through" for the overlay pattern.

**Also distinct — content matrix per format.** What FIELDS render in fitted vs embedded vs atom is a Stage 0f planning decision (the content matrix), not a styling decision. If a fitted child renders data-empty, the parent's `:deep()` won't fix it — the child's `static fitted` template needs to consult its CardDef's content matrix. See [`design-playbook.md`](../../boxel/references/design-playbook.md) Stage 0f.

## What the host injects per format

When you write `<@fields.featured @format='<F>' />`, the rendered DOM is:

```html
<div class="boxel-card-container
            field-component-card
            <F>-format                          /* isolated-format | embedded-format | fitted-format | atom-format */
            display-container-<true|false>      /* depends on @displayContainer arg */
            boxel-card-container--boundaries    /* present unless @displayContainer={{false}} */
            boxel-card-container--themed"       /* present if the linked card has cardInfo.theme */
     data-boxel-card-container
     data-boxel-card-id="…"
     data-boxel-card-format="<F>">
  <!-- the linked card's static <F> template renders here -->
</div>
```

## Default CSS the host applies (every parent inherits this)

```css
/* From card-container/index.gts — global so it can be styled anywhere */
:global(.boxel-card-container) {
  position: relative;
  background-color: var(--background, var(--boxel-light));
  border-radius: var(--_boxel-radius);
  color: var(--foreground, var(--boxel-dark));
  height: 100%;
  width: 100%;
  overflow: hidden;
  z-index: 0;
}
:global(.boxel-card-container--boundaries) {
  box-shadow: 0 0 0 1px var(--border, var(--boxel-border-color));
}

/* From field-component.gts — per-format additions */
.field-component-card.embedded-format {
  container-name: embedded-card;
  container-type: inline-size;
  overflow: hidden;
}
.field-component-card.fitted-format {
  width: 100%; height: 100%;
  min-height: 40px;
  max-height: 600px;
  container-name: fitted-card;
  container-type: size;
  overflow: hidden;
}
.field-component-card.atom-format.display-container-true {
  display: inline-block;
  width: auto; height: auto;
  padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
}
.field-component-card.atom-format.display-container-false {
  display: contents;          /* no chrome at all */
}
.field-component-card.atom-format > :deep(*) {
  vertical-align: middle;     /* baseline default for inline children */
}
```

**The five most common consequences:**

1. **Rounded corners on every embedded child** — `border-radius: var(--_boxel-radius)` is the Boxel default (`0.5rem`-ish). Sharp-corner designs need to override this.
2. **A 1px halo around the chrome** — `box-shadow: 0 0 0 1px var(--border)` when `--boundaries` is on (default).
3. **Cream/white background** — `--background` defaults to `var(--boxel-light)`. If your parent's paper color differs, the embedded child looks pasted on.
4. **Images clipped at corners** — `overflow: hidden` is hardcoded. Hero images that should bleed past the corner get clipped.
5. **Atoms are inline-block with padding** — they sit as little chips, not as raw inline content. They get `vertical-align: middle`, which doesn't always align with surrounding prose baseline.

## Override layers — pick the lowest one that works

### Layer 0 — theme cascade (the cleanest)

If the linked card has `cardInfo.theme` AND the theme sets the variables, the cascade carries values into the wrapper without `:deep()`:

| Token the theme sets | Effect on the wrapper |
|---|---|
| `--background` | wrapper background |
| `--foreground` | text color inside |
| `--border` | the 1px halo color (only visible if `--boundaries` is on) |
| `--radius` | cascades into `--_boxel-radius` IF the card has `--themed` class |

Caveat: the wrapper's `--themed` class is only added when `hasTheme(card)` is true on the *linked* card. If your performer / venue / listing instances DON'T have `cardInfo.theme`, the wrapper won't pick up your `--radius: 0` from the parent.

### Layer 1 — `:deep()` from the parent's `<style scoped>` (the workhorse)

`:deep()` pierces scoping so the parent's CSS can target descendant elements. The CardContainer is `:global(.boxel-card-container)`, so `:deep()` works for it too.

```css
/* In the PARENT card's <style scoped> */

/* Square corners on every embedded child inside .prg-listings-grid */
.prg-listings-grid :deep(.boxel-card-container) {
  border-radius: 0;
  background: var(--paper);
}

/* Kill the halo selectively */
.prg-listings-grid :deep(.boxel-card-container--boundaries) {
  box-shadow: none;
}

/* Let images bleed past the chrome */
.prg-hero :deep(.field-component-card.embedded-format) {
  overflow: visible;
}

/* Target by format via data-attribute (more readable for some) */
.prg-listings-grid :deep([data-boxel-card-format="embedded"]) {
  border-radius: 0;
  box-shadow: none;
}
```

### Layer 2 — `@displayContainer={{false}}` (kill the chrome entirely)

For atoms especially, often you want NO chrome — just the linked card's content inline, as if it were raw text. The arg works for any format the field-component supports:

```hbs
<@fields.headliner @format='atom' @displayContainer={{false}} />
```

This causes the wrapper to render as `display: contents` — the container disappears, only the children layout. **The class on the wrapper still exists** (`field-component-card atom-format display-container-false`) but it's transparent to layout.

Pair this with a sibling element styled by the parent to provide the visual chip:

```hbs
<span class='prg-bill-chip'>
  <@fields.headliner @format='atom' @displayContainer={{false}} />
</span>
```

```css
.prg-bill-chip {
  display: inline-flex;
  align-items: baseline;
  padding: 4px 10px;
  border: 1px solid var(--ink);
  border-radius: 0;        /* sharp corners — Row & Rail */
  background: transparent;
}
.prg-bill-chip :deep(*) {
  vertical-align: baseline;  /* override the host's vertical-align: middle */
}
```

Now the chip is YOURS — borders, padding, alignment all under parent control, and the child's atom content renders inside without competing chrome.

## Plural fields — the wrapper trap (HIGH-FREQUENCY BUG)

When the parent renders a plural field with one tag — `<@fields.topSwimmers @format='fitted' />`, `<@fields.participatingClubs @format='embedded' />`, `<@fields.recentResults @format='embedded' />` — the host inserts a wrapper *between* your grid container and each card. Your `display: grid` sees ONE child (the wrapper), the wrapper contains all the cards, and the layout collapses to a single column.

### What the host actually inserts

```html
<!-- linksToMany -->
<div class="plural-field linksToMany-field <format>-format">
  <div class="linksToMany-itemContainer">
    <div class="linksToMany-item">
      <div class="boxel-card-container field-component-card <format>-format …">…</div>
    </div>
  </div>
  <div class="linksToMany-itemContainer">…</div>
  …
</div>

<!-- containsMany (compound field with @format) -->
<div class="plural-field containsMany-field <format>-format">
  <div class="containsMany-item">
    <div class="boxel-card-container field-component-card …">…</div>
  </div>
  …
</div>
```

Note the differences: `linksToMany` has an extra `.linksToMany-itemContainer` wrapper (one per item), AND another `.linksToMany-item` inside it. `containsMany` is shallower — just `.containsMany-item` per item. Both share the outer `.plural-field` class — that's the only class common to both shapes.

### The fix — collapse every wrapper so the grid sees the actual cards

```css
.swm-swimmers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
/* The outer plural wrapper — covers both linksToMany and containsMany */
.swm-swimmers :deep(> .plural-field) {
  display: contents;
}
/* The per-item wrappers — different between linksToMany and containsMany,
   but harmless to list both since unused ones simply don't match */
.swm-swimmers :deep(.linksToMany-itemContainer),
.swm-swimmers :deep(.containsMany-item) {
  display: contents;
}
```

Now the grid sees `.field-component-card` instances as its direct children and lays them out properly.

⚠️ **Targeting only `.containsMany-field` is the most common bug.** Older patterns (and the host's own legacy class) sometimes show only that class — but `linksToMany` ships with `.linksToMany-field`, which never matches `:deep(> .containsMany-field)`. Use `.plural-field` for the outer wrapper.

### Staggered animations through `display: contents` wrappers

`:nth-child` resolves against the DOM, not the visual flow — so `.field-component-card:nth-child(N)` matches whatever sits inside the per-item wrapper (always the only child of its parent → always `:nth-child(1)`). Staggered delays applied directly to the cards collapse to a single delay value.

Use CSS custom-property inheritance — values pass through `display: contents` because they're inherited:

```css
.swm-stagger :deep(.linksToMany-itemContainer:nth-child(1)),
.swm-stagger :deep(.containsMany-item:nth-child(1)) { --stagger-d: 80ms; }
.swm-stagger :deep(.linksToMany-itemContainer:nth-child(2)),
.swm-stagger :deep(.containsMany-item:nth-child(2)) { --stagger-d: 160ms; }
/* …etc, or use :nth-child(n+8) to cap the cascade */

.swm-stagger {
  --stagger-d: 0ms;   /* base value — items past the stagger cap animate immediately */
}
.swm-stagger :deep(.field-component-card) {
  opacity: 0;
  transform: translateY(12px);
  animation: rise 600ms cubic-bezier(0.2, 0.7, 0, 1) forwards;
  animation-delay: var(--stagger-d);
}
```

The `:nth-child` runs on the wrapper (whose DOM-position is stable, 1-indexed across the plural field), the `--stagger-d` value inherits down through the per-item wrapper to `.field-component-card`, and the animation reads it directly.

### Singular linksTo / contains is fine — no wrapper

`<@fields.featuredEvent @format='embedded' />` renders the `.field-component-card` directly, no plural wrapper. The existing `:deep(.boxel-card-container) { … }` overrides apply as-written.

## Atom alignment — the dedicated pattern

Atoms default to `display: inline-block; vertical-align: middle; padding: var(--boxel-sp-4xs) var(--boxel-sp-xs)`. That makes them sit as floating chips. To align with surrounding text (baseline, not middle), or to layout-grid them into a parent's structure:

```css
/* In the parent's <style scoped> */

/* Make atoms baseline-align with surrounding prose */
.prg-bill :deep(.field-component-card.atom-format) {
  vertical-align: baseline;
}

/* If atom is in a grid cell, center it vertically */
.prg-bill-row :deep(.field-component-card.atom-format) {
  align-self: center;
}

/* Strip the default padding when you want raw text inside your own chip */
.prg-bill-chip :deep(.field-component-card.atom-format) {
  padding: 0;
}

/* The host's :deep(*) vertical-align rule on atom children — override on demand */
.prg-bill-chip :deep(.field-component-card.atom-format > *) {
  vertical-align: baseline;
}
```

For a row of atoms (e.g. "01 Headlining: [Big Thief]"), the cleanest pattern is **`@displayContainer={{false}}`** + a parent-owned chip span. Then the parent decides everything (sharp corners, ink-on-paper background, baseline alignment) and the atom's actual content (the linked card's name) sits inside.

### ⚠️ Atoms on dark backgrounds disappear by default

The default atom render is `inline-block` with `padding`, the global `.boxel-card-container` background (`var(--background, var(--boxel-light))` — a near-white), AND a `--boundaries` box-shadow ring. Inside the chrome, `DefaultAtomViewTemplate` renders the linked card's `cardTitle` as a `<span>`. If your parent context has a dark background and you set `color: inherit` on the atom chip, the chip's *own* near-white background still wins — and you get a gray pill with invisible text.

**Two fixes, pick one:**

```hbs
{{!-- A) Strip the chrome entirely — atom renders as plain inline text --}}
<@fields.swimmer @format='atom' @displayContainer={{false}} />

{{!-- B) Keep the chrome but recolor it from the parent --}}
<@fields.swimmer @format='atom' />
```

```css
/* If you went with (B), inside the parent's scoped style: */
.dark-header :deep(.field-component-card.atom-format) {
  background: transparent;     /* drop the near-white surface */
  box-shadow: none;            /* drop the boundaries ring */
  color: var(--accent);        /* and set foreground explicitly */
}
.dark-header :deep(.boxel-card-container--boundaries) {
  box-shadow: none;            /* in case --boundaries is the variant in use */
}
```

(A) is the right call inside running text or label/value rows where you don't want chip chrome at all. (B) is the right call when you DO want a visible chip — you just want it to match your dark surface.

## Picking the divider strategy — parent draws OR child halo, never both

The second-most-common bug after "wrong format for the cell size" is the **double-rule trap**: the parent adds its own divider lines between cards (`border-bottom`, `border-right`, an outer `border` on a grid), and *also* leaves the host's default `.boxel-card-container--boundaries` `box-shadow: 0 0 0 1px var(--border)` in place. At every boundary, two lines render at slightly different weights or colors — the user sees this as a drop shadow fighting a thin border.

You always have to pick one of two strategies. There is no in-between.

### Strategy A — parent draws dividers (newspaper grid, list rows)

```css
.event-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;                                          /* no gap — rows touch */
  border-top: 1px solid var(--ink);                /* parent owns the rules */
}
.event-list :deep(.boxel-card-container--boundaries) {
  box-shadow: none;                                /* MUST kill the child halo */
}
.event-list :deep(.field-component-card.embedded-format) {
  border-bottom: 1px solid var(--rule-soft);       /* parent draws between */
}
```

Use for: vertical lists, editorial newspaper grids, table-style rosters, anywhere the design is "cards as data rows separated by hairlines."

### Strategy B — child halo is the boundary (gap-spaced tile grid)

```css
.event-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;                                       /* gap is the breathing room */
}
.event-grid :deep(.boxel-card-container--boundaries) {
  box-shadow: 0 0 0 1px var(--ink);                /* keep / recolor the child halo */
}
/* DON'T add border-bottom / border-right on the cards — that's the double rule */
```

Use for: card-style tile grids, dashboards with floating "objects," anywhere each card should feel like a separate UI element with airspace around it.

### Decision

| What you want | Strategy |
|---|---|
| Rows touching, single 1px line between them | A — parent draws, kill child halo |
| Tiles with gaps and their own visible boundary | B — keep child halo, no parent borders |
| Tiles with gaps and NO boundaries (cards on paper) | B — but `box-shadow: none` on `--boundaries` too |
| Heavy outer frame + inner thin dividers | A — both outer border AND inner divider on parent, child halo OFF |

### Switching strategies mid-build

When you change a section from Strategy B (halo IS the boundary) to Strategy A (parent draws dividers), you MUST find and DELETE the old halo rule. Don't just add a `box-shadow: none` override later in the file. Same-selector / same-specificity CSS resolves by source order — the stale rule further down wins, and your "fix" silently does nothing.

```css
/* ❌ Two rules, same selector — the LAST one wins. Your fix is invisible. */
.event-list :deep(.boxel-card-container--boundaries) {
  box-shadow: none;                                /* line 200 */
}
/* … 30 lines of unrelated rules … */
.event-list :deep(.boxel-card-container--boundaries) {
  box-shadow: 0 0 0 1px var(--ink);                /* line 230 — stale, but wins */
}

/* ✅ Delete the stale rule entirely. One source of truth per selector. */
.event-list :deep(.boxel-card-container--boundaries) {
  box-shadow: none;
}
```

Audit step before declaring a chrome change done: `grep -c "boundaries" your-file.gts` should return one rule per section. If a section has two, one is stale.

### The failure mode

Looks like: every card has a slight drop-shadow halo plus a thin border line between them. The user calls it "drop shadow fighting with thin border." It's NOT a shadow vs. border — it's the host's `--boundaries` 1px shadow rendered on top of (or under) the parent's own 1px border.

Other tell-tales:
- Top and bottom of the list look "doubled" — the parent's `border-top` lands at the same pixel as the first card's halo.
- A horizontal rule at the boundary is darker / lighter in two places (because the halo is `var(--border)` and the parent's rule is `var(--rule-soft)`).
- Hover lift transforms the card +2px and you suddenly see the parent's static border line where the card used to be.

## Picking the format — fitted vs embedded (decide BEFORE you style)

The single most common rendering bug: the parent picks `@format='fitted'` for a list of cards, the cards have short content, and each cell becomes a huge box with empty space below the content. The user calls it out: *"the box is bigger than the actual format."*

The fix is upstream of CSS — it's the format choice. The two formats have fundamentally different layout contracts:

| Format | Who controls the box size? | Use when |
|---|---|---|
| `embedded` | **The child.** `container-type: inline-size` only — width is fluid, height is whatever the card's content + padding adds up to. | A vertical list (event lineup, results feed, clubs roster), variable-height items, anything where the card's natural content should dictate the row height. |
| `fitted` | **The parent.** `width: 100%; height: 100%; container-type: size`. The card fills whatever box you give it. Inside, the card's own `static fitted` uses container queries to pick a layout based on the box dimensions you supplied. | A uniform tile grid (calendar cells, swimmer portraits, badge strip), thumbnail toolbar, anywhere you've *deliberately set the cell size* and want every card to fill it identically. |

### The decision rule

**Did you set the cell size?**
- *Yes — I want all cells the same height/aspect for visual rhythm* → `fitted`, and set `min-height` / `aspect-ratio` on the cell.
- *No — let the content decide* → `embedded`, and don't set `min-height` on the cell.

### Anti-patterns

```hbs
{{!-- 🚫 fitted into a flex column with no height — empty white box --}}
<div class='event-list'>
  <@fields.events @format='fitted' />
</div>
```
```css
.event-list {
  display: flex;
  flex-direction: column;
}
.event-list :deep(.fitted-format) {
  min-height: 160px;    /* fitted now forces 160px; short content leaves 80px empty */
}
```

```hbs
{{!-- ✅ embedded — each event row hugs its own height --}}
<div class='event-list'>
  <@fields.events @format='embedded' />
</div>
```
```css
.event-list {
  display: grid;
  grid-template-columns: 1fr;
  border-top: 1px solid var(--ink);
}
.event-list :deep(.field-component-card.embedded-format) {
  border-bottom: 1px solid var(--rule-soft);  /* divider, not a forced height */
}
```

### When the child has both formats, the child decides what each one is for

If the `Event` card's `static embedded` is designed as a one-line list row (icon + name + meta), use it for lists. If its `static fitted` is designed as a 220×160 calendar-style tile, use it for calendar grids. Don't pick the format you *want* the layout to be — pick the format the child *implements* as that layout.

When in doubt, read the child's `static embedded` and `static fitted` source — they advertise their intended sizes.

## Format-specific recipes

### Embedded — for grids of related cards (Row & Rail listings, performers, venues)

```hbs
<div class='prg-listings-grid'>
  {{#each @fields.currentListings as |Listing|}}
    <Listing @format='embedded' />
  {{/each}}
</div>
```

```css
.prg-listings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 24px;
}
.prg-listings-grid :deep(.boxel-card-container) {
  border-radius: 0;
  background: transparent;
  box-shadow: none;        /* if the parent owns the divider rules */
}
.prg-listings-grid :deep(.field-component-card.embedded-format) {
  overflow: visible;       /* if image bleeds matter */
}
```

### Fitted — for compact card thumbnails in toolbars / pickers

```hbs
<@fields.featured @format='fitted' />
```

```css
.toolbar :deep(.boxel-card-container.fitted-format) {
  border-radius: 4px;
  /* DON'T override width/height — fitted needs the host's 100%/100% for its own container queries */
}
```

⚠️ **Don't override `width: 100%; height: 100%` on `.fitted-format`** — the child's container queries depend on those. Stick to chrome (radius, background, border, shadow) and let the layout primitives stay.

### Isolated — when embedding a full card surface inside another (rare; e.g. dashboard preview)

```css
.preview :deep(.boxel-card-container.isolated-format) {
  /* isolated takes height: 100% — make sure the parent provides height */
}
```

### Atom — when inline with prose or in compact rows

Best practice: `@displayContainer={{false}}` + parent-owned chip span. See "Atom alignment" above.

## Cross-cutting concerns

### Don't break the child's container queries

Embedded cards declare `container-type: inline-size; container-name: embedded-card`. Fitted declares `container-type: size; container-name: fitted-card`. These are the child's basis for responsive layout. Overriding them from the parent (via `:deep`) breaks the child's design. Style the chrome (`border`, `background`, `border-radius`, `box-shadow`, `padding`), not the layout primitives.

### Theme tokens cascade INTO `:deep()` overrides

When you write `:deep(.boxel-card-container) { background: var(--paper); }`, the `var(--paper)` resolves in the PARENT'S scope. Themes set the token; the override applies the token. This is the right way — don't hardcode hex inside `:deep()` blocks if a theme token captures the value.

### Test the override after a theme change

If you set `--radius: 0` on the parent's theme, then in a `:deep()` override write `border-radius: 0`, you have two sources of truth. When the theme later changes to `--radius: 4px`, the `:deep()` block still says `0`. Prefer:

```css
.prg-listings-grid {
  --child-radius: var(--radius, 0);   /* one declaration: theme wins, sharp fallback */
}
.prg-listings-grid :deep(.boxel-card-container) {
  border-radius: var(--child-radius);
}
```

### Embedded MarkdownDef — tune the bounded preview with custom properties

The base `MarkdownDef` embedded format (`packages/base/markdown-file-def.gts`) renders a **bounded preview**: the content is clamped to a max height with a bottom fade mask, so a long document doesn't blow out the embedding card's layout. It exposes two custom properties for tuning that box:

| Property | Default | What it controls |
|---|---|---|
| `--markdown-embedded-max-height` | `200px` | The clamp height of the preview |
| `--markdown-embedded-mask` | a bottom fade | The fade-out mask applied at the clamp edge |

Set them on **any ancestor of the embedded render** — they inherit across the embed boundary into the framework's markup:

```css
/* Taller bounded preview — still clamped + faded, just more of it visible */
.doc-panel {
  --markdown-embedded-max-height: 480px;
}

/* Full, unbounded content — you MUST clear both, together */
.doc-panel {
  --markdown-embedded-max-height: none;
  --markdown-embedded-mask: none;
}
```

Clearing only the height leaves the fade mask painting over the tail of the content; clearing only the mask leaves the height clamp cutting it off. For unbounded display, set both to `none`.

**Why custom properties are the mechanism.** This embedded render is framework-driven — the host, not your template, instantiates the `MarkdownDef`'s embedded component. It takes no component args (`@maxHeight=…`), because the embedding context never calls the component; it only supplies the surrounding DOM. An **inherited custom property is the lever that crosses that boundary** — it rides the CSS cascade down into the framework's markup.

## Quick-reference cheat sheet

| Need | Tool |
|---|---|
| Vertical list of cards with natural row heights | `@format='embedded'`, NOT fitted |
| Uniform tile grid where every card fills a fixed box | `@format='fitted'` + parent sets `min-height` / `aspect-ratio` |
| Plural grid (linksToMany or containsMany) lays out correctly | `:deep(> .plural-field) { display: contents; }` + `:deep(.linksToMany-itemContainer), :deep(.containsMany-item) { display: contents; }` |
| Stagger per-item animation delays | Set `--stagger-d` on `:deep(.linksToMany-itemContainer:nth-child(N))`; read `animation-delay: var(--stagger-d)` on `.field-component-card` |
| Override embedded child's `border-radius` | `:deep(.boxel-card-container) { border-radius: 0; }` |
| Override embedded child's `background` | `:deep(.boxel-card-container) { background: var(--paper); }` |
| Kill the 1px halo | `:deep(.boxel-card-container--boundaries) { box-shadow: none; }` |
| Let images bleed past corners | `:deep(.field-component-card.embedded-format) { overflow: visible; }` |
| Target by format | `:deep([data-boxel-card-format="embedded"]) { ... }` |
| Kill chrome entirely (atom) | `<@fields.X @format='atom' @displayContainer={{false}} />` |
| Taller embedded MarkdownDef preview | set `--markdown-embedded-max-height: 480px` on an ancestor |
| Full, unbounded embedded MarkdownDef | set `--markdown-embedded-max-height: none` AND `--markdown-embedded-mask: none` on an ancestor |
| Atom visible on dark background | `@displayContainer={{false}}`, OR `:deep(.field-component-card.atom-format) { background: transparent; box-shadow: none; }` |
| Atom baseline-align with prose | `:deep(.field-component-card.atom-format) { vertical-align: baseline; }` |
| Atom padding match parent's chip | `:deep(.field-component-card.atom-format) { padding: 0; }` |
| Override atom child element alignment | `:deep(.field-component-card.atom-format > *) { vertical-align: baseline; }` |

## What NOT to override

- `width: 100%; height: 100%` on `.field-component-card.fitted-format` — child container queries depend on this.
- `container-type` / `container-name` on embedded/fitted — child layout depends on this.
- `display: contents` on `atom-format.display-container-false` — that's the whole mechanism for "no chrome".

---

## The flip side — what the CHILD card MUST NOT do (contract)

Everything above is how the PARENT overrides the host's chrome. The contract has a second half: **the child card's formats must leave the outer chrome to the host (and to any consuming parent).** When a child decorates its own outermost element, it competes with the wrapper and breaks the parent's ability to override.

### The simple rule

**The child draws ONLY inside the box. The host or parent draws the box.**

```gts
{{!-- ❌ Child's isolated decorates its outer element --}}
<article class='news-isolated'>
  ...
</article>
<style scoped>
  .news-isolated {
    border-radius: 12px;                       /* wrapper already sets radius */
    border: 1px solid #e5e7eb;                 /* competes with --boundaries halo */
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);    /* same competition */
    background: white;                         /* blocks --background cascade */
    overflow: hidden;                          /* wrapper already clips */
  }
</style>

{{!-- ✅ Child outer is clean; design lives inside --}}
<article class='news-isolated'>
  ...
</article>
<style scoped>
  .news-isolated {
    color: var(--ink);            /* OK — inner concern */
    padding: 48px;                /* OK — inner concern */
    display: grid;                /* OK — inner layout */
    gap: 32px;                    /* OK — inner concern */
    /* NO border-radius, NO border, NO box-shadow, NO opaque background */
  }
</style>
```

### Per format — what's safe and what isn't on the outermost element

`CardContainer` — which wraps every card render, not just field embeds — already applies the theme's `background-color`, `color`, `font-family` (the theme's `--font-sans`, falling back to the Boxel sans stack), and body `font-size` on its root; templates inherit all of them for free. Don't declare any of these on the root unless you're deviating: `font-family` only when the whole card should use something other than `--font-sans` (such as `--font-serif`); `background-color`/`color` only when a pairing other than the theme's main background/foreground is preferred. `fitted` and `embedded` card templates MAY make that switch (e.g. `background-color: var(--card); color: var(--card-foreground)`); `isolated` and CardDef `edit` templates keep the theme's pair.

| Format | OK on outermost | NOT OK on outermost (host/parent owns) |
|---|---|---|
| `isolated` | inner padding, inner grid/flex layout, `min-height` for content | `border-radius`, `border`, `box-shadow`, `overflow`, background/foreground overrides (use the theme's) |
| `embedded` | same as isolated — plus MAY use a different background/foreground pairing from the theme (e.g. `--card` + `--card-foreground`) | `border-radius`, `border`, `box-shadow`, `overflow`, `width`/`height`/`max-width` |
| `fitted` | a background/foreground pairing different from the theme's (e.g. `--card` + `--card-foreground`), inner padding, inner grid template, inner gap | `border-radius`, `border`, `box-shadow`, `width`, `height`, `min-height`, `max-height`, `container-type`, `container-name` (the host sets these) |
| `atom` | inline content only (text node, small inline icon) | `padding` (host provides), `border`, `border-radius`, `background`, any `display` other than inline-by-default |
| `edit` | form field spacing, internal stack/grid layout | outer chrome same as isolated (keep the theme's background/foreground) |

**Compound-field templates are the exception to the edit/embedded rows:** a FieldDef's `embedded` and `edit` templates render nested *inside* a card surface, so they may choose a different background/foreground combo to distinguish themselves from the surrounding card — `--card` + `--card-foreground` is the usual choice.

### When your design genuinely demands a specific outer treatment

Put it on the **Theme card**, not the child's format CSS. The CardContainer's `--themed` cascade picks up `--radius`, `--background`, `--border`, `--foreground` from the theme and applies them at the wrapper. Every card linked to that theme inherits the outer treatment without competing with the host.

Row & Rail's editorial sharp-corner aesthetic, for example:

```
Theme/row-and-rail.json cssVariables:
  --radius: 0;                /* ← wrapper picks up via --_boxel-radius */
  --background: #f4eee1;      /* ← wrapper background = brand paper */
  --border: #1a1814;          /* ← halo when --boundaries on = brand ink */
```

Every card linked to that theme renders with sharp corners + paper background + ink halo, automatically. No format CSS needed.

### Why this matters — the failure mode

When the parent (e.g., the Programme showcase) embeds your card:

- **Contract honored:** parent's `:deep(.boxel-card-container) { border-radius: 0; background: var(--paper); }` overrides cleanly. Sharp corners, brand paper, no double-borders.
- **Contract violated:** child's own `border-radius: 12px` on `.news-isolated` competes with parent's `:deep` override. Specificity wars. Or child's `box-shadow` stacks under the halo creating a double-border. Or child's `background: white` blocks the parent's `--paper` cascade — embedded child looks pasted on instead of integrated.

The single most common symptom in agent-generated cards is rounded-corner embedded children inside a sharp-corner parent. Cause: every child added `border-radius: 8px` to its outer because "cards have rounded corners." Fix: strip the outer decoration; trust the wrapper.

### Self-check before declaring a format done

Before any `static isolated|embedded|fitted|atom|edit = class { ... }` is considered complete:

1. Does the outermost element have `border-radius`, `border`, or `box-shadow`? If yes — move that decision to the Theme card, or remove it. For `isolated` and CardDef `edit`, also don't override the theme's background/foreground; `fitted` and `embedded` may use a different pairing (e.g. `--card` + `--card-foreground`).
2. For `fitted`: does the outermost element set `width`, `height`, `min/max-height`, `container-type`, or `container-name`? If yes — remove. The host sets these on `.field-component-card.fitted-format`. (`background-color` paired with `color` is fine on a fitted root — boxel-ui's `FittedCard` sets both.)
3. For `atom`: is the outermost element doing anything more than inline text + maybe one inline icon? If yes — restructure. Atoms are inline content, not chips. (Chips are the parent's job; see `@displayContainer={{false}}` recipes.)
4. Open the card both standalone (in the stack) and embedded inside another card. Does it look right in BOTH contexts? If only one, the child is decorating the outer.

Stage 4 of the design playbook (deriving fitted + embedded from the established visual language) lives inside this contract: design the content; trust the wrapper.

## Source files (verify before depending on details)

- `~/Projects/boxel/packages/boxel-ui/addon/src/components/card-container/index.gts` — CardContainer + the global selector + `--themed` cascade
- `~/Projects/boxel/packages/base/field-component.gts` — per-format classes + `displayContainer` arg
- `~/Projects/boxel/packages/catalog-realm/crm-app/contact.gts:121,218` — production examples of `@displayContainer={{false}}` for atom
- `~/Projects/boxel/packages/catalog-realm/sprint-planner/sprint-task.gts:208-211` — atom with custom class + display:contents
