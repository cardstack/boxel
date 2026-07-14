---
validated: source-proven
---

# cardinfo-override-title — Override cardTitle to respect user input then fall back to a primary field

**What this gives you:** A CardDef where `@model.cardTitle` (the property every UI reads — card grids, browse views, the inspector) is computed from a primary field by default, **but still respects** any name the user explicitly typed into `cardInfo.name`. The fallback order matches what the catalog uses in production.

**When to use:** Every CardDef that has a natural primary identifier field — `headline`, `firstName + lastName`, `productName`, `slug`, `email`, etc. Without this override, your card shows up as "Untitled Project" everywhere until the user happens to set `cardInfo.name`, which they usually don't.

**The insight:** The base CardDef computes `cardTitle` from `cardInfo.name`, falling back to `Untitled <DisplayName>`. That's fine for cards where the user _will_ explicitly name each instance — but for cards driven by data (a blog post identified by its headline, a person identified by name fields), you want the data to be the title. **Don't lose the user's ability to override though** — they may have typed a custom name in `cardInfo.name` deliberately, and your override should honor that.

The canonical order is:

1. Respect `cardInfo.name` if non-empty.
2. Else use the primary field.
3. Else `Untitled <DisplayName>`.

**Recipe shape:**

```gts
@field cardTitle = contains(StringField, {
  computeVia: function (this: <YourCardClass>) {
    return this.cardInfo?.name?.trim()?.length
      ? this.cardInfo.name
      : (this.<primaryField> ?? `Untitled ${this.constructor.displayName}`);
  },
});
```

For multi-field composition:

```gts
@field cardTitle = contains(StringField, {
  computeVia: function (this: Person) {
    if (this.cardInfo?.name?.trim()?.length) return this.cardInfo.name;
    let parts = [this.firstName, this.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : `Untitled ${this.constructor.displayName}`;
  },
});
```

**Sister overrides for `cardDescription`:**

```gts
@field cardDescription = contains(StringField, {
  computeVia: function (this: Recipe) {
    if (this.cardInfo?.summary?.trim()?.length) return this.cardInfo.summary;
    return `${this.totalTime} · ${this.servings} servings`;
  },
});
```

**Gotchas:**

- **Don't omit the `cardInfo.name` check.** Catalog cards `WineBottle` and `WineCellar` do `this.cardInfo?.name ?? this.displayName` — that loses the primary-field fallback. The fuller pattern (cardInfo → primary → default) is the recommended default.
- **Optional chaining matters.** `this.cardInfo?.name?.trim()?.length` is right; `this.cardInfo.name.length` will throw when `cardInfo.name` is null.
- **Use `this.constructor.displayName`**, not a hard-coded string — the `displayName` is set on the class and benefits from subclass overrides.
- **Don't reference computed fields in the computation.** Reading `this.cardTitle` (your own override) from within the compute creates a circular dependency. Use the raw fields (`this.headline`, etc.) directly.
- **You can override `cardDescription`, `cardThumbnailURL`, and `cardTheme` the same way.** The base class only provides default pass-throughs.
- **For singleton-ish cards** where the title is conceptually fixed (`Blackjack`, `WeeklyDigest`), a static return is fine: `computeVia: function () { return 'Blackjack'; }`. But this is the exception.

**Source:** `boxel-catalog/blog-app/blog-post.gts` (primary-field-first form), `boxel-catalog/4b6602-wine-cellar-card-definition/wine-bottle.gts` (cardInfo-first form), `boxel-catalog/673fb6-blackjack-cardgame-definition/blackjack.gts` (static form). The base definition is `packages/base/card-api.gts:2905`.

**See also:** `theme-first-workflow` (the companion theme pattern for new cards), `boxel/references/core-concept.md` (the full CardInfo + computed pass-through reference), `boxel/references/core-patterns.md`.
