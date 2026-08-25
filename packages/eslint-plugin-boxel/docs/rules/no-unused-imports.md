# Remove unused import bindings while preserving module evaluation (`@cardstack/boxel/no-unused-imports`)

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

## Rule Details

Importing a module executes its top-level code, so an import declaration whose bindings are all unused cannot simply be deleted without changing runtime behavior. This rule reports unused import bindings and fixes them without discarding module evaluation:

1. When a declaration still has used specifiers, only the unused specifiers are removed.
2. A declaration whose bindings are all unused is deleted outright only when it is type-only (type imports are erased at runtime) or when its module matches the `sideEffectFreeModules` option.
3. Any other fully-unused declaration is rewritten to a bare side-effect import (`import 'module';`), so the module's top-level code still runs.

A binding counts as used when it has any reference, including references from a `<template>` tag recorded by ember-eslint-parser.

Examples of **incorrect** code for this rule:

```js
import { CardDef, FieldDef } from '@cardstack/base/card-api';

export class MyCard extends CardDef {} // FieldDef is never used
```

Examples of **correct** code for this rule:

```js
import { CardDef } from '@cardstack/base/card-api';

export class MyCard extends CardDef {}
```

```js
// bindingless imports are kept for their side effects
import './register';
```

## Options

```js
'@cardstack/boxel/no-unused-imports': [
  'error',
  {
    sideEffectFreeModules: ['@cardstack/base/*', 'some-exact-module'],
  },
],
```

- `sideEffectFreeModules` — modules whose fully-unused import declarations may be deleted outright instead of being rewritten to a side-effect import. An entry ending in `*` matches by prefix; any other entry matches exactly. Default: `[]` (nothing is ever deleted outright).

## When Not To Use It

If unused imports should stay visible as errors for a human author to resolve — for example in hand-written application source — use `@typescript-eslint/no-unused-vars` instead and leave this rule off.
