# Disallow missing helpers, modifiers, or components in \<template\> with auto-fix to import them (`@cardstack/boxel/template-missing-invokable`)

💼 This rule is enabled in the ✅ `recommended` config.

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Auto-fixes missing imports for helpers, modifiers, and components in your \<template> tags.

If you refer to `on` without importing it:

```gjs
<template>
  <button {{on "click" doSomething}}>Do Something</button>
</template>
```

The auto-fix will create the import:

```gjs
import { on } from '@ember/modifier';
<template>
  <button {{on "click" doSomething}}>Do Something</button>
</template>
```

## Examples

## Config

- invokables
