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
  - `markdown`: Text-only Boxel Flavored Markdown representation (default HTML-to-markdown fallback provided — override only when the fallback produces poor output). See `dev-markdown-format` and `dev-bfm-syntax` skills.

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

### Inherited Fields and CardInfo

**IMPORTANT:** Every CardDef automatically inherits these base fields from the CardDef base class:

#### Direct Inherited Fields (Read-Only)

- `cardTitle` (StringField) - Computed pass-through from `cardInfo.name`
- `cardDescription` (StringField) - Computed pass-through from `cardInfo.summary`
- `cardThumbnailURL` (StringField) - Computed pass-through from `cardInfo.cardThumbnailURL`

#### CardInfo Field (User-Editable)

Every card also inherits a `cardInfo` field which contains the actual user-editable values:

- `cardInfo.name` (StringField) - User-editable card title
- `cardInfo.summary` (StringField) - User-editable card description
- `cardInfo.cardThumbnailURL` (StringField) - User-editable card thumbnail image URL
- `cardInfo.theme` (linksTo ThemeCard) - Optional theme card link
- `cardInfo.notes` (MarkdownField) - Optional internal notes

**How It Works:**
The top-level `cardTitle`, `cardDescription`, and `cardThumbnailURL` fields are computed properties that automatically pass through the values from `cardInfo.name`, `cardInfo.summary`, and `cardInfo.cardThumbnailURL` respectively. This means:

- By default, when you read `@model.cardTitle` in templates, you get the value from `cardInfo.name`
- Users edit values through the `cardInfo` field in edit mode
- If `cardInfo.name` is empty, the default fallback for `@model.cardTitle` is `Untitled [DisplayName]`, where `DisplayName` is the static `displayName` property
- IF a card's parent class has custom logic that overrides the default behavior of `@model.cardTitle`, OR if user wants `@model.cardTitle` to be the computed of a different field (not `cardInfo.name`), THEN you need to override to add custom logic that respects user input. Here is how you can override it:

```gts
export class BlogPost extends CardDef {
  @field headline = contains(StringField); // Your primary field

  // Overriding inherited cardTitle - respects user's cardInfo.name if set
  @field cardTitle = contains(StringField, {
    computeVia: function () {
      return this.cardInfo?.name ?? this.headline ?? 'Untitled';
    },
  });
}
```
