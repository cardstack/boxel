# no-duplicate-imports

> Enforce all imports from a module to be in a single declaration

## Rule Details

This rule aims to prevent having duplicate imports from the same module, which can lead to confusion and errors. It combines all imports from the same module and removes any duplicate specifiers.

When imports are scattered throughout the file, it becomes harder to understand which symbols are used from each module. Consolidating imports makes code more readable and maintainable.

The rule will autofix instances where:

1. The same named import appears multiple times from the same module
2. An entire import statement is completely redundant

### Examples

Examples of **incorrect** code for this rule:

```js
import { eq } from '@cardstack/boxel-ui/helpers';
// ... some code ...
import { eq, add } from '@cardstack/boxel-ui/helpers'; // duplicate 'eq' import

// completely duplicate imports
import { eq, add } from '@cardstack/boxel-ui/helpers';
import { eq, add } from '@cardstack/boxel-ui/helpers';

// multiline duplicate imports
import { eq } from '@cardstack/boxel-ui/helpers';
import {
  eq,
  add
} from '@cardstack/boxel-ui/helpers';
```

Examples of **correct** code for this rule:

```js
// All imports from the same module in one statement
import { eq, add } from '@cardstack/boxel-ui/helpers';

// Different modules are fine
import { eq } from '@cardstack/boxel-ui/helpers';
import { Component } from '@glimmer/component';

// Different import types are fine
import defaultExport from 'module';
import { namedExport } from 'module';

// Different named imports from the same module are fine
import { a } from 'module';
import { b } from 'module';
```

### Auto-fix Behavior

The rule's auto-fix capabilities handle several scenarios:

1. **Individual duplicate specifier**: It removes duplicate named imports while preserving unique imports in the same statement.
   ```js
   // Before
   import { eq } from '@cardstack/boxel-ui/helpers';
   import { eq, add } from '@cardstack/boxel-ui/helpers';
   
   // After
   import { eq } from '@cardstack/boxel-ui/helpers';
   import { add } from '@cardstack/boxel-ui/helpers';
   ```

2. **Entirely duplicate import statement**: It removes redundant import statements.
   ```js
   // Before
   import { eq, add } from '@cardstack/boxel-ui/helpers';
   import { eq, add } from '@cardstack/boxel-ui/helpers';
   
   // After
   import { eq, add } from '@cardstack/boxel-ui/helpers';
   ```

3. **Special case handling**: The rule correctly handles various edge cases:
   - First, middle, or last specifier in the list
   - Comma separators between imports
   - Multiline import statements

### When Not To Use It

If you prefer to organize imports by their purpose rather than their source, you might want to disable this rule.

## Further Reading

* [ES6 Import Syntax](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import)
* [ESLint rules: no-duplicate-imports](https://eslint.org/docs/latest/rules/no-duplicate-imports) - Similar built-in ESLint rule
