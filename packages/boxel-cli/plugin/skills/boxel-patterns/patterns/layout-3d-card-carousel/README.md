---
validated: source-proven
---

# layout-3d-card-carousel — Cards on a virtual cylinder via `@context.searchResultsComponent` + CSS perspective

**What this gives you:** A query-driven 3D carousel where each result from `@context.searchResultsComponent` is positioned on a virtual cylinder around the viewer. Auto-rotate, hover lift, click-to-focus, filter-state reactive — all CSS-and-tracked-state, no library.

**When to use:**
- Trading-card collections, product showcases, portfolio reels — anywhere a flat grid feels too utilitarian and a 3D arrangement adds drama.
- Hero / landing sections of an app card where the user sees a "wow" first.
- Catalog browsers — combine with filter state for a live 3D shelf that reacts to selections.

Pick a flat grid (`CardsGrid`, `searchResultsComponent` with `display: grid`) when speed of scanning matters more than impact. The 3D carousel is for the *hero* spot.

**The insight:** The placement math is trivial. For `n` cards at index `i`, the angle is `(i / n) × 360deg`. Each slot gets `--card-index` and `--total-cards` as CSS variables; the slot's transform reads them and computes:

```css
transform:
  rotateY(var(--angle))      /* spin onto the circle */
  translateZ(var(--radius))   /* push outward */
  rotateY(calc(var(--angle) * -1));  /* counter-rotate so face looks at camera */
```

Where `--angle: calc((360deg / var(--total-cards)) * var(--card-index))`. The container has `transform-style: preserve-3d` and a `perspective` so the camera sees depth. Rotate the cylinder element to spin the whole carousel; rotate the stage's `perspective-origin` to tilt the camera.

The query side: `@context.searchResultsComponent` feeds results into the carousel — search-entry queries are live by default, so the carousel tracks realm changes without any liveness flag. Add filter state (`@tracked selectedTeam`, etc.) that rebuilds the `query` getter, and the carousel rebuilds with new cards.

## Recipe shape

```ts
import {
  searchEntryWireQueryFromQuery,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

get query() {
  return {
    filter: { type: codeRef(import.meta.url, './trading-card', 'TradingCard') },
    sort: [{ by: 'cardURL', direction: 'asc' as const }],
  };
}

get realms() {
  const r = this.args.model[realmURL];
  return r ? [String(r)] : [];
}

get searchQuery(): SearchEntryWireQuery {
  const q = searchEntryWireQueryFromQuery(this.query);
  return {
    ...q,
    realms: this.realms,
    filter: {
      ...q.filter,
      eq: { ...q.filter?.eq, htmlQuery: { eq: { format: 'fitted' } } },
    },
  };
}
```

```handlebars
<div class='stage'>
  <div class='cylinder {{if this.isRotating "spinning"}}'>
    {{! @overlays={{false}}: the carousel does its own layout, so it wants
        plain rendering with no operator-mode overlay over the 3D transforms. }}
    <@context.searchResultsComponent @query={{this.searchQuery}} @mode='hover'
                                     @overlays={{false}} as |results|>
      {{#each results.entries key='id' as |entry index|}}
        <div class='slot'
             style='--card-index: {{index}}; --total-cards: {{results.entries.length}}'>
          <entry.component />
        </div>
      {{/each}}
    </@context.searchResultsComponent>
  </div>
</div>
```

```css
.stage { perspective: 1200px; perspective-origin: 50% 45%; }
.cylinder { transform-style: preserve-3d; position: absolute; inset: 0; }
.cylinder.spinning { animation: spin 20s linear infinite; }
.slot {
  position: absolute;
  --angle: calc((360deg / var(--total-cards)) * var(--card-index));
  --radius: max(300px, calc(var(--total-cards) * 30px));
  transform:
    rotateY(var(--angle))
    translateZ(var(--radius))
    rotateY(calc(var(--angle) * -1));
}
@keyframes spin { to { transform: rotateY(360deg); } }
```

## Query setup

- Use `filter: { type: codeRef(here, './card', 'CardName') }` — **not** `filter: { on: codeRef(...) }`. `on` is for scoping predicates like `eq`/`contains`/`range`; using it alone returns zero rows. See `boxel/references/query-systems.md`.
- For a sorted carousel, custom sort fields require `on: ref` in the sort expression: `sort: [{ by: 'name', on: codeRef(here, './card', 'CardName'), direction: 'asc' }]`.
- Import `realmURL` as a Symbol from `@cardstack/runtime-common`. Don't write `Symbol.for('realmURL')` — different Symbol, silent zero-rows.
- Liveness is automatic. Search-entry queries re-fetch on every realm change; there's no flag to opt out. If you need snapshot semantics, freeze the yielded entries yourself.

## Camera controls

| Control | CSS hook | UX |
|---|---|---|
| **Auto-rotate** | `.cylinder.spinning { animation: spin ... infinite }` | Toggle button. Pauses on hover for accessibility. |
| **Camera tilt** | `perspective-origin: 50% var(--camera-tilt)` | Slider 30%–70%. |
| **Zoom (perspective depth)** | `perspective: var(--perspective)` | Slider 800px–2000px. Smaller = closer = more dramatic. |
| **Focus a card** | Set `--carousel-angle` to `-((card-index / total) * 360deg)` | Click any card to center it. |

## Gotchas

- **`transform-style: preserve-3d` does NOT inherit.** Every layer between `.stage` and `.slot` must declare it, or children flatten to 2D.
- **`overflow: hidden` on intermediate `preserve-3d` layers can flatten the 3D context.** Put any clipping on the `.stage` (perspective element) or a sibling — not a middle layer.
- **Liveness is automatic.** Search-entry queries re-fetch on every realm change; there's no flag to disable it.
- **Per-card vars on the wrong element.** `--card-index` must be on the *slot* (the element the transform targets), not the inner card. If the rendered card has chrome wrapping it, the var rides on the slot wrapper outside the chrome.
- **Card chrome breaks immersion.** Entries rendered through `@context.searchResultsComponent` can carry operator-mode overlays plus `CardContainer` chrome (rounded corners, halo). Pass `@overlays={{false}}` to drop the overlay — this pattern arranges results in a fully custom layout, so it wants plain rendering. For a clean carousel look, also use `@displayContainer={{false}}` per-card OR style the chrome via `:deep(.boxel-card-container)` from scoped CSS. See `boxel-ui-guidelines/references/delegated-render-control.md`.
- **iOS Safari + many transformed siblings = jank.** Test on real iOS hardware. Use `will-change: transform` on slots; below ~20 cards is generally smooth, above starts dropping frames on older hardware.

## Source

- `realms-staging.stack.cards/awalker34/citrine-glen/3d-trading-card-board.gts` — full implementation. Query builder at lines 39–115, carousel markup at lines 349–421, circular placement formula at lines 762–778.

## See also

- `boxel/references/query-systems.md` — the query traps that silently return zero rows.
- `boxel-ui-guidelines/references/delegated-render-control.md` — chrome on children + `@displayContainer={{false}}`.
- `show-card-list-with-views` — flat-grid alternative when you don't need the 3D effect.
