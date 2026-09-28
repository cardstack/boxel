# Delegated Render Control — Styling `<@fields.X />` From the Parent

When a parent card renders a linked or compound field via `<@fields.X @format='...' />`, the host wraps the child render in chrome you didn't write. Default chrome looks like "shadcn neutral card": rounded corners, soft border, white-ish background, `overflow: hidden`, padding for atoms. If your parent's design language disagrees (Row & Rail wants `--radius: 0` and editorial sharp corners), the chrome fights it.

This file describes the styles the host injects around a card and how a parent overrides them, as of the field-component and card-container sources in the [Boxel monorepo](https://github.com/cardstack/boxel) (`packages/base/field-component.gts`, `packages/boxel-ui/src/components/card-container/index.gts`). When this file and those sources disagree, the sources win.

**Related but distinct concern — Host-mode click-through.** When you render a result list via `@context.searchResultsComponent` inside an app card that publishes to Host mode, the rendered tiles need an explicit anchor overlay to be clickable. The in-app `@context.cardComponentModifier` machinery only fires in Interact / Code mode. See [`app-card-home-with-search`](../../boxel-patterns/patterns/app-card-home-with-search/README.md) → "Host-mode click-through" for the overlay pattern.

**Also distinct — content matrix per format.** What FIELDS render in fitted vs embedded vs atom is a Stage 0f planning decision (the content matrix), not a styling decision. If a fitted child renders data-empty, the parent's `:deep()` won't fix it — the child's `static fitted` template needs to consult its CardDef's content matrix. See [`design-playbook.md`](../../boxel/references/design-playbook.md) Stage 0f.

## What the host injects per format

When you write `<@fields.featured @format='<F>' />`, the rendered DOM is:

```html
<div class="boxel-card-container
            field-component-card
            <F>-format                          /* isolated-format | embedded-format | fitted-format | atom-format */
            display-container-<true|false>      /* depends on @displayContainer arg */
            boxel-card-container--boundaries    /* present unless @displayContainer={{false}} */
            boxel-card-container--themed"       /* marker only: present when the linked card resolves a cardTheme; no CSS keys off it */
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
  border-radius: var(--boxel-radius);   /* var(--radius, var(--_boxel-radius)) — follows the theme */
  color: var(--foreground, var(--boxel-dark));
  height: 100%;
  width: 100%;
  overflow: hidden;
  z-index: 0;
  transition: max-width var(--boxel-transition), box-shadow var(--boxel-transition);
}
:global(.boxel-card-container--boundaries:not(.hide-boundaries)) {
  box-shadow: 0 0 0 1px var(--border, var(--boxel-border-color));
}

/* From field-component.gts — per-format additions. Only the fitted rule
   sits in `@layer baseComponent` (so any unlayered parent rule beats it);
   the isolated, embedded, and atom rules are unlayered and win or lose on
   plain specificity. */
.field-component-card.isolated-format {
  height: 100%;
}
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
  display: contents;          /* no chrome at all — atom is the ONLY format that collapses */
}
.field-component-card.atom-format > :deep(*) {
  vertical-align: middle;     /* baseline default for inline children */
}
.compound-field.atom-format {
  display: inline;            /* compound (FieldDef) atoms get this wrapper instead */
}
```

**The five most common consequences:**

1. **Rounded corners on every embedded child** — the wrapper's `border-radius` is `var(--boxel-radius)`, which resolves to the theme's `--radius` and falls back to `0.625rem`. Brand-wide corners therefore belong on the Theme card: `--radius: 0` squares every wrapper and everything the child draws inside. The interact-mode hover/selection ring is a floating overlay that copies the CardContainer's computed `border-radius`, so **the visible corner must be the CardContainer's corner**. For a one-off deviation from the theme, set `border-radius` on the `class` you pass to the field — it lands on the CardContainer, and the ring follows. Never draw a competing corner elsewhere: not on the child's own root, and not on a parent frame around a wrapper that keeps a different radius. Both put the ring out of step with what the viewer sees.
2. **A 1px halo around the chrome** — `box-shadow: 0 0 0 1px var(--border)` when `--boundaries` is on (default). Drop it through the fields API: `@displayContainer={{false}}` turns `--boundaries` off in every format. (`hide-boundaries` is a host-internal class the host app uses on its own surfaces, not an API for cards.)
3. **Cream/white background** — `--background` defaults to `var(--boxel-light)`. If your parent's paper color differs, the embedded child looks pasted on.
4. **Images clipped at corners** — `overflow: hidden` is hardcoded. Hero images that should bleed past the corner get clipped.
5. **Atoms are inline-block with padding** — they sit as little chips, not as raw inline content. They get `vertical-align: middle`, which doesn't always align with surrounding prose baseline.

## Override layers — pick the lowest one that works

### Layer 0 — theme cascade (the cleanest)

If the linked card resolves a theme (`cardTheme`, which defaults to `cardInfo.theme` but a CardDef may compute) AND the theme sets the variables, the cascade carries values into the wrapper without `:deep()`:

| Token the theme sets | Effect on the wrapper |
|---|---|
| `--background` | wrapper background |
| `--foreground` | text color inside |
| `--border` | the 1px halo color (only visible if `--boundaries` is on) |
| `--radius` | the wrapper's own `border-radius`, and the `--boxel-radius` / `--boxel-border-radius-*` scale for everything inside the card. `--radius: 0` on a theme squares the container and its contents together; the interact-mode ring copies the CardContainer's radius, so it stays in sync (see consequence 1). |

Caveat: the cascade is not gated on the `--themed` marker class (nothing styles it; `@isThemed` is deprecated). What matters is whether a theme stylesheet is actually in scope for the linked card. If your performer / venue / listing instances resolve no theme, the wrapper falls back to the Boxel defaults and the parent's theme values do not reach it.

### Layer 1 — `:deep()` from the parent's `<style scoped>` (avoid for chrome)

`:deep()` pierces scoping so the parent's CSS can target descendant elements, and the CardContainer is `:global(.boxel-card-container)`, so it *can* be reached this way. That does not make it the right tool for chrome. Every piece of wrapper chrome has a supported route that does not fight the host or the Theme card:

| You want | Use | Not |
|---|---|---|
| Different surface color on every linked child | The Theme card's `--background` / `--foreground` (Layer 0) | `:deep(.boxel-card-container) { background-color: … }` |
| Different surface color on one linked child | `class='…'` on `<@fields.link />`, forwarded to its `CardContainer` (see "Style a linked card's chrome with a class") | `:deep()` on that card's wrapper |
| No 1px halo | `@displayContainer={{false}}` on the field or on `searchResultsComponent` (Layer 2) | `:deep(.boxel-card-container--boundaries) { box-shadow: none; }` |
| Images bleeding past the wrapper | Let the child's own format design the bleed inside its box; `overflow: hidden` on the wrapper is part of the contract | `:deep(.field-component-card.embedded-format) { overflow: visible; }` |
| Different corners | Brand-wide: the Theme card's `--radius` (Layer 0). One-off: `border-radius` on the `class` passed to the field — the CardContainer changes and the interact ring follows | `:deep(.boxel-card-container) { border-radius: … }`, a radius on the child's root, or a parent frame with a different corner around the wrapper |

Plural fields and atoms do not need `:deep()` either. A `class` on a one-tag plural render lands on the `.plural-field` wrapper, and the wrapper's own host layout rules are layered, so a plain scoped rule on that class restyles it; when you want no wrapper at all, iterate the field (`{{#each @fields.items as |Item|}}<Item class='…' />{{/each}}`) and the classed cards are your grid's children. Pass `class` on an atom field and its chip is a plain scoped selector (see "Plural fields" and "Atom alignment"). What is left for `:deep()` is DOM the host generates that you neither render nor can reach with a class — the body of an embedded MarkdownDef shell, or the per-item containers inside a one-tag plural render. Any token used there is a contract token — `--card`, `--border`, `--muted` — never a name the theme does not define.

### Layer 2 — `@displayContainer={{false}}` (kill the chrome entirely)

For atoms especially, often you want NO chrome — just the linked card's content inline, as if it were raw text. The arg is accepted in every format, but what it does differs:

```hbs
<@fields.headliner @format='atom' @displayContainer={{false}} />
```

- **Every format:** passes `@displayBoundaries={{false}}`, so the 1px halo goes, and stamps `display-container-false` on the wrapper.
- **Atom only:** the wrapper additionally renders as `display: contents` — the container disappears, only the children layout. **The class on the wrapper still exists** (`field-component-card atom-format display-container-false`) but it's transparent to layout.
- **Embedded / fitted:** the wrapper keeps its full box (background, radius, `overflow: hidden`); only the ring is dropped. Background and, if the design needs it, `border-radius` go on the class passed to the field; `overflow: hidden` stays.
- **Compound FieldDefs:** `false` removes the `.compound-field` wrapper entirely and renders the field's template bare.

The same arg exists on `@context.searchResultsComponent`: `<@context.searchResultsComponent @query={{this.query}} @displayContainer={{false}} as |results|>` removes the boundary ring from every yielded `entry.component`, and collapses atom-format rows to `display: contents` exactly as on a field, on the inert prerendered HTML and the hydrated live card alike. There is no per-entry switch — the flag is set once on the component.

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
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--border);
  border-radius: 0;        /* sharp corners — Row & Rail; the parent's own element, not the wrapper */
  background-color: transparent;
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
<div class="plural-field linksToMany-field <format>-effectiveFormat display-container-<true|false> [empty]">
  <div class="linksToMany-itemContainer">
    <div class="boxel-card-container field-component-card <format>-format linksToMany-item …">…</div>
  </div>
  <div class="linksToMany-itemContainer">…</div>
  …
