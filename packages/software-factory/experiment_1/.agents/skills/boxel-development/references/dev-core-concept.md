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

**Every CardDef inherits:**

- `title`, `description`, `thumbnailURL`

### Inherited Fields and CardInfo

**IMPORTANT:** Every CardDef automatically inherits these base fields from the CardDef base class:

#### Direct Inherited Fields (Read-Only)

- `title` (StringField) - Computed pass-through from `cardInfo.title`
- `description` (StringField) - Computed pass-through from `cardInfo.description`
- `thumbnailURL` (StringField) - Computed pass-through from `cardInfo.thumbnailURL`

#### CardInfo Field (User-Editable)

Every card also inherits a `cardInfo` field which contains the actual user-editable values:

- `cardInfo.title` (StringField) - User-editable card title
- `cardInfo.description` (StringField) - User-editable card description
- `cardInfo.thumbnailURL` (StringField) - User-editable thumbnail image URL
- `cardInfo.theme` (linksTo ThemeCard) - Optional theme card link
- `cardInfo.notes` (MarkdownField) - Optional internal notes

**How It Works:**
The top-level `title`, `description`, and `thumbnailURL` fields are computed properties that automatically pass through the values from `cardInfo.title`, `cardInfo.description`, and `cardInfo.thumbnailURL` respectively. This means:

- When you read `@model.title` in templates, you get the value from `cardInfo.title`
- Users edit values through the `cardInfo` field in edit mode
- Override to add custom logic that respects user input

**Best Practice:** Define your own primary field and compute `title` to respect user's `cardInfo.title` choice:

```gts
export class BlogPost extends CardDef {
  @field headline = contains(StringField); // Your primary field

  // Override inherited title - respects user's cardInfo.title if set
  @field title = contains(StringField, {
    computeVia: function () {
      return this.cardInfo?.title ?? this.headline ?? 'Untitled';
    },
  });
}
```
