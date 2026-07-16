## Foundational Concepts

### The Boxel Universe

Boxel is a composable card-based system where information lives in self-contained, reusable units. Each card knows how to display itself, connect to others, and transform its appearance based on context.

- **Card:** The central unit of information and display
  - **Definition (`CardDef` in `.gts`):** Defines the structure (fields) and presentation (templates) of a card type
  - **Instance (`.json`):** Represents specific data conforming to a Card Definition

- **Field:** Building blocks within a Card
  - **Base Types:** System-provided fields (StringField, NumberField, etc.)
  - **Custom Fields (`FieldDef`):** Reusable composite field types you define

- **File (`FileDef` in `.gts`):** A card-like way of interacting with images, documents, and other assets stored in the realm
  - **Instances:** Actual files (`.png`, `.md`, `.csv`, etc.) indexed automatically with metadata extracted
  - **Subtypes:** `ImageDef`, `PngDef`, `MarkdownDef`, `CsvFileDef`, and others for specific formats
  - **Referenced with `linksTo`**, never `contains` — FileDef instances have their own identity like cards

- **Realm/Workspace:** Your project's root directory. All imports and paths are relative to this context

- **Formats:** Different visual representations of the same card:
  - `isolated`: Full detailed view (should be scrollable for long content)
  - `embedded`: Compact view for inclusion in other cards
  - `fitted`: **🚨 ESSENTIAL** - Fixed dimensions for grids/galleries/dashboards (parent sets both width AND height)
  - `atom`: Minimal inline representation
  - `edit`: Form for data modification (default provided, override only if needed)
  - `markdown`: Text-only Boxel Flavored Markdown representation (default HTML-to-markdown fallback provided — override only when the fallback produces poor output). See `boxel-markdown-format` and `boxel-flavored-markdown` skills.

**🔴 CRITICAL:** Modern Boxel cards require ALL THREE display formats: isolated, embedded, AND fitted. Missing custom fitted format will fallback to basic fitted view that won't look very nice or have enough info to show in grids, choosers, galleries, or dashboards.

## Decision Trees

**Data Structure Choice:**

```
Needs own identity? → CardDef with linksTo
Referenced from multiple places? → CardDef with linksTo
Referencing a file (image, doc, etc.)? → FileDef subtype with linksTo
Just compound data? → FieldDef with contains
```

**Field Extension Choice:**

```
Want to customize a base field? → import BaseField, extend it
Creating new field type? → extends FieldDef directly
Adding to existing field? → extends BaseFieldName
```

**Value Setup:**

```
Computed from other fields? → computeVia
User-editable with default? → Field literal or computeVia
Simple one-time value? → Field literal
```

**Circular Dependencies?**

```
Use arrow function: () => Type
```

## ✅ Quick Mental Check Before Every Field

Ask yourself: "Does this type extend CardDef or FieldDef?"

- Extends **CardDef** → MUST use `linksTo` or `linksToMany`
- Extends **FieldDef** → MUST use `contains` or `containsMany`
- **No exceptions!**

For computed fields, ask: "Am I keeping this simple and unidirectional?"

- Only reference base fields, never self-reference
- No circular dependencies between computed fields
- Wrap in try-catch when accessing relationships
- If it feels complex, simplify it!

### Computed field shapes (use the right one)

Boxel has **two distinct "computed" mechanisms**, with very different capabilities. Picking the wrong one is the most common source of wasted iteration cycles.

#### 1. `computeVia` — synchronous JS, primitives only

```gts
@field totalCost = contains(NumberField, {
  computeVia: function(this: Recipe) {
    return (this.ingredients ?? []).reduce((sum, i) => sum + (i?.subtotal ?? 0), 0);
  },
});
```

What it can do:
- Read other fields on `this`
- Return primitives, strings, numbers, booleans, `Date`, or arrays of those
- Walk through `linksTo`/`linksToMany` chains (with optional chaining `?.`)

