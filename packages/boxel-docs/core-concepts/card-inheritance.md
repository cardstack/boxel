# Card Inheritance

Boxel uses JavaScript prototypal inheritance for its card system. Every card inherits from another card, forming a type hierarchy rooted at `CardDef`.

## How Inheritance Works

```typescript
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

// Base card
export class Animal extends CardDef {
  static displayName = 'Animal';
  @field species = contains(StringField);
  @field name = contains(StringField);
}

// Extended card — inherits species and name
export class Dog extends Animal {
  static displayName = 'Dog';
  @field breed = contains(StringField);
  @field tricks = containsMany(StringField);
}
```

`Dog` inherits all fields and templates from `Animal` and adds its own fields.

## The Inheritance Chain

```
CardDef
  └── Animal
        ├── Dog
        ├── Cat
        └── Bird
              └── Parrot
```

Every card is part of this chain. The indexer stores the full adoption chain for each card instance, enabling queries like "find all Animals" to include Dogs, Cats, Birds, and Parrots.

## What Gets Inherited

| Feature | Inherited? | Can Override? |
|---------|-----------|---------------|
| Fields | Yes | No (can only add new ones) |
| Templates (isolated, embedded, etc.) | Yes | Yes |
| `displayName` | Yes | Yes |
| `icon` | Yes | Yes |
| `headerColor` | Yes | Yes |
| `prefersWideFormat` | Yes | Yes |
| Computed fields | Yes | Yes (with setter) |

## Rules of Inheritance

### 1. Fields Can Only Be Added, Not Removed

You **cannot** delete or modify an inherited field. You can only add new fields:

```typescript
// ✅ Valid — adding new fields
export class Dog extends Animal {
  @field breed = contains(StringField);    // New field
}

// ❌ Invalid — cannot override inherited field type
export class Dog extends Animal {
  @field species = contains(NumberField);  // ERROR!
}
```

### 2. Templates Can Be Overridden

Child cards can provide their own templates to change how they render:

```typescript
export class Dog extends Animal {
  static displayName = 'Dog';

  // Override the isolated template
  static isolated = class Isolated extends Component<typeof Dog> {
    <template>
      <div class="dog-card">
        <h1>🐕 {{@model.name}}</h1>
        <p>Breed: {{@model.breed}}</p>
        <p>Species: {{@model.species}}</p>
      </div>
    </template>
  };
}
```

If a child doesn't define a template, it inherits the parent's template. The parent template still works because it uses `<@fields.fieldName />` which resolves dynamically.

### 3. Computed Fields Flow Down

Changes to a parent card's computed fields affect all children:

```typescript
export class Animal extends CardDef {
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);

  @field displayName = contains(StringField, {
    computeVia: function (this: Animal) {
      return `${this.firstName} ${this.lastName}`;
    },
  });
}

// Dog inherits displayName — it works automatically
export class Dog extends Animal {
  @field breed = contains(StringField);
  // displayName computed field is inherited and works
}
```

### 4. Field Override with Computed Requires Setter

If you override an inherited field to be computed, you may need to provide a setter:

```typescript
export class SpecialAnimal extends Animal {
  @field species = contains(StringField, {
    computeVia: function (this: SpecialAnimal) {
      return 'Special Species';
    },
  });
}
```

## Adoption Terminology

In Boxel, inheritance is called **adoption**:

- A card **adopts from** its parent definition
- The `meta.adoptsFrom` field in JSON specifies the parent class
- "Adoption chain" = the full inheritance hierarchy

```json
{
  "data": {
    "meta": {
      "adoptsFrom": {
        "module": "./dog",
        "name": "Dog"
      }
    }
  }
}
```

## Practical Patterns

### Base Entity Card

Create a base card with common fields for all your domain cards:

```typescript
export class BaseEntity extends CardDef {
  @field name = contains(StringField);
  @field description = contains(StringField);
  @field createdAt = contains(DatetimeField);
}

export class Product extends BaseEntity {
  @field price = contains(NumberField);
  @field sku = contains(StringField);
}

export class Customer extends BaseEntity {
  @field email = contains(EmailField);
  @field phone = contains(StringField);
}
```

### Querying by Type

Because of the adoption chain, querying for `BaseEntity` returns all Products and Customers too:

```typescript
// Finds Products, Customers, and any other BaseEntity descendants
const results = await search({
  filter: {
    type: { module: './base-entity', name: 'BaseEntity' }
  }
});
```

To find only Products (not Customers):

```typescript
const products = await search({
  filter: {
    type: { module: './product', name: 'Product' }
  }
});
```

## Next Steps

- [Card Rendering](/core-concepts/card-rendering) — How inherited templates work
- [Computed Fields](/core-concepts/computed-fields) — Derived values
- [Defining Cards](/card-development/defining-cards) — Advanced card patterns
