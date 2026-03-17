## Enum Field Essentials

**CRITICAL Import Syntax:**
```gts
import enumField from 'https://cardstack.com/base/enum'; // Default import, not { enumField }
```

**Quick Start:**
```gts
const StatusField = enumField(StringField, { options: ['Open', 'Closed'] });
@field status = contains(StatusField);
```

**Template:** `<@fields.status />` renders a BoxelSelect in edit mode.

**Rich options with labels/icons:**
```gts
enumField(StringField, { 
  options: [
    { value: 'high', label: 'High Priority', icon: ArrowUpIcon },
    { value: 'low', label: 'Low Priority', icon: ArrowDownIcon }
  ]
})
```

**Key helpers:**
- `enumValues(card, 'fieldName')` → array of primitive values
- `enumOptions(card, 'fieldName')` → normalized `{ value, label, icon? }`

<!--more-->

# Enum Fields

## Purpose

Use `enumField(BaseField, { options })` to create a `FieldDef` with constrained values and a default dropdown editor. Works with primitive bases (e.g., `StringField`, `NumberField`).

## Import Syntax

**CRITICAL:** Use default import, not destructured import:

```gts
// ✅ CORRECT
import enumField from 'https://cardstack.com/base/enum';

// ❌ WRONG
import { enumField } from 'https://cardstack.com/base/enum';
```

## Quick Start

**Define:**
```gts
const StatusField = enumField(StringField, { options: ['Open', 'Closed'] });
```

**Use:**
```gts
@field status = contains(StatusField);
```

**Template:**
```hbs
<@fields.status /> {{! Renders a BoxelSelect in edit mode }}
```

## Rich Options (Labels/Icons)

```gts
enumField(StringField, { 
  options: [
    { value: 'high', label: 'High', icon: ArrowUpIcon },
    { value: 'medium', label: 'Medium', icon: MinusIcon },
    { value: 'low', label: 'Low', icon: ArrowDownIcon }
  ]
})
```

Editor shows labels/icons; stored value is the primitive `value`.

## Dynamic Options

**Provide a function:**
```gts
enumField(StringField, { 
  options: function() { 
    return this.someList; 
  }
})
```

**Per-usage override:**
```gts
contains(Field, { 
  configuration: enumConfig(function() { 
    return { options: this.someList }; 
  })
})
```

**Note:** `this` is the containing card or field

## Helpers

**enumValues** - Get array of primitive values:
```gts
enumValues(card, 'enumFieldName') // → ['High', 'Medium', 'Low']
```

**enumOptions** - Get normalized option objects:
```gts
enumOptions(card, 'enumFieldName') // → [{ value, label, icon? }, ...]
```

## Null Handling

If current value is `null` and `null` isn't in options, placeholder uses `unsetLabel` or "Choose…".

To make `null` selectable:
```gts
{ value: null, label: 'None' }
```

## Limitations

- **Compound field values:** Not yet supported
- **Card values:** Not yet supported

## Validation and Behavior

- Duplicate values throw during option normalization
- Query and serialization follow the base field
- Enum wrapping does not change data shape

## Minimal Example

**Define:**
```gts
import enumField from 'https://cardstack.com/base/enum';
const Priority = enumField(StringField, { options: ['High', 'Medium', 'Low'] });
```

**Use:**
```gts
class Task extends CardDef { 
  @field priority = contains(Priority); 
}
```

**Template:**
```hbs
<@fields.priority />
{{enumValues @model 'priority'}} {{! ['High','Medium','Low'] }}
```

## Factory vs Usage (Clarity)

**Factory defaults:**
```gts
enumField(Base, { options }) // For simple/static defaults
```

**Usage overrides:**
```gts
contains(Field, { 
  configuration: enumConfig(function() { 
    return { options }; 
  })
}) // For per-instance behavior
```

Both resolve to `@configuration.enum.options` for templates/formats.

## Callback Context

`computeVia`, `enumField` options functions, and `enumConfig` usage callbacks all receive the containing instance as `this`.

**Prefer `function() { ... }` (not arrow)** to ensure `this` is bound to the parent instance.

**Guidance:** Keep callbacks side-effect free; derive options synchronously from `this`.

## Complete Example

```gts
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';
import ArrowUpIcon from '@cardstack/boxel-icons/arrow-up';
import ArrowDownIcon from '@cardstack/boxel-icons/arrow-down';

const PriorityField = enumField(StringField, {
  options: [
    { value: 'high', label: 'High Priority', icon: ArrowUpIcon },
    { value: 'medium', label: 'Medium Priority' },
    { value: 'low', label: 'Low Priority', icon: ArrowDownIcon }
  ]
});

export class Task extends CardDef {
  @field taskName = contains(StringField);
  @field priority = contains(PriorityField);
  
  @field title = contains(StringField, {
    computeVia: function(this: Task) {
      return this.taskName ?? 'Untitled Task';
    }
  });
}
```