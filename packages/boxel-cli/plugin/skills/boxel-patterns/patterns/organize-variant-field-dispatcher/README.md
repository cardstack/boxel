---
validated: source-proven
---

# organize-variant-field-dispatcher — FieldDef that swaps edit components by `configuration.variant`

**What this gives you:** A thin top-level FieldDef whose only job is to dispatch to one of several edit components based on a `configuration.variant` value. The user picks an input style (slider vs dropdown vs picker) without you forking the field type.

**When to use:** A single semantic field (color, rating, geo-point, image) has multiple legitimate input affordances. Instead of `RatingFieldStars`, `RatingFieldDots`, `RatingFieldNumber` as three separate types, one `RatingField` accepts `variant: 'stars' | 'dots' | 'number'` and renders accordingly.

**The insight:** The wrapper FieldDef itself stays tiny (often 8-30 lines). The variants live as sibling component files in `<field>/components/`, and the dispatch is just a `case`-style render. This keeps the _data_ (what is stored) decoupled from the _presentation_ (how it's edited), which is the core Boxel separation done well.

**Recipe shape:**

1. Wrapper field extends `StringField` (or whichever base type holds the data).
2. `@field configuration = contains(VariantConfigField)` — typed config object.
3. Each variant is its own Glimmer component in a `components/` sibling folder.
4. The wrapper's `edit` (and sometimes `embedded`) reads `configuration.variant` and renders the matching component.

**Gotchas:**

- Keep the data type the same across all variants — a "color" should always serialize to a hex string, no matter which picker drew it.
- Default to a sensible variant when configuration is missing (e.g. `variant ?? 'picker'`).
- Don't put variant-specific logic in the wrapper — move it to the variant component.

**Source:** catalog-realm `fields/color.gts:1-33` (wrapper), `fields/color-field/components/*` (variant pickers). Same pattern in `geo-point.gts`, `image.gts`, `rating.gts`.

**See also:** `organize-field-co-location`, `organize-atomic-field-factory` (for the simpler enum case without per-variant components).
