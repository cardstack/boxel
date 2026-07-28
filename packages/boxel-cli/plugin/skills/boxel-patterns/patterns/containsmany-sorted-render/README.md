---
validated: source-proven
---

# containsmany-sorted-render — Render a `containsMany` field in a different order

> ⚠️ **Status — fitted block pre-dates the CQ-mandatory rule.** The `static fitted` template in `example.gts` hand-rolls layout instead of the single-root `.fit` container-query pattern (querying the host's `fitted-card` container). The pattern's *core mechanics* (sorting + `@fields.notes.[i]` index-bridge, edit + isolated formats) are correct and source-proven; treat the fitted slot as a placeholder and rewrite per [`boxel/references/container-query-fitted-layout.md`](../../../boxel/references/container-query-fitted-layout.md) before relying on it. (P2 in the skill-tree review.)

**What this gives you:** A way to render a `containsMany(SomeFieldDef)` array sorted (or filtered) without losing the host's per-item edit behavior. The trick is the `@fields.notes.[i]` *index-bridge*: sort indices in component land, but delegate actual rendering back through `@fields` so the Boxel host wires up edit-mode, validation, and templates for you.

**When to use:** A Contact card with `containsMany(Note)` notes and you want newest-first. A Recipe with ingredients sorted by category. A Project with tasks sorted by priority. Any time you need a non-insertion-order display of a `containsMany`/`linksToMany` and you don't want to give up the host's rendering chrome.

**The insight:** `@fields.notes` is a special accessor that wraps each value with its field component. You can index into it with `@fields.notes.[i]` from a template. Sort an array of indexes (cheap and stable) in a component getter, then drive an `{{#each}}` with the indexes — passing each one back to `@fields.notes.[i]`. Rendering goes through the field machinery as if you'd never reordered.

**Recipe shape:**

```gts
// In the Component<typeof Contact>
get sortedNoteIndexes(): number[] {
  const notes = this.args.model.notes ?? [];
  return notes
    .map((_, i) => i)
    .sort((a, b) => {
      const da = new Date(notes[b].createdAt).getTime();
      const db = new Date(notes[a].createdAt).getTime();
      return da - db; // newest first
    });
}

// Template
<section class='notes'>
  {{#each this.sortedNoteIndexes as |i|}}
    <@fields.notes.[i] @format='embedded' />
  {{/each}}
</section>
```

**Why not just sort the array and `{{#each}}` over it?**

If you do `{{#each (sortedCopy @model.notes) as |note|}}<NoteComponent @note={{note}} />{{/each}}`, you lose:
- Edit-mode rendering for the field (the host's per-field edit component).
- Validation chrome.
- The semantic link between the rendered element and its position in the field, which the host uses for diff/save.

Going through `@fields.notes.[i]` preserves all of that.

**Variants:**

- **Filtered display:** Same trick — filter the indexes, then iterate.
  ```ts
  get unresolvedNoteIndexes() {
    return (this.args.model.notes ?? [])
      .map((n, i) => (n.resolved ? -1 : i))
      .filter(i => i >= 0);
  }
  ```
- **Group-and-render:** Multiple `<each>` loops in different sections, each driven by its own sorted-index getter.
- **`linksToMany`:** The same `@fields.cards.[i]` bridge works for linksToMany fields too.

**Gotchas:**

- The order is computational, not stored. Saving the card persists insertion order; the sort is purely a render concern.
- Don't try to call this from inside `computeVia` (template helpers don't work there — see `boxel/references/core-concept.md` "Computed field hard limits").
- If you need persisted sort order, add a `position: number` field on each item and sort by it (insertion order is then explicit).

**Source:** Originally distilled from a CRM contact card's notes-timeline (newest-first). Ask the user for the current URL if you want to read the original.

**See also:** `cardinfo-override-title`, `pick-typed-sort` (sorting at the query layer instead of in-component).
