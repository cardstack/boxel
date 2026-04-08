# Field Types Reference

Boxel provides a comprehensive set of built-in field types for common data needs. All field types live in the base realm at `https://cardstack.com/base/`.

## Primitive Fields

Primitive fields hold simple values and have no sub-fields.

### StringField

Basic text input.

```typescript
import StringField from 'https://cardstack.com/base/string';

@field name = contains(StringField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | `<input type="text">` |
| `embedded` | Plain text |
| `atom` | Plain text |

### NumberField

Numeric values.

```typescript
import NumberField from 'https://cardstack.com/base/number';

@field age = contains(NumberField);
@field price = contains(NumberField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | `<input type="number">` |
| `embedded` | Formatted number |

### BooleanField

True/false toggle.

```typescript
import BooleanField from 'https://cardstack.com/base/boolean';

@field isActive = contains(BooleanField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | Checkbox toggle |
| `embedded` | "True" or "False" |

### DateField

Date without time.

```typescript
import DateField from 'https://cardstack.com/base/date';

@field birthday = contains(DateField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | Date picker |
| `embedded` | Formatted date string |

### DatetimeField

Date with time.

```typescript
import DatetimeField from 'https://cardstack.com/base/datetime';

@field createdAt = contains(DatetimeField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | Datetime picker |
| `embedded` | Formatted datetime string |

### EmailField

Email address with validation.

```typescript
import EmailField from 'https://cardstack.com/base/email';

@field contactEmail = contains(EmailField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | Email input |
| `embedded` | Clickable `mailto:` link |

### MarkdownField

Rich text with Markdown support.

```typescript
import MarkdownField from 'https://cardstack.com/base/markdown';

@field content = contains(MarkdownField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | Markdown editor |
| `embedded` | Rendered HTML from markdown |

### TextAreaField

Multi-line text.

```typescript
import TextAreaField from 'https://cardstack.com/base/text-area';

@field notes = contains(TextAreaField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | `<textarea>` |
| `embedded` | Multi-line text |

### CSSField

CSS code with syntax highlighting.

```typescript
import CSSField from 'https://cardstack.com/base/css';

@field customStyles = contains(CSSField);
```

## Composite Fields

Composite fields (extending `FieldDef`) contain other fields and can have their own templates.

### Creating Custom Fields

```typescript
import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

export class PhoneNumber extends FieldDef {
  static displayName = 'Phone Number';

  @field countryCode = contains(StringField);
  @field number = contains(StringField);

  static embedded = class Embedded extends Component<typeof PhoneNumber> {
    <template>
      <span>+{{@model.countryCode}} {{@model.number}}</span>
    </template>
  };

  static edit = class Edit extends Component<typeof PhoneNumber> {
    <template>
      <div class="phone-edit">
        <@fields.countryCode />
        <@fields.number />
      </div>
    </template>
  };
}
```

### Usage in Cards

```typescript
export class Contact extends CardDef {
  @field phone = contains(PhoneNumber);
  @field phones = containsMany(PhoneNumber);
}
```

## Relationship Fields

### linksTo

Single card reference:

```typescript
@field company = linksTo(Company);
```

- Renders as a card picker in edit mode
- Shows the linked card's embedded view in display mode
- Stored as a URL reference in JSON

### linksToMany

Multiple card references:

```typescript
@field tags = linksToMany(Tag);
```

- Renders as a multi-select card picker in edit mode
- Shows a list of linked cards in display mode
- Stored as an array of URL references

### Self-Referential Links

Use thunks to avoid circular declarations:

```typescript
@field parent = linksTo(() => TreeNode);
@field children = linksToMany(() => TreeNode);
```

### Query-Based Links

Auto-populate from a search query:

```typescript
@field recentPosts = linksToMany(() => BlogPost, {
  query: {
    filter: {
      type: { module: './blog-post', name: 'BlogPost' }
    },
    sort: [{ by: 'publishDate', direction: 'desc' }],
    page: { size: 5 }
  }
});
```

## Plural Fields

### containsMany

Array of embedded values:

```typescript
@field tags = containsMany(StringField);           // string[]
@field addresses = containsMany(Address);           // Address[]
@field scores = containsMany(NumberField);          // number[]
```

**Note**: `containsMany` with primitive fields renders as read-only in the default template. With composite fields, individual items render in `atom` format.

### linksToMany

Array of card references:

```typescript
@field teammates = linksToMany(Person);
@field categories = linksToMany(Category);
```

## Field Patterns

### Enum-like Fields

Create fields with predefined options:

```typescript
export class StatusField extends FieldDef {
  static displayName = 'Status';
  static values = [
    { index: 0, label: 'Draft' },
    { index: 1, label: 'Published' },
    { index: 2, label: 'Archived' },
  ];

  @field selectedIndex = contains(NumberField);

  get label() {
    return StatusField.values[this.selectedIndex]?.label ?? 'Unknown';
  }
}
```

### Amount with Currency

```typescript
export class AmountWithCurrency extends FieldDef {
  static displayName = 'Amount';

  @field amount = contains(NumberField);
  @field currency = contains(StringField);

  static embedded = class extends Component<typeof AmountWithCurrency> {
    get formatted() {
      const amount = this.args.model.amount ?? 0;
      const currency = this.args.model.currency ?? 'USD';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(amount);
    }

    <template>
      <span>{{this.formatted}}</span>
    </template>
  };
}
```

## Field Options Reference

All field decorators accept these options:

| Option | Type | Applicable To | Description |
|--------|------|---------------|-------------|
| `description` | `string` | All | Human-readable description |
| `computeVia` | `function` | `contains`, `containsMany` | Makes field computed |
| `isUsed` | `boolean` | All | Mark as "used" for filtering |
| `configuration` | `object` | All | Per-instance configuration |
| `query` | `Query` | `linksTo`, `linksToMany` | Auto-populate from search |

## Next Steps

- [Defining Cards](/card-development/defining-cards) — Card definition patterns
- [Computed Fields](/core-concepts/computed-fields) — Computed field details
- [Templates & Components](/card-development/templates) — Template patterns
