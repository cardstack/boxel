---
validated: source-proven
---

# link-view-transition — `document.startViewTransition` for free morph animations

**What this gives you:** Smooth automatic morph animations between two DOM states — reordering a list, adding/removing items, navigating between formats, expanding a thumbnail to full screen — using one browser primitive instead of hand-rolled FLIP, GSAP, or framer-motion.

**When to use:** Any time a `@tracked` change rearranges the DOM and you'd otherwise reach for `requestAnimationFrame` + FLIP math. Card adds/removes from a grid, slide transitions, format flips (isolated ↔ edit), drawer open/close, list reorders. Especially good when matching elements exist on both sides of the change (the headline before and after, the hero image before and after).

**The insight:** `document.startViewTransition(() => mutate())` tells the browser to snapshot the old DOM, run your callback synchronously, snapshot the new DOM, then crossfade between them. Add `view-transition-name: <unique>` to elements that should _morph_ (rather than crossfade) — the same name on the before-and-after element makes the browser interpolate position, size, opacity, and clipping between them. No animation code at all in the common case.

## Recipe shape

```ts
// In the Component<typeof MyCard>:
@action shuffle() {
  const next = /* new order */;
  if (typeof document.startViewTransition === 'function') {
    document.startViewTransition(() => { this.order = next; });
  } else {
    this.order = next;  // graceful fallback
  }
}
```

```handlebars
{{#each this.order as |i|}}
  {{#let (get @model.items i) as |card|}}
    <div class='cell' style='view-transition-name: gallery-{{card.id}}'>
      ...
    </div>
  {{/let}}
{{/each}}
```

```css
/* Per-element keyframes override the default crossfade. */
::view-transition-group(gallery-grid) {
  animation-duration: 0.45s;
}
```

## API surface

| Surface                                                           | Purpose                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `document.startViewTransition(updateCallback)`                    | Wraps the DOM mutation. Returns a `ViewTransition`.                                                                                   |
| `transition.ready`                                                | Resolves once the browser has snapshotted both sides — use to start companion animations (e.g. ARIA announcements).                   |
| `transition.finished`                                             | Resolves when the crossfade completes.                                                                                                |
| `view-transition-name: <name>` (CSS)                              | Tags an element so the browser tracks it across snapshots. Names **must be unique per snapshot** — duplicates fall back to crossfade. |
| `::view-transition-old(<name>)` / `::view-transition-new(<name>)` | Pseudo-elements you can target with custom keyframes to override the default crossfade per element.                                   |

## Feature detection

`if (typeof document.startViewTransition === 'function') { ... } else { runMutation(); }`. Safari rolled support out late and some older browsers still lack it — always feature-detect.

## Gotchas

- **Name collisions.** Two elements with the same `view-transition-name` in the same snapshot fall back to a crossfade silently. Use unique names — interpolate a stable id (card.id, not array index) into the value: `view-transition-name: card-{{card.id}}`.
- **`startViewTransition` is one-shot.** Don't `await transition.finished` if you'll fire another transition before it resolves — the browser cancels overlapping transitions.
- **Layout shift during snapshot.** The callback runs synchronously between the two snapshots; if your mutation triggers async data fetches, the browser snapshots the _placeholder_ state, not the final one. Resolve data first, then call `startViewTransition`.
- **SSR / prerender.** `document.startViewTransition` isn't present outside a browser context. Feature-detect protects you here too.

## Source

- `realms-staging.stack.cards/aallen90/hilarious-marmoset/placeholders/simple-grid.gts` — `@action shuffle()` and `@action toggleDensity()` wrap mutations in `document.startViewTransition`; cells carry `view-transition-name: card-{{index}}` and the grid wrapper uses `view-transition-name: grid-wrapper`.

## See also

- `format-morph-shared-component` — shared component across formats (different mechanism, similar morph outcome).
- `boxel-ui-guidelines/references/template-patterns.md` — entrance animation guidance.
- MDN: [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API).
