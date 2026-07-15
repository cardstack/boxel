## File Organization

### Single App Structure
```
my-realm/
├── blog-post.gts          # Card definition (kebab-case)
├── author.gts             # Another card
├── address-field.gts      # Field definition (kebab-case-field)
├── BlogPost/              # Instance directory (PascalCase)
│   ├── hello-world.json   # Instance (any-name)
│   └── second-post.json   
└── Author/
    └── jane-doe.json
```

### Related Cards App Structure
**CRITICAL:** When creating apps with multiple related cards, organize them in common folders:

```
my-realm/
├── ecommerce/             # Common folder for related cards
│   ├── product.gts        # Card definitions
│   ├── order.gts
│   ├── customer.gts
│   ├── Product/           # Instance directories
│   │   └── laptop-pro.json
│   └── Order/
│       └── order-001.json
├── blog/                  # Another app's folder
│   ├── post.gts
│   ├── author.gts
│   └── Post/
│       └── welcome.json
└── shared/                # Shared components
    └── address-field.gts  # Common field definitions
```

**Directory Discipline:** When creating files within a specific directory structure (e.g., `ecommerce/`), keep ALL related files within that structure. Don't create files outside the intended directory organization.

**Relationship Path Tracking:** When creating related JSON instances, maintain a mental map of your file paths. Links between instances must use the exact relative paths you've created - consistency prevents broken relationships.

## JSON Instance Format Quick Reference

**When creating `.json` card instances via SEARCH/REPLACE, follow this structure:**

**Naming:** Use natural names for JSON files (e.g., `Author/jane-doe.json`, `Product/laptop-pro.json`) - don't append `-sample-data`

**Path Consistency:** When creating multiple related JSON instances, track the exact file paths you create. Relationship links must match these paths exactly - if you create `Author/dr-nakamura.json`, reference it as `"../Author/dr-nakamura"` from other instances.

### Root Structure
All data wrapped in a `data` object with:
* `type`: Always `"card"` for instances
* `attributes`: Field values go here
* `relationships`: Links to other cards
* `meta.adoptsFrom`: Connection to GTS definition

### Instance Template
```json
{
  "data": {
    "type": "card",
    "attributes": {
      // Field values here
    },
    "relationships": {
      // Card links here
    },
    "meta": {
      "adoptsFrom": {
        "module": "../path-to-gts-file",
        "name": "CardDefClassName"
      }
    }
  }
}
```

### Field Value Patterns

**Simple fields** (`contains(StringField)`, etc.):
```json
"attributes": {
  "title": "My Title",
  "price": 29.99,
  "isActive": true
}
```

**Compound fields** (`contains(AddressField)` - a FieldDef):
```json
"attributes": {
  "address": {
    "street": "4827 Riverside Terrace",
    "city": "Portland",
    "postalCode": "97205"
  }
}
```

**Array fields** (`containsMany`):
```json
"attributes": {
  "tags": ["urgent", "review", "frontend"],
  "phoneNumbers": [
    { "number": "+1-503-555-0134", "type": "work" },
    { "number": "+1-971-555-0198", "type": "mobile" }
  ]
}
```

### Relationship Patterns

**Single link** (`linksTo`):
```json
"relationships": {
  "author": {
    "links": {
      "self": "../Author/dr-nakamura"
    }
  }
}
```

**Multiple links** (`linksToMany`) - note the `.0`, `.1` pattern:
```json
"relationships": {
  "teamMembers.0": {
    "links": { "self": "../Person/kai-nakamura" }
  },
  "teamMembers.1": {
    "links": { "self": "../Person/esperanza-cruz" }
  }
}
```

**Empty linksToMany** - when no relationships exist:
```json
"relationships": {
  "nextLevels": {
    "links": {
      "self": null
    }
  }
}
```
Note: Use `null`, not an empty array `[]`

### Path Conventions
* **Module paths**: Relative to JSON location, no `.gts` extension
  * Local: `"../author"` or `"../../shared/address-field"`
  * Base: `"https://cardstack.com/base/string"`
* **Relationship paths**: Relative paths, no `.json` extension
  * `"../Author/jane-doe"` not `"../Author/jane-doe.json"`
* **Date formats**: 
  * DateField: `"2024-11-15"`
  * DateTimeField: `"2024-11-15T10:00:00Z"`