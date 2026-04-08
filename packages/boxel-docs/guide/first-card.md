# Your First Card

This tutorial walks you through creating a complete card from scratch, explaining every concept along the way.

## What We'll Build

A **Contact Card** with:
- Name, email, and phone fields
- A linked Company card
- Multiple render formats (isolated, embedded, edit)
- A computed field for the display name

## Step 1: Create a Basic Card

Create a new file `contact.gts` in your realm directory:

```typescript
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Contact extends CardDef {
  static displayName = 'Contact';

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(StringField);
}
```

### What's Happening Here

- **`CardDef`** — The base class for all cards. Every card extends `CardDef` (or another card that extends it).
- **`@field`** — A decorator that registers a field on the card class.
- **`contains(StringField)`** — Declares a field that *contains* a `StringField` value. The data is embedded directly in the card.
- **`static displayName`** — Human-readable name shown in the UI.

## Step 2: Add Render Templates

Cards render in multiple formats. Let's add templates:

```typescript
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Contact extends CardDef {
  static displayName = 'Contact';

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(StringField);

  // Full-page view
  static isolated = class Isolated extends Component<typeof Contact> {
    <template>
      <div class="contact-card">
        <h1><@fields.firstName /> <@fields.lastName /></h1>
        <p class="email"><@fields.email /></p>
      </div>
      <style scoped>
        .contact-card {
          padding: var(--boxel-sp-lg);
          font-family: var(--boxel-font-family);
        }
        .contact-card h1 {
          font-size: var(--boxel-font-size-xl);
          margin: 0 0 var(--boxel-sp-sm);
        }
        .email {
          color: var(--boxel-purple);
        }
      </style>
    </template>
  };

  // Compact preview
  static embedded = class Embedded extends Component<typeof Contact> {
    <template>
      <div class="contact-embed">
        <strong><@fields.firstName /> <@fields.lastName /></strong>
        <span class="email"><@fields.email /></span>
      </div>
      <style scoped>
        .contact-embed {
          display: flex;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs);
        }
        .email {
          color: var(--boxel-400);
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };

  // Edit form
  static edit = class Edit extends Component<typeof Contact> {
    <template>
      <div class="contact-edit">
        <label>
          First Name
          <@fields.firstName />
        </label>
        <label>
          Last Name
          <@fields.lastName />
        </label>
        <label>
          Email
          <@fields.email />
        </label>
      </div>
      <style scoped>
        .contact-edit {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-lg);
        }
        label {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
          font-weight: 600;
        }
      </style>
    </template>
  };
}
```

### Template Formats Explained

| Format | Purpose | When Used |
|--------|---------|-----------|
| `isolated` | Full-page view | When a card is the main content |
| `embedded` | Compact preview | Inside other cards, search results |
| `fitted` | Adaptive layout | Responsive containers |
| `edit` | Form view | When editing the card |
| `atom` | Minimal chip | Inline mentions, dense lists |

The `<@fields.firstName />` syntax renders a field using its own template. In `edit` mode, this automatically becomes an input; in other modes, it displays the value.

## Step 3: Add a Computed Field

Computed fields derive their value from other fields:

```typescript
@field fullName = contains(StringField, {
  computeVia: function (this: Contact) {
    return [this.firstName, this.lastName].filter(Boolean).join(' ');
  },
});
```

Add this to your `Contact` class. Now `fullName` automatically updates whenever `firstName` or `lastName` changes. Computed fields are:
- **Never cached** — fresh on every access
- **Reactive** — trigger re-renders when dependencies change
- **Read-only** — cannot be set directly

## Step 4: Link to Another Card

Let's create a `Company` card and link it:

```typescript
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

// Define Company in the same file or import from another module
export class Company extends CardDef {
  static displayName = 'Company';

  @field name = contains(StringField);
  @field industry = contains(StringField);
}

export class Contact extends CardDef {
  static displayName = 'Contact';

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(StringField);

  // Link to a Company card (stored as a reference, not embedded)
  @field company = linksTo(Company);

  @field fullName = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });
}
```

### contains vs. linksTo

| Aspect | `contains` | `linksTo` |
|--------|-----------|----------|
| Storage | Embedded in card JSON | Stored as reference (URL) |
| Lifecycle | Tied to parent card | Independent card |
| Serialization | In `attributes` | In `relationships` |
| Use case | Simple values, composite fields | Shared entities |

There's also `containsMany` (array of embedded values) and `linksToMany` (array of references).

## Step 5: Create an Instance

Create a JSON file for a card instance:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "firstName": "Alice",
      "lastName": "Johnson",
      "email": "alice@example.com"
    },
    "relationships": {
      "company": {
        "links": { "self": "../company/acme-corp" }
      }
    },
    "meta": {
      "adoptsFrom": {
        "module": "./contact",
        "name": "Contact"
      }
    }
  }
}
```

The `meta.adoptsFrom` field tells Boxel which card class to use. The `module` is a relative path to the `.gts` file, and `name` is the exported class name.

## Step 6: Add an Icon

Give your card a visual identity:

```typescript
import ContactIcon from '@cardstack/boxel-icons/contact';

export class Contact extends CardDef {
  static displayName = 'Contact';
  static icon = ContactIcon;

  // ... fields
}
```

## Complete Example

Here's the finished contact card:

```typescript
import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import ContactIcon from '@cardstack/boxel-icons/contact';

export class Company extends CardDef {
  static displayName = 'Company';
  @field name = contains(StringField);
  @field industry = contains(StringField);
}

export class Contact extends CardDef {
  static displayName = 'Contact';
  static icon = ContactIcon;

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(StringField);
  @field company = linksTo(Company);

  @field fullName = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  static isolated = class Isolated extends Component<typeof Contact> {
    <template>
      <div class="contact-card">
        <h1>{{@model.fullName}}</h1>
        <p class="email"><@fields.email /></p>
        <div class="company">
          <h3>Company</h3>
          <@fields.company />
        </div>
      </div>
      <style scoped>
        .contact-card {
          padding: var(--boxel-sp-lg);
          font-family: var(--boxel-font-family);
        }
        h1 { margin: 0 0 var(--boxel-sp-sm); }
        .email { color: var(--boxel-purple); }
        .company { margin-top: var(--boxel-sp-lg); }
      </style>
    </template>
  };
}
```

## What's Next?

- [Cards & Fields](/core-concepts/cards-and-fields) — Deep dive into the card system
- [Card Rendering](/core-concepts/card-rendering) — All five render formats in detail
- [Field Types Reference](/card-development/field-types) — Every built-in field type
- [Defining Cards](/card-development/defining-cards) — Advanced card patterns