What it **cannot** do:
- Be `async` — runs at index time, not render time
- Return a live CardDef instance (use `query`-backed linksTo for that — see #2 below)
- Call `getCards()`, fetch, or any I/O
- Use Glimmer template helpers like `formatDateTime`
- Reliably read "now" — `new Date()` here means index time, not render time

#### 2. `linksTo` / `linksToMany` with `query:` — canonical query-backed relationships

This IS the supported way to compute card relationships. The runtime executes the search at index time and populates the field with matching records.

```gts
// Single card from a query (linksTo — first matching result or null)
@field featuredFriend = linksTo(Friend, {
  query: {
    filter: { contains: { firstName: '$this.nameFilter' } },
  },
});

// Many cards from a query (linksToMany — all matching results)
@field matchingFriends = linksToMany(Friend, {
  query: {
    filter: { contains: { firstName: '$this.nameFilter' } },
    sort: [{ by: 'firstName', direction: '$this.sortDirection' }],
    page: { size: '$this.pageSize' },
    realm: '$REALM',
  },
});
```

Notes on this form:
- `$this.fieldName` placeholders pull from other fields on the host card.
- `$REALM` resolves to the host card's realm URL.
- Works inside `FieldDef` too — see `nested-query-field-playground.gts` for the FieldDef-wrapped variant.
- Render via `@fields.matchingFriends` (correct chrome) or read values from `@model.matchingFriends` (an array of Friend instances).
- The implicit `type` filter is merged at execution — you don't have to repeat the `on:` clause when querying the same type as the field's target.

This is **schema-level**, runs server-side, and is reactive: when source fields change, the realm reindexes and the relationship is repopulated.

#### When to use which

| Need | Use |
|---|---|
| Aggregate a number/string/bool from other fields | `computeVia` |
| Walk a relationship to read its primitive fields | `computeVia` |
| Pick one card or many from a Query at index time | `linksTo` / `linksToMany` with `query:` |
| Live-tracked search inside a Component | `this.args.context?.getCards(this, () => query, () => realms, { isLive: true })` (see `automate-linked-to-me-lookup`). Returns a SearchResource with `.instances`. |

**⚠️ `getCards` is NOT a free import.** It's exported only as a *type* from `card-api`. Importing `{ getCards }` as a value compiles cleanly and then crashes at runtime with `getCards is not a function`. The host injects the working function via `this.args.context.getCards`.

#### Common traps

- **Computed accessing a relationship can throw if the link is broken.** A `linksTo` returning `null` mid-walk crashes a naive `this.foo.bar`. Wrap in `try/catch` or use `?.` everywhere.
- **`formatDateTime` and other template helpers do NOT work in `computeVia`.** Format inside templates or use plain `Date` methods in the compute. See `date-math.md`.
- **Don't stub a query-backed computed.** If you need a "live count" of linked tasks, declare `@field tasks = linksToMany(Task, { query: ... })` and read `@model.tasks.length` — don't create a `computeVia` that hard-returns 0.

**Source:** Boxel monorepo `packages/experiments-realm/query-field-playground.gts` (single-level), `packages/experiments-realm/nested-query-field-playground.gts` (inside a FieldDef).

### Mutating model fields from a non-edit Component

A common temptation: in an `isolated` template you want a "Mark mastered" button that writes `masteredAt = new Date()` on the model. Doing this with `(this.args.model as any).masteredAt = ...` is a workaround that bypasses the host's save lifecycle — the field appears to update in-memory but isn't persisted, isn't validated, doesn't emit change events, and may be silently overwritten on the next index.

**What to do instead:**

- **Treat `args.model` as read-only outside the `edit` format.** The host's edit-format renderer is the official mutation surface — that's why it exists.
- **For interactive UI** (study sessions, timers, kanban drag), keep local UI state in `@tracked` properties on the Component. The card's persisted state stays untouched; the Component manages the session.
- **To persist a mutation from a non-edit Component**, use a Command. Define a Command that takes the value and calls the realm's save API, then invoke it from the action handler. `SaveCardCommand` is the canonical surface — see `skills/boxel/references/command-development.md`.

If you find yourself reaching for `(model as any)`, that's a sign the workflow should go through a Command or through the edit format, not through ad-hoc mutation.

## Foundation Quick Reference

**Data Structure Choice:**

- Needs own identity? → `CardDef` with `linksTo`
- Referenced from multiple places? → `CardDef` with `linksTo`
- Just compound data? → `FieldDef` with `contains`

**Formats (what they are):**

- `isolated` - Full detailed view (scrollable)
- `embedded` - Compact for inclusion in other cards
- `fitted` - Fixed dimensions for grids/galleries
- `atom` - Minimal inline representation
- `edit` - Form for data modification
- `markdown` - BFM text representation (default fallback provided; opt-in override)

**Every CardDef inherits:**

- `cardTitle`, `cardDescription`, `cardThumbnailURL`

### Inherited Fields, CardInfo, and Theme (canonical, verified against `packages/base/card-api.gts`)

This is the single most useful piece of Boxel knowledge — most "this card looks wrong" or "the title is blank" problems trace back to misuse here.

#### What every CardDef inherits (from `card-api.gts:2884–2929`)

```gts
@field id           = contains(ReadOnlyField);
@field cardInfo     = contains(CardInfoField);
@field cardTitle    = contains(StringField,        { computeVia: <cardInfo.name fallback>     });
@field cardDescription = contains(StringField,     { computeVia: () => this.cardInfo.summary  });
@field cardTheme    = linksTo(() => Theme,         { computeVia: () => this.cardInfo.theme    });
@field cardThumbnailURL = contains(MaybeBase64Field,{ computeVia: () => this.cardInfo.cardThumbnailURL });
```

#### The CardInfo field (where the user actually edits)

```gts
// card-api.gts:2874
export class CardInfoField extends FieldDef {
  static displayName = 'Card Info';
  @field name             = contains(StringField);
  @field summary          = contains(StringField);
  @field cardThumbnail    = linksTo(() => ImageDef);          // preferred (new)
  @field cardThumbnailURL = contains(MaybeBase64Field);       // legacy — keep for back-compat
  @field theme            = linksTo(() => Theme);             // ← the theme link
  @field notes            = contains(MarkdownField);
}
```

The user opens edit mode → sets `cardInfo.name`, `cardInfo.summary`, picks a `cardInfo.theme`, adds notes. UIs read the computed pass-throughs (`cardTitle`, `cardDescription`, `cardTheme`).

#### Default cardTitle: `cardInfo.name` || `Untitled <DisplayName>`

```gts
computeVia: function (this: CardDef) {
  return this.cardInfo.name?.trim()?.length
    ? this.cardInfo.name
    : `Untitled ${this.constructor.displayName}`;
}
```

#### Override `cardTitle` to compute from a primary field (canonical pattern)

When your card has a natural identifier field (`headline`, `firstName + lastName`, `email`, etc.), override `cardTitle` to fall back to that field. **Always respect user-entered `cardInfo.name` first** — this is the rule the catalog follows.

```gts
// ✅ Canonical — respects cardInfo.name, then primary field, then default
@field cardTitle = contains(StringField, {
  computeVia: function (this: BlogPost) {
    return this.cardInfo?.name?.trim()?.length
      ? this.cardInfo.name
      : (this.headline ?? `Untitled ${this.constructor.displayName}`);
  },
});
```

Three real catalog patterns:

| Form | Example | Use when |
|---|---|---|
| `cardInfo.name` first → primary field → `Untitled` | `BlogPost`, *recommended default* | Card has both a user-editable identity AND a meaningful primary field. |
| `cardInfo.name ?? this.displayName` | `WineBottle`, `WineCellar` | Card has no obvious primary field; rely on user input. |
| Static return | `Blackjack` (`return 'Blackjack'`) | Card is conceptually singleton — the title is fixed. |

#### Same idea for `cardDescription`

Default just passes through `cardInfo.summary`. Override when description is computable:

```gts
@field cardDescription = contains(StringField, {
  computeVia: function (this: Recipe) {
    return this.cardInfo?.summary?.trim()?.length
      ? this.cardInfo.summary
      : `${this.totalTime} · ${this.servings} servings`;
  },
});
```

#### Theme: `cardTheme` is computed; `cardInfo.theme` is an override

The host renders against `this.cardTheme`. The DEFAULT computeVia just passes through `cardInfo.theme`:

```gts
// card-api.gts:2917 — default behaviour
@field cardTheme = linksTo(() => Theme, {
  computeVia: function (this: CardDef) {
    return this.cardInfo.theme;
  },
});
```

Two ways a card ends up themed — pick whichever fits the schema:

**(A) Per-instance assignment via `cardInfo.theme`.** The user (or your seed JSON) links a Theme on the instance. The default computeVia picks it up. Simplest case — covers most card types without a natural parent to inherit from.

**(B) Computed `cardTheme` on the CardDef.** Override the computeVia to derive a theme from somewhere else:

```gts
// Task inherits its Project's theme
@field cardTheme = linksTo(() => Theme, {
  computeVia: function (this: Task) {
    // If the user pinned a theme on this instance, honor it (override).
    // Otherwise fall back to the linked Project's theme.
    return this.cardInfo?.theme ?? this.project?.cardTheme ?? null;
  },
});

// Or query for a "default" Theme in the realm
@field cardTheme = linksTo(() => Theme, {
  query: { filter: { eq: { isDefault: true } } },
});
```

Other valid sources for a computed `cardTheme`: lookup by `cardId` pattern, by tag, by category, by enclosing-app's choice — any business logic that yields a Theme card (or null).

**When `cardInfo.theme` IS set on an instance, it acts as an override** of whatever the CardDef's computed `cardTheme` would have returned. That's the right way to read the cardInfo-theme relationship — it's not "the only way to install a theme", it's "the per-instance escape hatch over the computed default".

**Practical implications for seed/instance JSON:**

- Cards that have a custom computed `cardTheme` (e.g. a Task inheriting from its Project) don't need `relationships["cardInfo.theme"]` on every instance — the computeVia handles it.
- Cards that rely on the default computeVia (`cardTheme = cardInfo.theme`) DO need the relationship set on the instance, otherwise no theme installs.
- `attributes.cardInfo` should still be present so the user can later add notes, name, or override the theme — but its absence isn't fatal when a computed `cardTheme` resolves.

JSON shape for the per-instance link (when used):
```json
"relationships": {
  "cardInfo.theme": {
    "links": { "self": "../Theme/modern-magazine" }
  }
}
```
Note: the relationship key includes the dot — `"cardInfo.theme"`, not `"theme"`.

#### Relationship path resolution — every `links.self` MUST have a prefix

The value of `links.self` in any instance relationship is a URL, not a "path". The Boxel loader recognizes exactly three forms:

| Form | Example | Resolves to |
|---|---|---|
| Relative descent | `"./BrandGuide/north-branch-brand-guide"` | sibling/descendant of the instance file |
| Relative ascent | `"../BrandGuide/north-branch-brand-guide"` | up from the instance, then into folder |
| Absolute URL | `"https://realms.example.com/<realm>/BrandGuide/north-branch-brand-guide"` | exactly that location |

A **bare path with no prefix** like `"BrandGuide/north-branch-brand-guide"` is treated by the loader as an **npm-style package specifier**, not a relative path. Boxel checks the realm's prefix-mapping table (almost always empty), finds no match, and throws:

```
Cannot resolve bare package specifier "BrandGuide/north-branch-brand-guide"
— no matching prefix mapping registered
    at LinksTo.deserialize (...)
```

The instance never indexes. Lint doesn't catch it.

**Where this bites:** root-level instances (e.g. `north-branch-home.json` at the realm root). Subfolder instances naturally use `../` because they're navigating up from `Style/inset-shaker.json` → root → `BrandGuide/`. Root-level instances have no `..` to use and the obvious-looking `"BrandGuide/..."` fails. Always use `"./BrandGuide/..."` for root-level instances.

#### `adoptsFrom.module` — URL of the .gts, NOT including the export name

```json
"meta": {
  "adoptsFrom": {
    "module": "https://cardstack.com/base/brand-guide",   ← no `/default`
    "name": "default"                                       ← the export name lives here
  }
}
```

The `module` field is the URL the realm-server fetches. The `name` field is the named export within that module. For `export default class Foo`, `name` is `"default"`. For `export class Foo`, `name` is `"Foo"`. Conflating them — `"module": "https://cardstack.com/base/brand-guide/default"` — turns the export name into a non-existent path segment and the realm returns a 404 for the module URL.

#### Theme card structure

`https://cardstack.com/base/theme` is the root Theme class. The current base realm layers richer theme cards on top:

- `StructuredTheme` (`https://cardstack.com/base/structured-theme`) adds structured `rootVariables`, `darkModeVariables`, `typography`, and `version`, then computes `cssVariables`.
- `StyleReference` (`https://cardstack.com/base/style-reference`) adds `styleName`, `visualDNA`, `inspirations`, and `wallpaperImages`.
- `DetailedStyleReference` (`https://cardstack.com/base/detailed-style-reference`) adds long-form style guidance for palette, typography, composition, motion, component vocabulary, voice, technical specs, quality standards, and design mindset.
- `BrandGuide` (`https://cardstack.com/base/brand-guide`) adds `brandColorPalette`, `functionalPalette`, `typography`, and `markUsage` for logo/mark material.

Both minimal raw-CSS Themes and rich structured themes can work. Prefer preserving the richest existing structure instead of flattening a `BrandGuide` or `StyleReference` down to a raw `cssVariables` string. For Boxel built-in features, use the built-in Boxel Brand Guide at `https://cardstack.com/base/Theme/boxel-brand-guide`.
