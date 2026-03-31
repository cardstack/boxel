# Disallow usage of card-api with missing imports with auto-fix (`@cardstack/boxel/missing-card-api-import`)

💼 This rule is enabled in the ✅ `recommended` config.

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Auto-fixes missing imports for card-api related symbols in your code.

If you refer to a commonly used named export from card-api without importing it:

```js
export class Payment extends FieldDef {
  // ...
}
```

The auto-fix will add the missing import:

```js
import { FieldDef } from '@cardstack/base/card-api';

export class Payment extends FieldDef {
  // ...
}
```

## Examples

### Using card-api symbols without imports

```js
export class Payment extends FieldDef {
  @field chain = linksTo(Chain);
  @field address = contains(StringField);
}
```

Will be fixed to:

```js
import { FieldDef, field, linksTo, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Payment extends FieldDef {
  @field chain = linksTo(Chain);
  @field address = contains(StringField);
}
```

### Partially imported card-api exports

```js
import { contains, field } from '@cardstack/base/card-api';

export class Payment extends FieldDef {
  @field address = contains(StringField);
}
```

Will be fixed to:

```js
import { contains, field, FieldDef } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Payment extends FieldDef {
  @field address = contains(StringField);
}
```

## Config

The rule accepts an options object with the following properties:

- `importMappings`: An object where each key is an identifier name and the value is an array with:
  1. The name to import from the module
  2. The module path to import from

Example configuration:

```json
{
  "rules": {
    "@cardstack/boxel/missing-card-api-import": [
      "error",
      {
        "importMappings": {
          "FieldDef": ["FieldDef", "@cardstack/base/card-api"],
          "field": ["field", "@cardstack/base/card-api"],
          "contains": ["contains", "@cardstack/base/card-api"],
          "linksTo": ["linksTo", "@cardstack/base/card-api"],
          "StringField": ["default", "@cardstack/base/string"]
        }
      }
    ]
  }
}
```