</div>

<!-- containsMany (compound field with @format) -->
<div class="plural-field containsMany-field <format>-format">
  <div class="containsMany-item">
    <div class="compound-field <format>-format">…</div>          <!-- FieldDef item -->
    <!-- or, when the item is a card: -->
    <div class="boxel-card-container field-component-card …">…</div>
  </div>
  …
</div>
```

Note the differences: `linksToMany` has one `.linksToMany-itemContainer` per item, and `.linksToMany-item` is a class stamped on the card's own `.boxel-card-container` (it is not a separate element). Its format class uses the `-effectiveFormat` suffix, so `.linksToMany-field.embedded-format` never matches — write `.linksToMany-field.embedded-effectiveFormat`. `containsMany` uses the plain `-format` suffix and is shallower — just `.containsMany-item` per item, wrapping a `.compound-field` for FieldDef items. Both share the outer `.plural-field` class — that's the only class common to both shapes.

The host also ships layout rules on these wrappers that explain two frequent symptoms:

```css
/* links-to-many-component.gts */
.linksToMany-field:is(.fitted-effectiveFormat, .embedded-effectiveFormat, .edit-effectiveFormat)
  > .linksToMany-itemContainer + .linksToMany-itemContainer { margin-top: var(--boxel-sp); }
.linksToMany-field.fitted-effectiveFormat > .linksToMany-itemContainer { height: 65px; }
.linksToMany-field.atom-effectiveFormat.display-container-false { display: contents; }
.linksToMany-field.atom-effectiveFormat.display-container-true  { display: inline-flex; gap: var(--boxel-sp-sm); }

