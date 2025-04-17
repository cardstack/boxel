# eslint-plugin-boxel

ESLint plugin for Boxel-specific rules

## Installation

You'll first need to install [ESLint](https://eslint.org/):

```sh
pnpm i eslint --save-dev
```

Next, install `eslint-plugin-boxel`:

```sh
pnpm install eslint-plugin-boxel --save-dev
```

## Usage

Add `boxel` to the plugins section of your `.eslintrc` configuration file:

```json
{
  "plugins": ["boxel"]
}
```

Then configure the rules you want to use under the rules section:

```json
{
  "rules": {
    "boxel/rule-name": "error"
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

<!-- TODO: Add rule documentation as rules are developed -->
```
