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

| Name                                                                   | Description                                                                                     | 💼 | 🔧 |
| :--------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- | :- | :- |
| [template-missing-invokable](docs/rules/template-missing-invokable.md) | disallow missing helpers, modifiers, or components in \<template\> with auto-fix to import them | ✅  | 🔧 |

<!-- end auto-generated rules list -->

Development note: after adding a new rule, run `pnpm update` to re-generate docs and recommended-rules list
