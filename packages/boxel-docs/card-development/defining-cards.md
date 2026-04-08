# Defining Cards

This guide covers all patterns and techniques for defining cards in Boxel.

## Basic Card Definition

```typescript
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Task extends CardDef {
  static displayName = 'Task';

  @field title = contains(StringField);
  @field description = contains(StringField);
}
```

### Required Elements

| Element | Purpose |
|---------|---------|
| `export class` | Must be exported for other modules to use |
| `extends CardDef` | All cards inherit from CardDef (or another card) |
| `static displayName` | Human-readable name in the UI |
| `@field` | Field declarations |

## Card Metadata

### Display Name and Icon

```typescript
import TaskIcon from '@cardstack/boxel-icons/clipboard-list';

export class Task extends CardDef {
  static displayName = 'Task';
  static icon = TaskIcon;
  static headerColor = '#6366f1';
  static prefersWideFormat = true;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `displayName` | `string` | Name shown in UI |
| `icon` | `Component` | Icon component from boxel-icons |
| `headerColor` | `string` | CSS color for card header |
| `prefersWideFormat` | `boolean` | Prefer wide layout when rendered |

## Field Declarations

### Simple Fields

```typescript
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import DatetimeField from 'https://cardstack.com/base/datetime';

export class Product extends CardDef {
  @field name = contains(StringField);
  @field price = contains(NumberField);
  @field inStock = contains(BooleanField);
  @field releaseDate = contains(DateField);
  @field lastUpdated = contains(DatetimeField);
}
```

### Composite Fields

Create custom field types by extending `FieldDef`:

```typescript
import { FieldDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

export class Money extends FieldDef {
  static displayName = 'Money';

  @field amount = contains(NumberField);
  @field currency = contains(StringField);

  static embedded = class Embedded extends Component<typeof Money> {
    <template>
      <span>{{@model.currency}} {{@model.amount}}</span>
    </template>
  };
}

// Use in a card
export class Product extends CardDef {
  @field name = contains(StringField);
  @field price = contains(Money);
}
```

### Plural Fields

```typescript
import { containsMany, linksToMany } from 'https://cardstack.com/base/card-api';

export class Article extends CardDef {
  @field tags = containsMany(StringField);           // Array of strings
  @field categories = containsMany(Category);         // Array of composite fields
  @field relatedArticles = linksToMany(() => Article); // Array of card links
}
```

### Linked Fields

```typescript
import { linksTo, linksToMany } from 'https://cardstack.com/base/card-api';

export class Employee extends CardDef {
  @field name = contains(StringField);
  @field department = linksTo(Department);              // Single link
  @field manager = linksTo(() => Employee);             // Self-reference
  @field directReports = linksToMany(() => Employee);   // Multiple links
}
```

### Computed Fields

```typescript
export class Invoice extends CardDef {
  @field lineItems = containsMany(LineItem);

  @field total = contains(NumberField, {
    computeVia: function (this: Invoice) {
      return (this.lineItems ?? []).reduce(
        (sum, item) => sum + (item.amount ?? 0),
        0
      );
    },
  });

  @field displayTotal = contains(StringField, {
    computeVia: function (this: Invoice) {
      return `$${(this.total ?? 0).toFixed(2)}`;
    },
  });
}
```

## Templates

### Multi-Format Templates

```typescript
export class Contact extends CardDef {
  @field name = contains(StringField);
  @field email = contains(StringField);
  @field avatar = contains(StringField);

  // Full page view
  static isolated = class extends Component<typeof Contact> {
    <template>
      <div class="contact-full">
        <img src={{@model.avatar}} alt={{@model.name}} />
        <h1><@fields.name /></h1>
        <p><@fields.email /></p>
      </div>
    </template>
  };

  // Compact view
  static embedded = class extends Component<typeof Contact> {
    <template>
      <div class="contact-compact">
        <strong><@fields.name /></strong>
        <span><@fields.email /></span>
      </div>
    </template>
  };

  // Adaptive view
  static fitted = class extends Component<typeof Contact> {
    <template>
      <div class="contact-fitted">
        <@fields.name />
      </div>
      <style scoped>
        @container fitted-card (max-height: 57px) {
          .contact-fitted { font-size: 0.875rem; }
        }
      </style>
    </template>
  };

  // Form view
  static edit = class extends Component<typeof Contact> {
    <template>
      <div class="contact-form">
        <label>Name <@fields.name /></label>
        <label>Email <@fields.email /></label>
      </div>
    </template>
  };

  // Minimal view
  static atom = class extends Component<typeof Contact> {
    <template>{{@model.name}}</template>
  };
}
```

### Template API

Inside templates, you have access to:

| Reference | Type | Description |
|-----------|------|-------------|
| `@model` | Card instance | The card data object |
| `@fields` | Field renderers | Components for each field |
| `@model.fieldName` | Raw value | Direct field value access |
| `<@fields.fieldName />` | Component | Renders field with its template |
| `<@fields.fieldName @format="atom" />` | Component | Renders in specific format |

### Using `@model` vs `<@fields>`

```typescript
// @model — raw value, you control rendering
<h1>{{@model.title}}</h1>

// @fields — field component, renders with its own template
<@fields.title />

// @fields with format — override the render format
<@fields.company @format="atom" />
```

**Use `@model`** when you need the raw value for custom rendering.
**Use `<@fields>`** when you want the field to render itself (respects field templates, handles edit mode).

## Advanced Patterns

### Card with State and Actions

```typescript
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

export class Counter extends CardDef {
  @field count = contains(NumberField);

  static isolated = class extends Component<typeof Counter> {
    @tracked localCount = 0;

    @action increment() {
      this.localCount++;
    }

    <template>
      <div>
        <p>Count: {{this.localCount}}</p>
        <button {{on "click" this.increment}}>+1</button>
      </div>
    </template>
  };
}
```

### App Cards

Build full applications as cards with tabs, filters, and data views:

```typescript
export class CrmApp extends CardDef {
  static displayName = 'CRM';
  static prefersWideFormat = true;

  @field contacts = linksToMany(Contact);
  @field deals = linksToMany(Deal);

  static isolated = class extends Component<typeof CrmApp> {
    @tracked activeTab = 'contacts';

    <template>
      <div class="crm-app">
        <nav>
          <button {{on "click" (fn this.setTab "contacts")}}>Contacts</button>
          <button {{on "click" (fn this.setTab "deals")}}>Deals</button>
        </nav>
        <main>
          {{#if (eq this.activeTab "contacts")}}
            <@fields.contacts />
          {{else}}
            <@fields.deals />
          {{/if}}
        </main>
      </div>
    </template>
  };
}
```

### Cards with External Components

Extract complex template logic into separate component files:

```typescript
// contact/filter-panel.gts
export class FilterPanel extends Component {
  // ... complex filter logic
}

// contact.gts
import { FilterPanel } from './contact/filter-panel';

export class Contact extends CardDef {
  static isolated = class extends Component<typeof Contact> {
    <template>
      <FilterPanel />
      <@fields.name />
    </template>
  };
}
```

## File Organization

```
my-realm/
├── contact.gts                    # Card definition
├── contact/
│   ├── components/                # Supporting components
│   │   └── filter-panel.gts
│   └── fields/                    # Custom field types
│       └── social-link.gts
├── contacts/                      # Card instances
│   ├── alice.json
│   └── bob.json
└── index.json                     # Realm metadata
```

## Next Steps

- [Field Types Reference](/card-development/field-types) — All built-in types
- [Templates & Components](/card-development/templates) — Template details
- [Styling Cards](/card-development/styling) — CSS and theming
