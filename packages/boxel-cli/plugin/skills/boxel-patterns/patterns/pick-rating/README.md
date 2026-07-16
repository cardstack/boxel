---
validated: source-proven
---

# pick-rating — Editable star rating FieldDef

**What this gives you:** A reusable rating field with full/half/empty star display, editable button stars, review counts, and a compact atom format.

**When to use:** Product reviews, book ratings, satisfaction scores, recommendation strength, priority/difficulty ratings, or any 1-5 score that needs a familiar visual affordance.

**The insight:** The star UI is a FieldDef, not just a component. Read formats can show fractional values with half-stars, while edit mode writes a new field value through Boxel's `@set` callback. This keeps the score persistable and embeddable anywhere a field can render.

**Recipe shape:**

```ts
export class RatingsSummary extends FieldDef {
  @field average = contains(NumberField);
  @field count = contains(NumberField);
  @field isEditable = contains(BooleanField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <StarRating @value={{@model.average}} @isEditable={{@model.isEditable}} @set={{@set}} />
    </template>
  };
}
```

**Gotchas:**
- Use Boxel icon components (`Star`, `StarHalfFill`, `StarFilled`) instead of hand-drawn SVG.
- The half-star logic belongs in a getter that returns `{ rating, type }[]`; templates should only iterate.
- Edit clicks usually set full integer values. Preserve fractional averages for aggregate read displays.
- When changing a nested FieldDef, call `@set` with a new `RatingsSummary(...)` instance. Mutating `@model.average` directly does not teach the host what changed.

**Source:** `app.boxel.ai/dmartinez21/personal/ratings-summary.gts:52-230`, `BSL-STUDY.md:1522-1526`.

**See also:** `organize-variant-field-dispatcher`, `pick-typed-sort`.
