# Base Card Types

The base realm (`https://cardstack.com/base/`) provides all fundamental card and field types that every Boxel application builds upon.

## Type Hierarchy

```
BaseDef
├── CardDef
│   ├── FileDef
│   └── Theme
└── FieldDef
    ├── StringField
    │   ├── TextAreaField
    │   ├── MarkdownField
    │   └── MaybeBase64Field
    ├── NumberField
    ├── BooleanField
    ├── DateField
    ├── DatetimeField
    ├── EmailField
    ├── CSSField
    ├── ReadOnlyField
    └── CardInfoField
```

## Card Types

### CardDef

**Module:** `https://cardstack.com/base/card-api`

The root card type. All cards extend this.

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Card URL (set after save) |
| `cardInfo` | `CardInfoField` | Metadata composite |
| `cardTitle` | `string` | Computed display title |
| `cardDescription` | `string` | Computed description |
| `cardThumbnailURL` | `string` | Computed thumbnail |

### FieldDef

**Module:** `https://cardstack.com/base/card-api`

The root field type. All composite fields extend this.

| Property | Type | Description |
|----------|------|-------------|
| `configuration` | `object` | Static default config |

### FileDef

**Module:** `https://cardstack.com/base/file-def`

Card type for file metadata.

### Theme

**Module:** `https://cardstack.com/base/card-api`

Card type for CSS theme definitions. Contains CSS variables and imports.

## Primitive Field Types

### StringField

**Module:** `https://cardstack.com/base/string`

Basic text value.

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

**Module:** `https://cardstack.com/base/number`

Numeric value.

```typescript
import NumberField from 'https://cardstack.com/base/number';

@field count = contains(NumberField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | `<input type="number">` |
| `embedded` | Formatted number |

### BooleanField

**Module:** `https://cardstack.com/base/boolean`

True/false toggle.

```typescript
import BooleanField from 'https://cardstack.com/base/boolean';

@field isActive = contains(BooleanField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | Toggle/checkbox |
| `embedded` | "True" / "False" |

### DateField

**Module:** `https://cardstack.com/base/date`

Date without time component.

```typescript
import DateField from 'https://cardstack.com/base/date';

@field birthday = contains(DateField);
```

| Value format | `YYYY-MM-DD` |

### DatetimeField

**Module:** `https://cardstack.com/base/datetime`

Date with time component.

```typescript
import DatetimeField from 'https://cardstack.com/base/datetime';

@field createdAt = contains(DatetimeField);
```

| Value format | ISO 8601 (`YYYY-MM-DDTHH:mm:ssZ`) |

### EmailField

**Module:** `https://cardstack.com/base/email`

Email address with validation.

```typescript
import EmailField from 'https://cardstack.com/base/email';

@field email = contains(EmailField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | Email input |
| `embedded` | Clickable mailto link |

### TextAreaField

**Module:** `https://cardstack.com/base/text-area`

Multi-line text. Extends StringField.

```typescript
import TextAreaField from 'https://cardstack.com/base/text-area';

@field description = contains(TextAreaField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | `<textarea>` |
| `embedded` | Multi-line text |

### MarkdownField

**Module:** `https://cardstack.com/base/markdown`

Rich text with Markdown support. Extends StringField.

```typescript
import MarkdownField from 'https://cardstack.com/base/markdown';

@field content = contains(MarkdownField);
```

| Format | Renders As |
|--------|-----------|
| `edit` | Markdown editor |
| `embedded` | Rendered HTML |

### CSSField

**Module:** `https://cardstack.com/base/card-api`

CSS code with syntax highlighting and copy button.

```typescript
@field styles = contains(CSSField);
```

### ReadOnlyField

**Module:** `https://cardstack.com/base/card-api`

Read-only string display. Cannot be edited.

## Composite Field Types

### CardInfoField

**Module:** `https://cardstack.com/base/card-api`

Card metadata composite containing title, description, and thumbnail URL. Present on every CardDef.

## Import Patterns

All base types use URL-based imports from `https://cardstack.com/base/`:

```typescript
// Card system
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';

// Field types
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import DatetimeField from 'https://cardstack.com/base/datetime';
import EmailField from 'https://cardstack.com/base/email';
import TextAreaField from 'https://cardstack.com/base/text-area';
import MarkdownField from 'https://cardstack.com/base/markdown';

// Command
import { Command } from 'https://cardstack.com/base/command';
```

## Creating Custom Types

### Custom Primitive Field

Override the serialization hooks for a custom primitive:

```typescript
export class PercentField extends FieldDef {
  static [primitive]: string;
  static displayName = 'Percentage';

  static [serialize](val: number) {
    return val;
  }

  static [deserialize](val: number) {
    return Math.min(100, Math.max(0, val));
  }

  static embedded = class extends Component<typeof PercentField> {
    <template>{{@model}}%</template>
  };
}
```

### Custom Composite Field

```typescript
export class MoneyField extends FieldDef {
  static displayName = 'Money';

  @field amount = contains(NumberField);
  @field currency = contains(StringField);

  static embedded = class extends Component<typeof MoneyField> {
    <template>
      {{@model.currency}} {{@model.amount}}
    </template>
  };
}
```

## Next Steps

- [Card API](/api-reference/card-api) — Core API reference
- [Field Types Reference](/card-development/field-types) — Usage guide
- [Field Decorators](/api-reference/field-decorators) — Decorator details
