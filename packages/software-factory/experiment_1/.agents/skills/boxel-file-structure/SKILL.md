---
name: boxel-file-structure
description: Use when organizing files in a Boxel workspace, choosing filenames or directories for card definitions and instances, or validating JSON `adoptsFrom.module` paths and relationship links.
---

# Boxel File Structure Rules

Rules for organizing files in a Boxel workspace when working locally with boxel-cli.

## URL Structure

```
https://[realm-domain]/[username]/[workspace]/[path].[extension]
Example: https://app.boxel.ai/sarah/pet-rescue/animals/dog.gts
```

## File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Card definitions | `kebab-case.gts` | `blog-post.gts`, `grammy-award.gts` |
| Instance directories | `PascalCase/` | `BlogPost/`, `GrammyAward/` |
| Instance files | `kebab-case.json` | `my-first-post.json` |

## Directory Structure

```
workspace/
├── .realm.json           # Workspace config
├── index.json            # Workspace index
├── cards-grid.json       # Default cards grid
├── blog-post.gts         # Card definition (kebab-case)
├── BlogPost/             # Instance directory (PascalCase)
│   ├── my-first-post.json
│   └── another-post.json
├── author.gts
└── Author/
    └── jane-doe.json
```

## Module Paths in JSON (CRITICAL)

**The `adoptsFrom.module` path is relative to the JSON file location.**

### ✅ Correct: Instance in subdirectory
```
grammy-award.gts          # Definition at root
GrammyAward/              # Instances in PascalCase directory
└── record-of-the-year.json
```

**In `GrammyAward/record-of-the-year.json`:**
```json
{
  "meta": {
    "adoptsFrom": {
      "module": "../grammy-award",  // ← Go UP to parent, then to file
      "name": "GrammyAward"
    }
  }
}
```

### ❌ Wrong: Forgetting the relative path
```json
{
  "meta": {
    "adoptsFrom": {
      "module": "./grammy-award",  // ← WRONG! This looks in GrammyAward/
      "name": "GrammyAward"
    }
  }
}
```

## Path Rules Summary

| JSON Location | Definition Location | Module Path |
|--------------|---------------------|-------------|
| `root/Instance.json` | `root/card.gts` | `"./card"` |
| `root/Card/instance.json` | `root/card.gts` | `"../card"` |
| `root/Card/Sub/instance.json` | `root/card.gts` | `"../../card"` |
| `root/Card/instance.json` | `root/other/card.gts` | `"../other/card"` |

## Instance JSON Structure (Full)

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "fieldName": "value",
      "numberField": 123,
      "boolField": true
    },
    "relationships": {
      "author": {
        "links": {
          "self": "../Author/jane-doe"
        }
      }
    },
    "meta": {
      "adoptsFrom": {
        "module": "../card-definition",
        "name": "CardClassName"
      }
    }
  }
}
```

## linksToMany Relationships (CRITICAL)

**🔴 For `linksToMany` fields, use numbered keys like `fieldName.0`, `fieldName.1`, etc.**

```json
{
  "data": {
    "relationships": {
      "tags.0": {
        "links": {
          "self": "../Tag/tech"
        }
      },
      "tags.1": {
        "links": {
          "self": "../Tag/news"
        }
      },
      "tags.2": {
        "links": {
          "self": "../Tag/tutorial"
        }
      }
    }
  }
}
```

### ❌ Wrong: Array syntax (does NOT work)
```json
{
  "relationships": {
    "tags": {
      "links": {
        "self": ["../Tag/tech", "../Tag/news"]
      }
    }
  }
}
```
```

### JSON Structure Rules

| Section | Purpose | Required |
|---------|---------|----------|
| `data.type` | Always `"card"` | Yes |
| `data.attributes` | Scalar field values (string, number, bool) | Yes |
| `data.relationships` | Links to other cards (`linksTo`/`linksToMany`) | Only if has links |
| `data.meta.adoptsFrom` | References the card definition | Yes |

### Attributes vs Relationships

**Use `attributes` for:**
- StringField, NumberField, BooleanField values
- FieldDef instances (embedded via `contains`)
- Any non-card data

**Use `relationships` for:**
- CardDef references (`linksTo` → single link)
- CardDef arrays (`linksToMany` → array of links)

## The Cardinal Rule (linksTo vs contains)

**🔴 CRITICAL - memorize this:**

| Field Type | Definition uses | Instance uses |
|------------|-----------------|---------------|
| Extends `CardDef` | `linksTo` / `linksToMany` | `relationships` |
| Extends `FieldDef` | `contains` / `containsMany` | `attributes` |

```gts
// In .gts definition:
@field author = linksTo(Author);        // Author extends CardDef → relationships
@field address = contains(AddressField); // AddressField extends FieldDef → attributes
```

```json
// In .json instance:
{
  "attributes": {
    "address": { "street": "123 Main", "city": "NYC" }
  },
  "relationships": {
    "author": { "links": { "self": "../Author/jane" } }
  }
}
```

## Links Between Cards

When linking to other cards, use the card's URL without `.json`:

```json
{
  "data": {
    "relationships": {
      "author": {
        "links": {
          "self": "../Author/jane-doe"
        }
      }
    }
  }
}
```

## Base Realms (Read-Only)

These realms contain shared definitions you can import from:

**Production:**
- `@cardstack/base/` - Core types (CardDef, FieldDef, etc.)
- `https://app.boxel.ai/catalog/` - Catalog cards
- `https://app.boxel.ai/skills/` - Skill cards

**Staging:**
- `@cardstack/base/` - Same core types
- `https://realms-staging.stack.cards/catalog/`
- `https://realms-staging.stack.cards/skills/`

## Common Import Patterns

```gts
// Core imports (always from @cardstack/base)
import {
  CardDef,
  FieldDef,
  field,
  contains,
  linksTo,
  containsMany,
  linksToMany,
  StringField,
  NumberField,
  BooleanField,
  Component,
} from '@cardstack/base/card-api';

// Import from same workspace
import { Author } from './author';

// Import from base realm
import { Skill } from '@cardstack/base/skill';
```

## Query Structure (for API searches)

When using the `/_search` API endpoint:

```json
{
  "filter": {
    "type": {
      "module": "https://realm-url/card-name",
      "name": "CardClassName"
    }
  }
}
```

**With field filters:**
```json
{
  "filter": {
    "on": { "module": "https://realm-url/product", "name": "Product" },
    "contains": { "name": "laptop" }
  }
}
```

**Operations:** `eq`, `contains`, `range`, `not`, `type`, `every` (AND), `any` (OR)

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `"module": "./card"` from subdirectory | Use `"../card"` |
| `contains(CardDef)` | Use `linksTo(CardDef)` |
| `linksTo(FieldDef)` | Use `contains(FieldDef)` |
| Link in `attributes` | Move to `relationships` |
| FieldDef in `relationships` | Move to `attributes` |
| Missing `data` wrapper in JSON | Wrap everything in `{"data": {...}}` |
| PascalCase for `.gts` files | Use `kebab-case.gts` |
| kebab-case for instance dirs | Use `PascalCase/` |
| `linksToMany` as array | Use numbered keys: `field.0`, `field.1`, etc. |

## Essential Formats

Every CardDef should implement these templates:
- `isolated` - Full detail view (scrollable)
- `embedded` - Compact summary for lists
- `fitted` - Fixed dimensions for grids/dashboards (CRITICAL for good UX)
