---
title: Prefer Named Exports, Fallback to Default for Implicit Template Lookup
impact: LOW
impactDescription: Clear export contracts across .hbs and template-tag codebases
tags: exports, hbs, gjs, interop, code-organization
---

## Prefer Named Exports, Fallback to Default for Implicit Template Lookup

Use named exports for shared modules imported directly in JS/TS (utilities, constants, pure functions). If a module should be invokable from `.hbs` templates via implicit lookup, provide a default export. In hybrid `.gjs`/`.hbs` projects, a practical pattern is a named export plus a default export alias.

**Incorrect (default export in a shared utility module):**

```javascript
// app/utils/format-date.js
export default function formatDate(date) {
  return new Date(date).toLocaleDateString();
}
```

**Correct (named export in a shared utility module):**

```javascript
// app/utils/format-date.js
export function formatDate(date) {
  return new Date(date).toLocaleDateString();
}
```

**Correct (hybrid `.gjs`/`.hbs` named export + default alias):**

```javascript
// app/helpers/format-date.js
import { helper } from '@ember/component/helper';

export const formatDate = helper(([value]) => {
  return new Date(value).toLocaleDateString();
});

export default formatDate;
```

## Where Named Exports Are Preferred

Use named exports when the module is imported directly by other modules and is not resolved via implicit template lookup.

**Example (utility module with multiple named exports):**

```javascript
// app/utils/validators.js
export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isPhoneNumber(value) {
  return /^\d{3}-\d{3}-\d{4}$/.test(value);
}
```

Benefits:

1. Explicit import contracts
2. Better refactor safety (symbol rename tracking)
3. Better tree-shaking for utility modules
4. Easier multi-export module organization

## Where Default Exports Are Required

Use default exports for modules consumed through resolver/template lookup.
If your project uses `.hbs`, invokables that should be accessible from templates should provide `export default`.
In hybrid `.gjs`/`.hbs` codebases, use named exports plus a default export alias where you want both explicit imports and template compatibility.

**Service:**

```javascript
// app/services/auth.js
import Service from '@ember/service';

export default class AuthService extends Service {
  // ...
}
```

**Route:**

```javascript
// app/routes/dashboard.js
import Route from '@ember/routing/route';
import { service } from '@ember/service';

export default class DashboardRoute extends Route {
  @service store;

  model() {
    return this.store.findAll('dashboard-item');
  }
}
```

**Modifier (when invoked from `.hbs`):**

```javascript
// app/modifiers/focus.js
import { modifier } from 'ember-modifier';

export default modifier((element) => {
  element.focus();
});
```

**Template (`.gjs`):**

```glimmer-js
// app/templates/dashboard.gjs
<template>
  <h1>Dashboard</h1>
</template>
```

**Template (`.gts`):**

```glimmer-ts
// app/templates/dashboard.gts
import type { TOC } from '@ember/component/template-only';

interface Signature {
  Args: {
    model: unknown;
  };
}

export default <template>
  <h1>Dashboard</h1>
</template> satisfies TOC<Signature>;
```

Template-tag files must resolve via a module default export in convention-based and `import.meta.glob` flows.
For `app/templates/*.gjs`, the default export is implicit after compilation.

## Strict Resolver Nuance

With `ember-strict-application-resolver`, you can register explicit module values in `App.modules`:

**Strict resolver explicit modules registration:**

```ts
modules = {
  './services/manual': { default: ManualService },
  './services/manual-shorthand': ManualService,
};
```

In that explicit shorthand case, a direct value works without a default-exported module object.
This is an explicit registration escape hatch and does not replace default-export requirements for `.hbs`-invokable modules.

## Rule of Thumb

1. If a module should be invokable from `.hbs`, provide a default export.
2. In hybrid `.gjs`/`.hbs` projects, use named export + default alias for resolver-facing modules.
3. Strict resolver explicit `modules` entries may use direct shorthand values where appropriate.
4. Plain shared modules (`app/utils`, shared constants, reusable pure functions): prefer named exports.
5. Template-tag components (`.gjs`/`.gts`): follow the component file-conventions rule and use named class exports.

## References

- [ES Modules Best Practices](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [ember-strict-application-resolver](https://github.com/ember-cli/ember-strict-application-resolver)
- [ember-resolver](https://github.com/ember-cli/ember-resolver)
