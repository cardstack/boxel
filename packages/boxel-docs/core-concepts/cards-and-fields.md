# Cards & Fields

Cards and fields are the fundamental building blocks of every Boxel application. Understanding their relationship is essential to building with Boxel.

## What is a Card?

A **card** is a self-describing unit that combines:
- **Schema** — typed fields with relationships
- **Data** — serialized as JSON-API documents
- **Templates** — rendering logic for multiple formats
- **Behavior** — computed fields and commands

Every card is an instance of a **card definition** (a class extending `CardDef`), and every card instance is a JSON document stored in a realm.

```typescript
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Person extends CardDef {
  static displayName = 'Person';

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
}
```

## What is a Field?

A **field** is a typed property on a card. Fields come in two varieties:

### Primitive Fields

Primitive fields hold simple values — strings, numbers, booleans, dates. They have no fields of their own.

```typescript
@field name = contains(StringField);        // string
@field age = contains(NumberField);          // number
@field isActive = contains(BooleanField);   // boolean
@field birthday = contains(DateField);      // date
```

### Composite (Compound) Fields

Composite fields are classes extending `FieldDef` that contain other fields. They behave like mini-cards but without their own identity (no URL, no independent lifecycle).

```typescript
import { FieldDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

export class Address extends FieldDef {
  static displayName = 'Address';

  @field street = contains(StringField);
  @field city = contains(StringField);
  @field state = contains(StringField);
  @field zip = contains(StringField);
}
```

Then use it in a card:

```typescript
export class Contact extends CardDef {
  @field address = contains(Address);
}
```

## CardDef vs. FieldDef

| Aspect | CardDef | FieldDef |
|--------|---------|----------|
| **Identity** | Has a URL (stored independently) | No URL (embedded in parent) |
| **Storage** | Own JSON file in a realm | Part of parent's JSON |
| **Linkable** | Can be linked via `linksTo` | Cannot be linked to |
| **Lifecycle** | Independent — exists on its own | Dependent — tied to parent |
| **Default format** | `isolated` | `embedded` |
| **Use case** | Entities (Person, Company) | Value types (Address, Money) |

## The Four Relationship Types

Fields connect to their values through four decorators:

### `contains` — Single Embedded Value

Embeds a single field value directly in the card's attributes.

```typescript
@field title = contains(StringField);
@field address = contains(Address);
```

**Serialized as:**
```json
{
  "attributes": {
    "title": "Hello",
    "address": {
      "street": "123 Main St",
      "city": "Springfield"
    }
  }
}
```

### `containsMany` — Array of Embedded Values

Embeds an array of values. The data is stored directly in the card.

```typescript
@field tags = containsMany(StringField);
@field addresses = containsMany(Address);
```

**Serialized as:**
```json
{
  "attributes": {
    "tags": ["typescript", "boxel"],
    "addresses": [
      { "street": "123 Main St", "city": "Springfield" },
      { "street": "456 Oak Ave", "city": "Shelbyville" }
    ]
  }
}
```

### `linksTo` — Single Card Reference

References another card by URL. The referenced card exists independently.

```typescript
@field company = linksTo(Company);
```

**Serialized as:**
```json
{
  "relationships": {
    "company": {
      "links": { "self": "./company/acme-corp" }
    }
  }
}
```

### `linksToMany` — Array of Card References

References multiple independent cards.

```typescript
@field teammates = linksToMany(Person);
```

**Serialized as:**
```json
{
  "relationships": {
    "teammates": {
      "links": {
        "self": null
      },
      "data": [
        { "type": "card", "id": "./person/alice" },
        { "type": "card", "id": "./person/bob" }
      ]
    }
  }
}
```

## Choosing Between Contains and LinksTo

```
                    ┌─────────────────┐
                    │ Is it a simple   │
                    │ value or type?   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
              ┌─yes─┤ Needs own URL?  ├─no──┐
              │     └─────────────────┘     │
              │                             │
     ┌────────▼────────┐          ┌────────▼────────┐
     │    linksTo /     │          │   contains /     │
     │   linksToMany    │          │  containsMany    │
     └─────────────────┘          └─────────────────┘
```

**Use `contains`** when:
- The value is a simple type (string, number, date)
- The value is a composite field (address, money) with no independent identity
- The data should be embedded directly in the parent

**Use `linksTo`** when:
- The value is a card with its own identity
- Multiple cards might reference the same entity
- You want the referenced card to have its own URL and lifecycle

## Field Options

All field decorators accept an options object:

```typescript
@field name = contains(StringField, {
  description: 'The full display name',
  computeVia: function (this: MyCard) {
    return `${this.firstName} ${this.lastName}`;
  },
  isUsed: true,
});
```

| Option | Type | Description |
|--------|------|-------------|
| `description` | `string` | Human-readable field description |
| `computeVia` | `function` | Makes this a computed field |
| `isUsed` | `boolean` | Marks field as "used" for filtering |
| `configuration` | `object` | Per-instance field configuration |

### LinksTo Options

`linksTo` and `linksToMany` accept additional options:

```typescript
@field relatedPosts = linksToMany(() => BlogPost, {
  query: {
    filter: { type: { module: './blog-post', name: 'BlogPost' } },
    sort: [{ by: 'title', direction: 'asc' }],
  },
});
```

| Option | Type | Description |
|--------|------|-------------|
| `query` | `Query` | Auto-populate from a search query |

## Self-Referential Cards

Use a thunk (arrow function) for self-references to avoid circular declaration issues:

```typescript
export class Category extends CardDef {
  @field name = contains(StringField);
  @field parent = linksTo(() => Category);
  @field children = linksToMany(() => Category);
}
```

## The Type Hierarchy

```
BaseDef
├── CardDef
│   └── [Your cards extend this]
└── FieldDef
    ├── StringField (primitive)
    ├── NumberField (primitive)
    ├── BooleanField (primitive)
    ├── DateField (primitive)
    ├── DatetimeField (primitive)
    ├── EmailField (primitive)
    ├── MarkdownField (primitive)
    └── [Your composite fields extend FieldDef]
```

## Next Steps

- [Card Inheritance](/core-concepts/card-inheritance) — Extending cards
- [Card Rendering](/core-concepts/card-rendering) — Display formats
- [Field Types Reference](/card-development/field-types) — All built-in types
- [Computed Fields](/core-concepts/computed-fields) — Derived values
