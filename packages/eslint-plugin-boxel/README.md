# eslint-plugin-boxel

ESLint plugin for Boxel-specific rules

## Installation

This is currently only for use within the Boxel monorepo. In the future, we expect to publish an installable package for use elsewhere.

## Usage

Add `@cardstack/boxel` to the plugins section of your `.eslintrc` configuration file:

```json
{
  "plugins": ["@cardstack/boxel"]
}
```

Then configure the rules you want to use under the rules section:

```json
{
  "rules": {
    "@cardstack/boxel/rule-name": "error"
  }
}
```

## Rules
<!-- begin auto-generated rules list -->

💼 Configurations enabled in.\
✅ Set in the `recommended` configuration.\
🔧 Automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).

| Name                                                                   | Description                                                                                                                                                                      | 💼 | 🔧 |
| :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :- | :- |
| [missing-card-api-import](docs/rules/missing-card-api-import.md)       | disallow usage of card-api with missing imports with auto-fix                                                                                                                    | ✅  | 🔧 |
| [no-css-position-fixed](docs/rules/no-css-position-fixed.md)           | disallow `position: fixed` in card CSS because cards should not break out of their bounding box                                                                                  |    |    |
| [no-duplicate-imports](docs/rules/no-duplicate-imports.md)             | Prevent duplicate imports from the same module                                                                                                                                   | ✅  | 🔧 |
| [no-forbidden-head-tags](docs/rules/no-forbidden-head-tags.md)         | disallow forbidden HTML elements in `static head` templates — only `<title>`, `<meta>`, and `<link>` are permitted                                                               | ✅  |    |
| [no-literal-realm-urls](docs/rules/no-literal-realm-urls.md)           | Disallow environment-specific realm URLs in code; use portable prefixes like @cardstack/catalog/ instead                                                                         |    | 🔧 |
| [no-raf-for-state](docs/rules/no-raf-for-state.md)                     | disallow `requestAnimationFrame` in Ember component files — use `scheduleOnce("afterRender", ...)` from `@ember/runloop` instead so that `settled()` in tests can track the work |    |    |
| [template-missing-invokable](docs/rules/template-missing-invokable.md) | disallow missing helpers, modifiers, or components in \<template\> with auto-fix to import them                                                                                  | ✅  | 🔧 |

<!-- end auto-generated rules list -->

Development note: after adding a new rule, run `pnpm update` to re-generate docs and recommended-rules list