/* contains-many-component.gts */
.containsMany-field.embedded-format { display: grid; gap: var(--boxel-sp); word-break: break-word; }
```

So a fitted `linksToMany` list is a stack of 65px-tall boxes with `--boxel-sp` between them until you collapse the item containers. `@displayContainer={{false}}` on a `containsMany` emits no `.plural-field` wrapper at all (items render bare); on a `linksToMany` the wrapper stays, gets `display-container-false`, and collapses only in atom format.

### The fix — a class on the wrapper, or no wrapper at all

Two routes, neither needs `:deep()`.

**Keep the one-tag render and class the wrapper.** `...attributes` on `<@fields.replies @format='embedded' class='replies' />` lands on the `.plural-field` element, and the host's layout rules for that element (the containsMany grid, the linksToMany margins and 65px fitted rows) sit in an anonymous `@layer`, so `.replies { display: grid; gap: …; }` in your scoped style wins outright. This is enough when the wrapper is the grid you wanted and the per-item containers can stay (they become the grid's cells). What it cannot do is restyle those per-item containers — they are children of the wrapper, and a scoped rule on the wrapper's class does not reach them.

**Render the items yourself, so there is no wrapper.** Iterate the field: each yielded `Item` is an ordinary field component, so `class` on it lands on that card's own `CardContainer`, and your grid's direct children are the cards. Use this when the per-item containers get in the way — a fitted grid, anything with `:nth-child` staggering, or a layout that needs the cards themselves as cells.

```hbs
<div class='swm-swimmers'>
  {{#each @fields.topSwimmers as |Swimmer|}}
    <Swimmer @format='fitted' class='swm-tile' />
  {{/each}}
</div>
```

```css
.swm-swimmers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13.75rem, 1fr));
  grid-auto-rows: 10rem;   /* fitted fills the cell, so the grid sizes it */
  gap: var(--boxel-sp-sm);
}
.swm-tile {
  /* the card's CardContainer, inside your scope — no :deep() needed.
     Chrome only: never width/height (fitted's container queries need the host's 100%) */
  background-color: var(--card);
  color: var(--card-foreground);
}
```

No `.plural-field`, no `.linksToMany-itemContainer`, no 65px fitted rows, no `--boxel-sp` margins between items — none of that DOM is emitted. The same holds for a `containsMany` of a FieldDef: each `Item` renders its `.compound-field` directly.

Keep the bare one-tag render (`<@fields.topSwimmers @format='fitted' />`) when the host's default stacking is what you want, and the classed one-tag render when the wrapper itself is the grid. If you find yourself writing `:deep(> .plural-field) { display: contents; }` or `:deep(.linksToMany-itemContainer) { … }`, switch to the loop instead.

### First, check the nesting is real — the wrapper may be yours to delete

The collapse above is for wrappers **the host generates**, which you cannot remove. Before reaching for it, confirm the level you're flattening isn't a FieldDef *you* introduced. Two signals that it isn't real:

- The instance data shows a `containsMany` of wrapper fields that each hold exactly **one** item. That's not a group, it's indirection.
- You are reaching **across a scoped-style boundary** — writing a selector in the parent's `<style scoped>` that targets a class defined in a child FieldDef's own template. Scoped styles exist to prevent that; needing it means the split is in the wrong place.

In that case delete the wrapper FieldDef and point the parent's `containsMany` at the leaf field directly, migrating the instance JSON to match. A real example: a `linkStrip = containsMany(LinkGroupField)` where every `LinkGroupField` held one `LinkField` collapsed to `containsMany(LinkField)` — and that single change removed a `:deep(.containsMany-item) { display: contents }` rule, a `:deep(.compound-field.embedded-format)` rule, the wrapper's own flex block, and a cross-scope `gap` override, with no behavior change.

Also prefer `@displayContainer={{false}}` on the field render over hand-written `display: contents` when all you want is chrome removal, and don't add a wrapper `<div>` whose only job is to carry a margin — put the margin on the element that already exists.

Rule of thumb: `:deep()` is for host-generated DOM you neither render nor can address with a class, and chrome removal is `@displayContainer={{false}}` — never hand-written `display: contents`. A plural field's outer wrapper takes a class; its per-item containers do not, and you chose the one-tag render that produces them — loop instead of reaching in.

**Style a linked card's chrome with a class, not `:deep()`.** `...attributes` on `<@fields.someLinksTo />` is forwarded through the field component onto the linked card's own `CardContainer` (and onto the broken-link placeholder when the link fails). So `<@fields.headlineMeet @format='embedded' class='home-spotlight' />` puts `.home-spotlight` on the `.boxel-card-container` element itself, inside your `<style scoped>` scope, and a plain `.home-spotlight { background-color: var(--card); color: var(--card-foreground); }` replaces a `.wrapper > :deep(.boxel-card-container)` rule. Don't add a `border` there: an embedded linksTo render already paints a 1px `--border` ring through `box-shadow` (`@displayBoundaries` defaults to true), so a border doubles the edge. Pass `@displayContainer={{false}}` if you want to draw the edge yourself. The same `class` works on every `Item` yielded from `{{#each @fields.plural}}`, so a plural field never needs `:deep()` either.

### Staggered animations

With the loop render the cards are the grid's direct children, so `:nth-child` on the classed card is the DOM position you expect:

```css
.swm-stagger {
  --stagger-d: 0ms;   /* base value — items past the stagger cap animate immediately */
}
.swm-tile {
  opacity: 0;
  transform: translateY(0.75rem);
  animation: rise 600ms cubic-bezier(0.2, 0.7, 0, 1) forwards;
  animation-delay: var(--stagger-d);
}
.swm-tile:nth-child(1) { --stagger-d: 80ms; }
.swm-tile:nth-child(2) { --stagger-d: 160ms; }
/* …etc, or use :nth-child(n+8) to cap the cascade */
```

If the cards sit inside your own `<li>` wrappers, put the `:nth-child` on the `li` — `--stagger-d` is a custom property, so it inherits down to the card.

### Singular linksTo / contains is fine — no wrapper

`<@fields.featuredEvent @format='embedded' />` renders the `.field-component-card` directly, no plural wrapper. A `class` on that invocation lands on its `CardContainer`, so its chrome is styled with a plain scoped rule.

## Atom alignment — the dedicated pattern

Atoms default to `display: inline-block; vertical-align: middle; padding: var(--boxel-sp-4xs) var(--boxel-sp-xs)`. That makes them sit as floating chips. To align with surrounding text (baseline, not middle), or to layout-grid them into a parent's structure, pass a `class` on the atom field — it lands on the atom's own `CardContainer`, inside your scope:

```hbs
<@fields.headliner @format='atom' class='prg-bill-atom' />
```

```css
/* In the parent's <style scoped> — plain selectors, no :deep() */

/* Baseline-align with surrounding prose */
.prg-bill-atom {
  vertical-align: baseline;
}

/* In a grid cell, center vertically */
.prg-bill-row .prg-bill-atom {
  align-self: center;
}

```

The host's atom padding rule is unlayered and carries three classes, so a single-class rule like `.prg-bill-atom { padding: 0; }` loses to it on specificity. To drop the padding (raw text inside your own chip), do not fight that rule: pass `@displayContainer={{false}}` and there is no chip element at all — the text sits in your flow, and the host also stops setting `vertical-align: middle` on an inner child you cannot reach.

For a row of atoms (e.g. "01 Headlining: [Big Thief]"), the cleanest pattern is **`@displayContainer={{false}}`** + a parent-owned chip span. Then the parent decides everything (sharp corners, ink-on-paper background, baseline alignment) and the atom's actual content (the linked card's name) sits inside.

### Atoms on a custom surface — chip or plain text

The default atom render is a chip: `inline-block` with `padding`, the `.boxel-card-container` background/foreground pairing (`--background` / `--foreground`), and a `--boundaries` box-shadow ring. Inside the chrome, `DefaultAtomViewTemplate` renders the linked card's `cardTitle` as a `<span>`. Because the chip paints its own paired background and text color, it stays legible on any parent surface, including a dark one — it just looks like a chip in the theme's base colors rather than blending in.

With `@displayContainer={{false}}` the atom renders as `display: contents` and its text inherits `color` from the surface it sits on (`field-component.gts` sets `color: inherit` on that case), so plain-text atoms follow a dark header's foreground with no extra CSS.

**Two options, pick one:**

```hbs
{{!-- A) Strip the chrome entirely — atom renders as plain inline text in the parent's color --}}
<@fields.swimmer @format='atom' @displayContainer={{false}} />

{{!-- B) Keep the chrome but recolor it using a class --}}
<@fields.swimmer @format='atom' class='swimmer' />
```

```css
/* If you went with (B), inside the parent's scoped style: */
.swimmer {
  background-color: transparent;  /* drop the chip's base surface */
  box-shadow: none;               /* drop the boundaries ring */
  color: inherit;                 /* take the header's own foreground */
}
```

(A) is the right call inside running text or label/value rows where you don't want chip chrome at all. (B) is the right call when you DO want a visible chip — you just want it to match your surface instead of the theme's base pairing.

## Picking the divider strategy — parent draws OR child halo, never both

The second-most-common bug after "wrong format for the cell size" is the **double-rule trap**: the parent adds its own divider lines between cards (`border-bottom`, `border-right`, an outer `border` on a grid), and *also* leaves the host's default `.boxel-card-container--boundaries` `box-shadow: 0 0 0 1px var(--border)` in place. At every boundary, two lines render at slightly different weights or colors — the user sees this as a drop shadow fighting a thin border.

You always have to pick one of two strategies. There is no in-between.

### Strategy A — parent draws dividers (newspaper grid, list rows)

Turn the child halo off through the field API, square the wrapper through the field's class so its corner matches the straight rules, and draw the rules on elements the parent owns:

```hbs
<ul class='event-list'>
  {{#each @fields.events as |Event|}}
    <li><Event @format='embedded' @displayContainer={{false}} class='event-row' /></li>
  {{/each}}
</ul>
```

```css
.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);              /* parent owns the rules */
}
.event-list > li {
  border-bottom: 1px solid var(--border);           /* parent draws between */
}
.event-row {
  border-radius: 0;   /* the CardContainer's corner matches the square rules; the interact ring follows it */
}
```

Without `.event-row`, the wrapper keeps its 0.625rem corner inside square rules and the hover ring is rounded inside a straight-edged row.

Use for: vertical lists, editorial newspaper grids, table-style rosters, anywhere the design is "cards as data rows separated by hairlines."

### Strategy B — child halo is the boundary (gap-spaced tile grid)

```css
.event-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(17.5rem, 1fr));
  gap: 1rem;                                       /* gap is the breathing room */
}
/* The child halo is on by default — nothing to add. Its color is the theme's
   --border; recolor it on the Theme card, not here.
   DON'T add border-bottom / border-right on the cards — that's the double rule */
```

Use for: card-style tile grids, dashboards with floating "objects," anywhere each card should feel like a separate UI element with airspace around it.

### Decision

| What you want | Strategy |
|---|---|
| Rows touching, single 1px line between them | A — parent draws, `@displayContainer={{false}}` on the items |
| Tiles with gaps and their own visible boundary | B — default halo, no parent borders |
| Tiles with gaps and NO boundaries (cards on paper) | B — plus `@displayContainer={{false}}` on the items |
| Heavy outer frame + inner thin dividers | A — both outer border AND inner divider on parent, `@displayContainer={{false}}` on the items |

### Switching strategies mid-build

When you change a section from Strategy B (halo IS the boundary) to Strategy A (parent draws dividers), flip `@displayContainer={{false}}` on the item render AND add the parent's divider rules in the same edit. Going the other way, remove the arg AND delete every parent `border-*` rule for that section. Half a switch is the double-rule trap in a new outfit: halo on plus parent dividers, or halo off plus no dividers at all.

The same-selector rule still applies to whatever CSS the parent does own: same-specificity rules resolve by source order, so a stale `border-bottom` further down the file wins over the one you just changed. Delete the stale rule; don't add a second one.

Audit step before declaring a chrome change done: for each section, `@displayContainer` on the items and `border-*` rules on the parent must agree with the row in the Decision table above.

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
<ul class='event-list'>
  {{#each @fields.events as |Event|}}
    <li><Event @format='embedded' @displayContainer={{false}} /></li>
  {{/each}}
</ul>
```
```css
.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}
.event-list > li {
  border-bottom: 1px solid var(--border);  /* divider, not a forced height */
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
  grid-template-columns: repeat(auto-fill, minmax(16.25rem, 1fr));
  gap: 1.5rem;
}
```

If the parent owns the divider rules, pass `@displayContainer={{false}}` on the item render so the halo goes; the wrapper's background comes from the Theme card, a `border-radius` that must match the parent's rules goes on the item's class (see Strategy A), and `overflow: hidden` stays as the host sets it.

### Fitted — for compact card thumbnails in toolbars / pickers

```hbs
<@fields.featured @format='fitted' class='toolbar-thumb' />
```

```css
/* `class` is forwarded to the linked card's CardContainer, so this is a plain
   scoped rule — no :deep() */
.toolbar-thumb {
  background-color: var(--card);
  color: var(--card-foreground);
  /* DON'T set width/height — fitted needs the host's 100%/100% for its own container queries */
  /* border-radius is fine here if the design needs it — the interact ring copies the CardContainer's */
}
```

⚠️ **Don't override `width: 100%; height: 100%` on `.fitted-format`** — the child's container queries depend on those. Size the cell the card sits in, not the card.

### Isolated — when embedding a full card surface inside another (rare; e.g. dashboard preview)

```hbs
<div class='preview'>
  <@fields.dashboard @format='isolated' />
</div>
```

```css
.preview {
  height: 30rem;   /* isolated takes height: 100%, so the parent cell must have one */
}
```

### Atom — when inline with prose or in compact rows

Best practice: `@displayContainer={{false}}` + parent-owned chip span. See "Atom alignment" above.

## Cross-cutting concerns

### Don't break the child's container queries

Embedded cards declare `container-type: inline-size; container-name: embedded-card`. Fitted declares `container-type: size; container-name: fitted-card`. These are the child's basis for responsive layout. Overriding them from the parent (via `:deep`) breaks the child's design. Style the chrome (`border`, `background`, `box-shadow`, `padding`, `border-radius`) through the field's class, not the layout primitives.

### Theme tokens cascade INTO the parent's chrome rules

When you write `.home-spotlight { background-color: var(--card); }` for a class passed on the field, the `var(--card)` resolves in the PARENT'S scope. Themes set the token; the rule applies the token. The same holds for any `:deep()` block that genuinely remains (such as the MarkdownDef shell body). Use only contract tokens — never hex, and never a name outside the contract (`--paper`, `--ink`), which is undefined and paints nothing.

### Test the override after a theme change

If the parent's theme sets `--card` to a paper tone, and the chrome rule then hard-codes the same tone as a literal, you have two sources of truth. When the theme later changes `--card`, the rule still says the old color. Always read the token:

```css
.home-spotlight {
  background-color: var(--card);   /* the theme owns the value */
  color: var(--card-foreground);
}
```

### Embedded MarkdownDef — tune the preview with custom properties

`MarkdownDef` (`packages/base/markdown-file-def.gts`) no longer has bespoke formats. It inherits the four shared FileDef shells (`packages/base/file-formats/file-shell-*.gts`) and supplies only the renderer they mount, `MarkdownPreview` (`packages/base/file-formats/markdown-preview.gts`). The embedded shell gives the body a fixed `220px` height (adjusted per `data-embed-shape`) and clips it; there is no fade mask in embedded — the mask exists only on the fitted preview.

The renderer exposes three custom properties:

| Property | Default | What it controls |
|---|---|---|
| `--md-preview-background` | `var(--card)` | The preview surface |
| `--md-preview-foreground` | `var(--card-foreground)` | The text on it |
| `--md-preview-padding` | `var(--boxel-sp-lg)` | Inner padding of the rendered markdown |

Set them on **any ancestor of the embedded render** — they inherit across the embed boundary into the framework's markup:

```css
.doc-panel {
  --md-preview-background: var(--muted);
  --md-preview-foreground: var(--foreground);
  --md-preview-padding: var(--boxel-sp);
}
```

The shell's height is not a custom property; a different preview height needs a `:deep()` rule on the shell's body element (layout plumbing the shell does not expose, so this is one of the cases `:deep()` is for), and a card that needs a genuinely unbounded document should render it through the isolated format instead.

**Why custom properties are the mechanism.** This embedded render is framework-driven — the host, not your template, instantiates the shell and the renderer. Neither takes component args from you, because the embedding context never calls them; it only supplies the surrounding DOM. An **inherited custom property is the lever that crosses that boundary** — it rides the CSS cascade down into the framework's markup.

## Quick-reference cheat sheet

| Need | Tool |
|---|---|
| Vertical list of cards with natural row heights | `@format='embedded'`, NOT fitted |
| Uniform tile grid where every card fills a fixed box | `@format='fitted'` + parent sets `min-height` / `aspect-ratio` |
| Plural grid (linksToMany or containsMany) lays out correctly | `class='…'` on the one-tag render (lands on `.plural-field`, whose host rules are layered) when the wrapper can be the grid; otherwise `{{#each @fields.plural as \|Item\|}}<Item @format='…' class='tile' />{{/each}}` so the cards are the grid's children |
| Stagger per-item animation delays | `.tile:nth-child(N) { --stagger-d: … }` on the looped, classed cards; `animation-delay: var(--stagger-d)` on `.tile` |
| Square / re-round the embedded child's corners | Brand-wide: Theme card `--radius`. One-off: `border-radius` on the `class` passed to the field — the interact ring copies the CardContainer's radius. Never on the child's root or a parent frame |
| Override embedded child's `background` | Theme card `--background` / `--foreground` for all children; `class='…'` on `<@fields.link />` for one |
| Kill the 1px halo | `<@fields.X @format='…' @displayContainer={{false}} />` (works in every format, and on `searchResultsComponent`) |
| Let images bleed past corners | Don't — `overflow: hidden` on the wrapper is part of the contract; design the bleed inside the child's box |
| Kill chrome entirely (atom) | `<@fields.X @format='atom' @displayContainer={{false}} />` |
| Recolor / re-pad an embedded MarkdownDef preview | set `--md-preview-background`, `--md-preview-foreground`, `--md-preview-padding` on an ancestor |
| Atom chip matches a custom (e.g. dark) surface | `@displayContainer={{false}}` (text inherits the surface color), OR `class='chip'` on the atom field + `.chip { background-color: transparent; box-shadow: none; color: inherit; }` |
| Atom baseline-align with prose | `class='…'` on the atom field + `vertical-align: baseline` on that class |
| Atom padding match parent's chip | `@displayContainer={{false}}` — the host's three-class padding rule is unlayered and beats a one-class override |
| Atom still misaligned after that | `@displayContainer={{false}}` — no chip element, text sits in your flow |

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
    padding: 48px;                /* OK — inner concern */
    display: grid;                /* OK — inner layout */
    gap: 32px;                    /* OK — inner concern */
    /* NO border-radius, NO border, NO box-shadow, NO opaque background */
  }
</style>
```

### Per format — what's safe and what isn't on the outermost element

`CardContainer` — which wraps every card render, not just field embeds — already applies the theme's `background-color`, `color`, and the whole body type role on its root: `font-family` (`--boxel-body-font-family`, which resolves through the theme's body slot to `--font-sans` and finally the Boxel sans stack), `font-size`, `font-weight`, `line-height`, and `letter-spacing`; templates inherit all of them for free. Don't declare any of these on the root unless you're deviating: `font-family` only when the whole card should use something other than `--font-sans` (such as `--font-serif`); `background-color`/`color` only when a pairing other than the theme's main background/foreground is preferred. `fitted` and `embedded` card templates MAY make that switch (e.g. `background-color: var(--card); color: var(--card-foreground)`); `isolated` and CardDef `edit` templates keep the theme's pair.

| Format | OK on outermost | NOT OK on outermost (host/parent owns) |
|---|---|---|
| `isolated` | `height: 100%; overflow-y: auto` (the root fills the fixed-height container and scrolls; `min-height` does not — the container clips), inner padding, inner grid/flex layout | `border-radius`, `border`, `box-shadow`, `overflow: hidden`, `min-height` in place of `height: 100%`, background/foreground overrides (use the theme's) |
| `embedded` | same as isolated — plus MAY use a different background/foreground pairing from the theme (e.g. `--card` + `--card-foreground`) | `border-radius`, `border`, `box-shadow`, `overflow`, `width`/`height`/`max-width` |
| `fitted` | a background/foreground pairing different from the theme's (e.g. `--card` + `--card-foreground`), inner padding, inner grid template, inner gap | `border-radius`, `border`, `box-shadow`, `width`, `height`, `min-height`, `max-height`, `container-type`, `container-name` (the host sets these) |
| `atom` | inline content only (text node, small inline icon) | `padding` (host provides), `border`, `border-radius`, `background`, any `display` other than inline-by-default |
| `edit` | form field spacing, internal stack/grid layout | outer chrome same as isolated (keep the theme's background/foreground) |

**Compound-field templates are the exception to the edit/embedded rows:** a FieldDef's `embedded` and `edit` templates render nested *inside* a card surface, so they may choose a different background/foreground combo to distinguish themselves from the surrounding card — `--card` + `--card-foreground` is the usual choice.

### When your design genuinely demands a specific outer treatment

Put it on the **Theme card**, not the child's format CSS. The CardContainer reads `--background`, `--foreground`, and `--border` straight from the theme and applies them at the wrapper. Every card linked to that theme inherits that outer treatment without competing with the host.

Row & Rail's editorial paper-and-ink aesthetic, for example (a `StructuredTheme`'s `rootVariables`):

```
  background: <brand paper>     /* ← wrapper background */
  border: <brand ink>           /* ← halo when --boundaries on */
  radius: 0                     /* ← wrapper corner AND the inner --boxel-border-radius-* scale */
```

Every card linked to that theme renders with paper background, ink halo, and square corners, automatically: the wrapper's `border-radius` reads `--radius`, and the same value drives the `--boxel-border-radius-*` scale the child uses inside. The interact ring copies the CardContainer's radius, so it goes square too. A parent that needs one linked card to deviate puts `border-radius` on the class it passes to the field. What never works is a corner drawn anywhere else — the child's root or a parent frame — because the ring keeps tracing the wrapper.

### Why this matters — the failure mode

When the parent (e.g., the Programme showcase) embeds your card:

- **Contract honored:** the Theme card's tokens, or a class passed on the field (`.home-spotlight { background-color: var(--card); color: var(--card-foreground); }`), recolor the wrapper cleanly. The theme's card surface and foreground, no double-borders.
- **Contract violated:** child's own `border-radius: 12px` on `.news-isolated` paints a corner the wrapper clips at 0.625rem, and the interact ring traces the wrapper, so the card and its ring disagree. Same failure from the parent side: square rules on an `li` around a wrapper left at its default radius. Or child's `box-shadow` stacks under the halo creating a double-border. Or child's `background: white` blocks the parent's `--card` cascade — embedded child looks pasted on instead of integrated.

The single most common symptom in agent-generated cards is rounded-corner embedded children inside a sharp-corner parent. Cause: every child added `border-radius: 8px` to its outer because "cards have rounded corners." Fix: strip the outer decoration; trust the wrapper.

### Self-check before declaring a format done

Before any `static isolated|embedded|fitted|atom|edit = class { ... }` is considered complete:

1. Does the outermost element have `border-radius`, `border`, or `box-shadow`? If yes — move that decision to the Theme card, or remove it. For `isolated` and CardDef `edit`, also don't override the theme's background/foreground; `fitted` and `embedded` may use a different pairing (e.g. `--card` + `--card-foreground`).
2. For `fitted`: does the outermost element set `width`, `height`, `min/max-height`, `container-type`, or `container-name`? If yes — remove. The host sets these on `.field-component-card.fitted-format`. (`background-color` paired with `color` is fine on a fitted root — boxel-ui's `FittedCard` sets both.)
3. For `atom`: is the outermost element doing anything more than inline text + maybe one inline icon? If yes — restructure. Atoms are inline content, not chips. (Chips are the parent's job; see `@displayContainer={{false}}` recipes.)
4. Open the card both standalone (in the stack) and embedded inside another card. Does it look right in BOTH contexts? If only one, the child is decorating the outer.

Stage 4 of the design playbook (deriving fitted + embedded from the established visual language) lives inside this contract: design the content; trust the wrapper.

## Source files (verify before depending on details)

All paths are relative to the Boxel monorepo root.

- `packages/boxel-ui/src/components/card-container/index.gts` — CardContainer, the global selectors, the `--boxel-*` scales derived from theme knobs, the `@layer reset` typography
- `packages/base/field-component.gts` — per-format classes, `@displayContainer` / `@displayBoundaries`, the `@layer baseComponent` format rules
- `packages/base/links-to-many-component.gts` and `packages/base/contains-many-component.gts` — the plural wrappers and their layout rules
- `packages/base/file-formats/file-shell-embedded.gts` and `packages/base/file-formats/markdown-preview.gts` — the embedded MarkdownDef shell and renderer
- `packages/experiments-realm/crm/contact.gts` — examples of `@displayContainer={{false}}` for atom
- `packages/experiments-realm/sprint-task.gts` — atom with `@displayContainer={{false}}` plus a custom class that resets the container's width/height/overflow
