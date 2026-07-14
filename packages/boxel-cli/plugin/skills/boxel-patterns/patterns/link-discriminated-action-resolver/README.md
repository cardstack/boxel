---
validated: source-proven
---

# link-discriminated-action-resolver — Typed action menu per CardDef subtype

**What this gives you:** A function that takes a card + context and returns a tagged-union object whose shape depends on the card's subtype. Consumers can `if (actions.type === 'skill')` and TypeScript narrows to exactly the actions that skill cards support — no optional chaining, no "does this card have an `installSkill` method" check.

**When to use:** A family of CardDef subtypes (here: `Listing` → `AppListing`, `CardListing`, `SkillListing`, `ThemeListing`) each support a _different_ set of actions. You want one place that knows the mapping, and consumers (menus, action buttons) get type-safe access to only the valid actions.

**The insight:** Instead of every menu component poking at optional methods, the resolver centralizes the dispatch. The output is a _discriminated union_, so TS knows `actions.type === 'skill'` implies `actions.installSkill` exists. Use conditional spread inside the resolver — `...(card instanceof SkillListing ? { installSkill: ... } : {})` — so only the valid keys exist on the returned object.

**Recipe shape:**

1. Define one TS interface per subtype: `SkillActions`, `AppActions`, etc., each with `type: '<name>'` and the action functions.
2. Define the union: `type ListingActions = SkillActions | AppActions | …`.
3. **Newer (catalog-current):** Implement each subtype's actions in an adapter class — `BaseListingAdapter`, `SkillListingAdapter`, etc. — instead of inlining them in the resolver.
4. Write `resolveListingActions(card, context): ListingActions` that:
   - Detects subtype (via `card.constructor?.name` or `instanceof`)
   - Builds the matching adapter
   - **Conditional-spreads** the optional actions so they're only present when relevant: `...(hasExamples && { preview: () => adapter.preview(card) })`
5. Wrap in `resource()` if you want it reactive to card changes (see `resources/listing-actions.gts` for the resource wrapper).

**Gotchas:**

- The literal `type` field is what makes the union discriminated. Don't omit it, don't compute it.
- Adapter classes give you a clean place for shared methods (`view`, `preview`) and subtype-specific ones (`addSkillsToRoom`).
- Conditional spread (`...(condition && { key: value })`) makes optional keys _truly optional_ on the returned object — `if (actions.preview)` works the way you'd hope.
- If you wrap in `resource()`, remember the resolver result is `undefined` until first run — narrow that out first.

**Source:** `boxel-catalog/catalog-app/resources/helpers/listing-action-resolver.gts:130-300` (the current adapter-based form), `boxel-catalog/catalog-app/resources/listing-actions.gts:27-45` (the resource wrapper).

**See also:** `organize-resource-class-data-loader` (for the reactive resource pattern).
